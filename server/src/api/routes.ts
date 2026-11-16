import type { FastifyInstance } from 'fastify';
import type { Health } from '@cine/shared';
import { db, getSettings, updateSettings } from '../db.ts';
import { listMovies, getMovieDetail, listOrphanSubtitles, updateUserData } from '../library/repo.ts';
import { scan, getStatus, enrichMovie, matchSubtitles, watch } from '../library/library.ts';
import { externalToVtt, embeddedToVtt } from '../library/subtitles.ts';
import { computeStats } from '../library/stats.ts';
import { searchMovies, tmdbEnabled } from '../metadata/tmdb.ts';
import { ffmpegPath, ffprobePath, detectHwEncoders } from '../tools/ffmpeg.ts';

export async function apiRoutes(app: FastifyInstance) {
  app.get('/api/health', async (): Promise<Health> => ({
    ffmpeg: ffmpegPath,
    ffprobe: ffprobePath,
    tmdb: tmdbEnabled(),
    hwaccel: await detectHwEncoders(),
    version: '0.1.0',
  }));

  // ----- Bibliothèque -----
  app.get('/api/movies', async () => listMovies());

  app.get<{ Params: { id: string } }>('/api/movies/:id', async (req, reply) => {
    const m = getMovieDetail(Number(req.params.id));
    if (!m) return reply.code(404).send({ error: 'Film introuvable' });
    return m;
  });

  app.patch<{ Params: { id: string }; Body: { rating?: number | null; position?: number; watched?: boolean; subtitleOffset?: number } }>(
    '/api/movies/:id/user', async (req) => updateUserData(Number(req.params.id), req.body ?? {}),
  );

  // Correction manuelle de la correspondance TMDB
  app.get<{ Querystring: { q: string; year?: string } }>('/api/tmdb/search', async (req, reply) => {
    if (!tmdbEnabled()) return reply.code(400).send({ error: 'Clé TMDB absente' });
    return searchMovies(req.query.q, req.query.year ? Number(req.query.year) : null);
  });

  app.post<{ Params: { id: string }; Body: { tmdbId: number } }>('/api/movies/:id/match', async (req, reply) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM movies WHERE id = ?').get(id)) return reply.code(404).send({ error: 'Film introuvable' });
    await enrichMovie(id, req.body.tmdbId, 'manual', 1);
    matchSubtitles();
    return getMovieDetail(id);
  });

  app.post('/api/library/scan', async () => { void scan(); return getStatus(); });
  app.get('/api/library/status', async () => getStatus());

  // ----- Sous-titres -----
  app.get<{ Params: { id: string } }>('/api/subtitles/:id.vtt', async (req, reply) => {
    const s = db.prepare(`SELECT s.*, m.file_path AS movie_path FROM subtitles s LEFT JOIN movies m ON m.id = s.movie_id WHERE s.id = ?`).get(Number(req.params.id)) as any;
    if (!s) return reply.code(404).send({ error: 'Sous-titre introuvable' });
    if (!s.text_based) return reply.code(415).send({ error: 'Sous-titre image (PGS/VobSub) : incrustation nécessaire' });
    const vtt = s.source === 'external'
      ? externalToVtt(s.path)
      : await embeddedToVtt(s.movie_path, s.stream_index, `m${s.movie_id}-s${s.stream_index}`);
    reply.header('content-type', 'text/vtt; charset=utf-8').header('cache-control', 'no-cache');
    return vtt;
  });

  app.get('/api/subtitles/orphans', async () => listOrphanSubtitles());

  app.post<{ Params: { id: string }; Body: { movieId: number | null; language?: string } }>('/api/subtitles/:id/assign', async (req) => {
    const id = Number(req.params.id);
    db.prepare(`UPDATE subtitles SET movie_id = ?, match_method = 'manual', match_score = 1 WHERE id = ? AND source = 'external'`).run(req.body.movieId, id);
    if (req.body.language) db.prepare(`UPDATE subtitles SET language = ?, language_source = 'manual' WHERE id = ?`).run(req.body.language, id);
    return { ok: true };
  });

  // ----- Statistiques -----
  app.get<{ Querystring: { annee?: string } }>('/api/stats', async (req) =>
    computeStats(req.query.annee && /^\d{4}$/.test(req.query.annee) ? Number(req.query.annee) : null));

  // ----- Réglages -----
  app.get('/api/settings', async () => getSettings());
  app.put<{ Body: Record<string, unknown> }>('/api/settings', async (req) => {
    const before = getSettings().libraryDirs.join(';');
    const s = updateSettings(req.body as any);
    if (s.libraryDirs.join(';') !== before) { watch(); void scan(); }
    return s;
  });
}
