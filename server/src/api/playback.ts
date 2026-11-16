import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { MediaInfo, PingResponse, PlaybackPing, PlaybackRequest } from '@cine/shared';
import { db, json } from '../db.ts';
import { startSession, getSession, stopSession, waitForFile, housekeep } from '../playback/sessions.ts';
import { getTrickplay, trickplayFile } from '../playback/trickplay.ts';
import { updateUserData } from '../library/repo.ts';

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska' };

function movieRow(id: number) {
  return db.prepare('SELECT id, file_path, media FROM movies WHERE id = ? AND missing = 0').get(id) as { id: number; file_path: string; media: string | null } | undefined;
}

export async function playbackRoutes(app: FastifyInstance) {
  app.post<{ Body: PlaybackRequest }>('/api/playback/start', async (req, reply) => {
    const row = movieRow(req.body.movieId);
    if (!row) return reply.code(404).send({ error: 'Film introuvable' });
    const media = json.parse<MediaInfo | null>(row.media, null);
    if (!media) return reply.code(409).send({ error: "Ce fichier n'a pas encore été analysé" });

    let burnIndex: number | null = null;
    if (req.body.burnSubtitleId != null) {
      const s = db.prepare(`SELECT stream_index FROM subtitles WHERE id = ? AND movie_id = ? AND source = 'embedded'`).get(req.body.burnSubtitleId, row.id) as any;
      burnIndex = s?.stream_index ?? null;
    }
    try {
      const { session, plan } = await startSession({ id: row.id, file_path: row.file_path, media }, { ...req.body, burnSubtitleId: burnIndex });
      session.playId = Number(db.prepare(`INSERT INTO plays (movie_id) VALUES (?)`).run(row.id).lastInsertRowid);
      return plan;
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  // ----- HLS -----
  app.get<{ Params: { sid: string; file: string } }>('/api/hls/:sid/:file', async (req, reply) => {
    const s = getSession(req.params.sid);
    if (!s) return reply.code(404).send({ error: 'Session expirée' });
    const file = req.params.file;
    if (!/^(index\.m3u8|init\.mp4|seg\d{5}\.m4s)$/.test(file)) return reply.code(400).send({ error: 'Fichier invalide' });
    const p = await waitForFile(s, file);
    if (!p) return reply.code(s.error ? 500 : 404).send({ error: s.error ?? 'Segment indisponible' });
    const type = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : file.endsWith('.mp4') ? 'video/mp4' : 'video/iso.segment';
    reply.header('content-type', type).header('cache-control', file.endsWith('.m3u8') ? 'no-cache' : 'private, max-age=3600');
    if (file.endsWith('.m3u8')) return reply.send(fs.readFileSync(p));
    // Segments (souvent 5 à 20 Mo) : envoyés en flux, avec leur taille
    reply.header('content-length', fs.statSync(p).size);
    return reply.send(fs.createReadStream(p));
  });

  // ----- Lecture directe (avec Range) -----
  app.get<{ Params: { id: string } }>('/api/movies/:id/file', async (req, reply) => {
    const row = movieRow(Number(req.params.id));
    if (!row || !fs.existsSync(row.file_path)) return reply.code(404).send({ error: 'Fichier introuvable' });
    const size = fs.statSync(row.file_path).size;
    const type = MIME[path.extname(row.file_path).toLowerCase()] ?? 'application/octet-stream';
    reply.header('accept-ranges', 'bytes').header('content-type', type);
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (!range) {
      reply.header('content-length', size);
      return reply.send(fs.createReadStream(row.file_path));
    }
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return reply.code(416).header('content-range', `bytes */${size}`).send();
    reply.code(206).header('content-range', `bytes ${start}-${end}/${size}`).header('content-length', end - start + 1);
    return reply.send(fs.createReadStream(row.file_path, { start, end }));
  });

  // ----- Progression -----
  app.post<{ Body: PlaybackPing }>('/api/playback/ping', async (req, reply): Promise<PingResponse | void> => {
    const s = getSession(req.body.sessionId);
    if (!s) return reply.code(404).send({ error: 'Session expirée' });
    const now = Date.now();
    const elapsed = Math.min(30, (now - s.lastAccess) / 1000);
    s.lastAccess = now;
    s.position = req.body.position;

    const ratio = s.duration ? req.body.position / s.duration : 0;
    const watched = ratio >= 0.9;
    // En fin de film, on remet la position à zéro pour la prochaine séance
    updateUserData(s.movieId, { position: watched ? 0 : req.body.position, ...(watched ? { watched: true } : {}) });
    if (watched && !s.watchedCounted) {
      s.watchedCounted = true;
      db.prepare(`UPDATE user_data SET watch_count = watch_count + 1, last_watched_at = datetime('now') WHERE movie_id = ?`).run(s.movieId);
    }
    if (!req.body.paused && s.playId) db.prepare(`UPDATE plays SET seconds = seconds + ? WHERE id = ?`).run(elapsed, s.playId);

    if (s.mode === 'direct') return { availableFrom: 0, availableTo: s.duration, finished: true, watched };
    return { ...housekeep(s), watched };
  });

  app.post<{ Body: { sessionId: string } }>('/api/playback/stop', async (req) => {
    stopSession(req.body.sessionId);
    return { ok: true };
  });

  // ----- Vignettes -----
  app.get<{ Params: { id: string } }>('/api/movies/:id/trickplay', async (req, reply) => {
    const t = getTrickplay(Number(req.params.id));
    return t ?? reply.code(404).send({ error: 'Vignettes pas encore générées' });
  });
  app.get<{ Params: { id: string; file: string } }>('/api/movies/:id/trickplay/:file', async (req, reply) => {
    const p = trickplayFile(Number(req.params.id), req.params.file);
    if (!p) return reply.code(404).send();
    reply.header('content-type', 'image/jpeg').header('cache-control', 'public, max-age=604800');
    return reply.send(fs.createReadStream(p));
  });
}
