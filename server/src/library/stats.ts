// Statistiques : registre des séances (sur une année ou depuis le début) et état de la collection.
import type { Stats, Count, MediaInfo } from '@cine/shared';
import { db, json } from '../db.ts';
import { langName } from './repo.ts';

const MIN_SESSION = 60; // une séance de moins d'une minute ne compte pas

const local = (sqlUtc: string) => new Date(sqlUtc.replace(' ', 'T') + 'Z');
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function tally(values: Iterable<string>, weight: (v: string) => number = () => 1): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + weight(v));
  return m;
}
const ranked = (m: Map<string, number>, limit = Infinity): Count[] =>
  [...m].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr')).slice(0, limit);

const decadeOf = (y: number | null) => (y ? `${Math.floor(y / 10) * 10}` : null);

function definition(w: number, h: number) {
  if (w >= 3200 || h >= 2000) return '4K';
  if (w >= 1800 || h >= 1000) return '1080p';
  if (w >= 1200 || h >= 700) return '720p';
  return 'SD';
}
const CODECS: Record<string, string> = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', mpeg4: 'MPEG-4', vp9: 'VP9', mpeg2video: 'MPEG-2' };
const channels = (n: number) => (n >= 8 ? '7.1' : n >= 6 ? '5.1' : n === 2 ? 'Stéréo' : n === 1 ? 'Mono' : `${n} canaux`);

function hm(seconds: number) {
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

export function computeStats(year: number | null): Stats {
  const movies = db.prepare(`SELECT m.id, m.title, m.parsed_title, m.year, m.parsed_year, m.genres, m.directors, m.countries, m.media, m.file_size, m.tmdb_id,
      u.watched, u.rating FROM movies m LEFT JOIN user_data u ON u.movie_id = m.id WHERE m.missing = 0`).all() as any[];
  const byId = new Map(movies.map((m) => [m.id, m]));
  const yearOf = (m: any): number | null => m.year ?? m.parsed_year ?? null;

  const allPlays = (db.prepare(`SELECT movie_id, started_at, seconds FROM plays WHERE seconds >= ? ORDER BY started_at`).all(MIN_SESSION) as any[])
    .filter((p) => byId.has(p.movie_id))
    .map((p) => ({ movieId: p.movie_id as number, at: local(p.started_at), startedAt: local(p.started_at).toISOString(), seconds: p.seconds as number }));
  const years = [...new Set(allPlays.map((p) => p.at.getFullYear()))].sort((a, b) => b - a);
  const plays = year == null ? allPlays : allPlays.filter((p) => p.at.getFullYear() === year);

  // ----- Registre -----
  const daily: Record<string, number> = {};
  const byHour = Array(24).fill(0), byWeekday = Array(7).fill(0);
  const perMovie = new Map<number, { sessions: number; seconds: number }>();
  for (const p of plays) {
    const k = dayKey(p.at);
    daily[k] = (daily[k] ?? 0) + p.seconds / 60;
    byHour[p.at.getHours()] += p.seconds;
    byWeekday[(p.at.getDay() + 6) % 7] += p.seconds;
    const e = perMovie.get(p.movieId) ?? { sessions: 0, seconds: 0 };
    e.sessions++; e.seconds += p.seconds;
    perMovie.set(p.movieId, e);
  }
  for (const k in daily) daily[k] = Math.round(daily[k]);

  const dayList = Object.keys(daily).sort();
  let longestStreak = 0, run = 0, prev = 0;
  for (const k of dayList) {
    const t = new Date(`${k}T12:00:00`).getTime();
    run = prev && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prev = t;
  }

  const seenIds = [...perMovie.keys()];
  const seen = seenIds.map((id) => byId.get(id));
  const viewing = {
    seconds: plays.reduce((s, p) => s + p.seconds, 0),
    sessions: plays.length,
    films: perMovie.size,
    days: dayList.length,
    longestStreak,
    daily,
    byHour: byHour.map(Math.round),
    byWeekday: byWeekday.map(Math.round),
    top: [...perMovie].map(([movieId, e]) => ({ movieId, sessions: e.sessions, seconds: Math.round(e.seconds) }))
      .sort((a, b) => b.sessions - a.sessions || b.seconds - a.seconds).slice(0, 8),
    decades: [] as Count[], // secondes par décennie, calculées juste après
    genres: ranked(tally(seen.flatMap((m) => json.parse<string[]>(m.genres, []))), 8),
    directors: ranked(tally(seen.flatMap((m) => json.parse<string[]>(m.directors, []))), 8),
    journal: plays.slice(-12).reverse().map((p) => ({ movieId: p.movieId, startedAt: p.startedAt, seconds: Math.round(p.seconds) })),
  };
  const decadeSeconds = new Map<string, number>();
  for (const [id, e] of perMovie) {
    const d = decadeOf(yearOf(byId.get(id)));
    if (d) decadeSeconds.set(d, (decadeSeconds.get(d) ?? 0) + Math.round(e.seconds));
  }
  viewing.decades = [...decadeSeconds].map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label));

  // ----- Collection -----
  const media = movies.map((m) => ({ m, info: json.parse<MediaInfo | null>(m.media, null) }));
  const withInfo = media.filter((x) => x.info);
  const decadeMap = new Map<string, { count: number; watched: number }>();
  for (const m of movies) {
    const d = decadeOf(yearOf(m));
    if (!d) continue;
    const e = decadeMap.get(d) ?? { count: 0, watched: 0 };
    e.count++; if (m.watched) e.watched++;
    decadeMap.set(d, e);
  }

  const subRows = db.prepare(`SELECT DISTINCT s.movie_id, s.language FROM subtitles s JOIN movies m ON m.id = s.movie_id WHERE m.missing = 0`).all() as any[];
  const subsByLang = tally(subRows.map((r) => langName(r.language)));
  const withSubs = new Set(subRows.map((r) => r.movie_id));

  const records: Stats['collection']['records'] = [];
  const pick = <T>(arr: T[], f: (x: T) => number) => arr.reduce<T | null>((b, x) => (b == null || f(x) > f(b) ? x : b), null);
  const longest = pick(withInfo, (x) => x.info!.duration);
  if (longest) records.push({ label: 'Le plus long', movieId: longest.m.id, value: hm(longest.info!.duration) });
  const shortest = pick(withInfo, (x) => -x.info!.duration);
  if (shortest && shortest !== longest) records.push({ label: 'Le plus court', movieId: shortest.m.id, value: hm(shortest.info!.duration) });
  const dated = movies.filter((m) => yearOf(m));
  const oldest = pick(dated, (m) => -yearOf(m)!);
  if (oldest) records.push({ label: 'Le plus ancien', movieId: oldest.id, value: String(yearOf(oldest)) });
  const newest = pick(dated, (m) => yearOf(m)!);
  if (newest && newest !== oldest) records.push({ label: 'Le plus récent', movieId: newest.id, value: String(yearOf(newest)) });
  const heaviest = pick(movies, (m) => m.file_size);
  if (heaviest) records.push({ label: 'Le plus lourd', movieId: heaviest.id, value: `${(heaviest.file_size / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` });

  const collection = {
    films: movies.length,
    matched: movies.filter((m) => m.tmdb_id).length,
    watched: movies.filter((m) => m.watched).length,
    sizeBytes: movies.reduce((s, m) => s + m.file_size, 0),
    durationSeconds: Math.round(withInfo.reduce((s, x) => s + x.info!.duration, 0)),
    decades: [...decadeMap].map(([label, e]) => ({ label, ...e })).sort((a, b) => a.label.localeCompare(b.label)),
    resolution: ranked(tally(withInfo.filter((x) => x.info!.video).map((x) => definition(x.info!.video!.width, x.info!.video!.height)))),
    dynamicRange: ranked(tally(withInfo.filter((x) => x.info!.video).map((x) => (x.info!.video!.hdr === 'DV' ? 'Dolby Vision' : x.info!.video!.hdr)))),
    videoCodecs: ranked(tally(withInfo.filter((x) => x.info!.video).map((x) => CODECS[x.info!.video!.codec] ?? x.info!.video!.codec.toUpperCase()))),
    audio: ranked(tally(withInfo.filter((x) => x.info!.audio.length).map((x) => channels(Math.max(...x.info!.audio.map((a) => a.channels)))))),
    subtitles: ranked(subsByLang, 8),
    withoutSubtitles: movies.filter((m) => !withSubs.has(m.id)).length,
    genres: ranked(tally(movies.flatMap((m) => json.parse<string[]>(m.genres, []))), 10),
    countries: ranked(tally(movies.flatMap((m) => json.parse<string[]>(m.countries, []))), 8),
    records,
  };

  const ratings = [0, 0, 0, 0, 0];
  for (const m of movies) if (m.rating) ratings[Math.min(5, Math.max(1, Math.round(m.rating))) - 1]++;

  return { years, year, viewing, collection, ratings };
}
