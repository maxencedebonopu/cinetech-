// Lecture des films en base → objets de l'API.
import path from 'node:path';
import type { MovieSummary, MovieDetail, SubtitleTrack, UserData, MediaInfo, OrphanSubtitle } from '@cine/shared';
import { db, json } from '../db.ts';

const LANG_NAMES = new Intl.DisplayNames(['fr'], { type: 'language' });
export function langName(code: string | null) {
  if (!code) return 'Langue inconnue';
  try { const n = LANG_NAMES.of(code); return n ? n[0].toUpperCase() + n.slice(1) : code; } catch { return code; }
}

function subLabel(s: any) {
  const parts = [langName(s.language)];
  if (s.forced) parts.push('forcés');
  if (s.sdh) parts.push('SDH');
  return parts.join(' · ');
}

function toSubtitle(s: any): SubtitleTrack {
  const textBased = !!s.text_based;
  return {
    id: s.id,
    source: s.source,
    language: s.language,
    forced: !!s.forced,
    label: subLabel(s),
    codec: s.codec,
    textBased,
    url: textBased ? `/api/subtitles/${s.id}.vtt` : null,
  };
}

function toUser(u: any | undefined): UserData {
  return {
    rating: u?.rating ?? null,
    watchCount: u?.watch_count ?? 0,
    lastWatchedAt: u?.last_watched_at ?? null,
    position: u?.position ?? 0,
    watched: !!u?.watched,
    subtitleOffset: u?.subtitle_offset ?? 0,
  };
}

function toSummary(r: any, subLangs: string[]): MovieSummary {
  const media = json.parse<MediaInfo | null>(r.media, null);
  const duration = media?.duration ?? (r.runtime ? r.runtime * 60 : 0);
  return {
    id: r.id,
    title: r.title ?? r.parsed_title,
    originalTitle: r.original_title,
    year: r.year ?? r.parsed_year,
    runtime: r.runtime ?? (media ? Math.round(media.duration / 60) : null),
    genres: json.parse(r.genres, []),
    directors: json.parse(r.directors, []),
    countries: json.parse(r.countries, []),
    poster: json.parse(r.poster, null),
    backdrop: json.parse(r.backdrop, null),
    logo: json.parse(r.logo, null),
    palette: json.parse(r.palette, null),
    matchStatus: r.match_status,
    addedAt: r.added_at,
    watched: !!r.watched,
    progress: duration && r.position ? Math.min(1, r.position / duration) : 0,
    subtitleLanguages: subLangs,
  };
}

const SUMMARY_SQL = `SELECT m.*, u.position, u.watched FROM movies m LEFT JOIN user_data u ON u.movie_id = m.id WHERE m.missing = 0`;

function subLangMap() {
  const rows = db.prepare(`SELECT movie_id, language FROM subtitles WHERE movie_id IS NOT NULL AND language IS NOT NULL GROUP BY movie_id, language`).all() as any[];
  const map = new Map<number, string[]>();
  for (const r of rows) map.set(r.movie_id, [...(map.get(r.movie_id) ?? []), r.language]);
  return map;
}

export function listMovies(): MovieSummary[] {
  const langs = subLangMap();
  return (db.prepare(`${SUMMARY_SQL} ORDER BY COALESCE(m.title, m.parsed_title) COLLATE NOCASE`).all() as any[]).map((r) => toSummary(r, langs.get(r.id) ?? []));
}

export function getMovieDetail(id: number): MovieDetail | null {
  const r = db.prepare(`SELECT m.*, u.position, u.watched FROM movies m LEFT JOIN user_data u ON u.movie_id = m.id WHERE m.id = ?`).get(id) as any;
  if (!r) return null;
  const subs = (db.prepare(`SELECT * FROM subtitles WHERE movie_id = ? ORDER BY source DESC, language = 'fr' DESC, language, forced`).all(id) as any[]).map(toSubtitle);
  const user = db.prepare(`SELECT * FROM user_data WHERE movie_id = ?`).get(id);
  const summary = toSummary(r, [...new Set(subs.map((s) => s.language).filter(Boolean) as string[])]);
  return {
    ...summary,
    tmdbId: r.tmdb_id,
    overview: r.overview,
    tagline: r.tagline,
    originalLanguage: r.original_language,
    cast: json.parse(r.cast_json, []),
    crew: json.parse(r.crew_json, []),
    filePath: r.file_path,
    fileName: path.basename(r.file_path),
    media: json.parse(r.media, null),
    subtitles: subs,
    user: toUser(user),
  };
}

export function listOrphanSubtitles(): OrphanSubtitle[] {
  return (db.prepare(`SELECT * FROM subtitles WHERE source = 'external' AND movie_id IS NULL ORDER BY guess_title`).all() as any[]).map((s) => ({
    id: s.id,
    path: s.path,
    fileName: path.basename(s.path),
    language: s.language,
    guessTitle: s.guess_title,
    guessYear: s.guess_year,
  }));
}

export function updateUserData(movieId: number, patch: Partial<{ rating: number | null; position: number; watched: boolean; subtitleOffset: number }>) {
  db.prepare(`INSERT INTO user_data (movie_id) VALUES (?) ON CONFLICT(movie_id) DO NOTHING`).run(movieId);
  const map: Record<string, string> = { rating: 'rating', position: 'position', watched: 'watched', subtitleOffset: 'subtitle_offset' };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in map) || v === undefined) continue;
    db.prepare(`UPDATE user_data SET ${map[k]} = ? WHERE movie_id = ?`).run(typeof v === 'boolean' ? (v ? 1 : 0) : v, movieId);
  }
  return toUser(db.prepare(`SELECT * FROM user_data WHERE movie_id = ?`).get(movieId));
}
