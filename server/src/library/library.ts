// Orchestration de la bibliothèque : scan, analyse, association des sous-titres, métadonnées, surveillance.
import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { LibraryStatus } from '@cine/shared';
import { db, getSettings, json } from '../db.ts';
import { VIDEO_EXT, SUB_EXT } from '../config.ts';
import { parseName, parseSubtitleName, similarity, normalizeTitle } from './parse.ts';
import { probe } from './probe.ts';
import { readExternal, detectLanguage } from './subtitles.ts';
import { ffprobePath } from '../tools/ffmpeg.ts';
import { tmdbEnabled, autoMatch, getMovie, type MovieMetadata } from '../metadata/tmdb.ts';
import { wikiFind, wikiMovie, wikiImage } from '../metadata/wiki.ts';
import { fetchBuffer, storeImage, extractPalette } from '../metadata/images.ts';

type Log = (msg: string) => void;
let log: Log = (m) => console.log(m);
export function setLogger(l: Log) { log = l; }

const status: Omit<LibraryStatus, 'movies' | 'needsReview' | 'orphanSubtitles'> = {
  scanning: false, phase: 'idle', done: 0, total: 0, lastScanAt: null,
};

export function getStatus(): LibraryStatus {
  const c = db.prepare(`SELECT
      (SELECT COUNT(*) FROM movies WHERE missing = 0) AS movies,
      (SELECT COUNT(*) FROM movies WHERE missing = 0 AND match_status IN ('review','unmatched')) AS needsReview,
      (SELECT COUNT(*) FROM subtitles WHERE source = 'external' AND movie_id IS NULL) AS orphans`).get() as any;
  return { ...status, movies: c.movies, needsReview: c.needsReview, orphanSubtitles: c.orphans };
}

// ---------- Parcours des dossiers ----------

function walk(dir: string, out: { videos: string[]; subs: string[] }) {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || /^(\$RECYCLE\.BIN|System Volume Information)$/i.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, out); continue; }
    const ext = path.extname(e.name).toLowerCase();
    if (VIDEO_EXT.has(ext) && !/\bsample\b/i.test(e.name)) out.videos.push(full);
    else if (SUB_EXT.has(ext)) out.subs.push(full);
  }
}

// ---------- Étapes ----------

function syncFiles(videos: string[], subs: string[]) {
  const existing = new Map((db.prepare('SELECT id, file_path, file_size, file_mtime, missing FROM movies').all() as any[]).map((r) => [r.file_path, r]));
  const seen = new Set<string>();
  const insert = db.prepare(`INSERT INTO movies (file_path, file_size, file_mtime, parsed_title, parsed_year, parsed_edition) VALUES (?, ?, ?, ?, ?, ?)`);
  const touch = db.prepare(`UPDATE movies SET file_size = ?, file_mtime = ?, missing = 0, updated_at = datetime('now') WHERE id = ?`);
  const relocate = db.prepare(`UPDATE movies SET file_path = ?, file_mtime = ?, missing = 0, updated_at = datetime('now') WHERE id = ?`);
  let added = 0;

  db.transaction(() => {
    for (const f of videos) {
      const st = fs.statSync(f);
      seen.add(f);
      const row = existing.get(f);
      if (row) {
        if (row.file_size !== st.size || row.file_mtime !== Math.floor(st.mtimeMs) || row.missing) touch.run(st.size, Math.floor(st.mtimeMs), row.id);
        continue;
      }
      // Fichier déplacé ou renommé : même taille qu'un film disparu → on garde la fiche et l'historique
      const moved = [...existing.values()].find((r) => !videos.includes(r.file_path) && r.file_size === st.size);
      if (moved) { relocate.run(f, Math.floor(st.mtimeMs), moved.id); existing.delete(moved.file_path); continue; }
      const p = parseName(path.basename(f));
      insert.run(f, st.size, Math.floor(st.mtimeMs), p.title, p.year, p.edition);
      added++;
    }
    for (const r of existing.values()) if (!seen.has(r.file_path) && !r.missing) db.prepare('UPDATE movies SET missing = 1 WHERE id = ?').run(r.id);
  })();

  // Sous-titres externes
  const subRows = new Map((db.prepare(`SELECT id, key, file_mtime FROM subtitles WHERE source = 'external'`).all() as any[]).map((r) => [r.key, r]));
  const insSub = db.prepare(`INSERT INTO subtitles (key, source, path, codec, language, language_source, forced, sdh, encoding, guess_title, guess_year, file_mtime)
    VALUES (@key, 'external', @path, @codec, @language, @languageSource, @forced, @sdh, @encoding, @guessTitle, @guessYear, @mtime)
    ON CONFLICT(key) DO UPDATE SET language = CASE WHEN subtitles.language_source = 'manual' THEN subtitles.language ELSE excluded.language END,
      language_source = CASE WHEN subtitles.language_source = 'manual' THEN 'manual' ELSE excluded.language_source END,
      forced = excluded.forced, sdh = excluded.sdh, encoding = excluded.encoding, guess_title = excluded.guess_title, guess_year = excluded.guess_year, file_mtime = excluded.file_mtime`);
  const subSeen = new Set<string>();
  for (const f of subs) {
    subSeen.add(f);
    const mtime = Math.floor(fs.statSync(f).mtimeMs);
    if (subRows.get(f)?.file_mtime === mtime) continue;
    const p = parseSubtitleName(path.basename(f));
    let language = p.language;
    let languageSource: string | null = language ? 'filename' : null;
    let encoding: string | null = null;
    try {
      const { text, encoding: enc } = readExternal(f);
      encoding = enc;
      const detected = detectLanguage(text);
      // Le contenu fait foi : les noms de fichiers mentent souvent (« [Eng]-aXXo.FR »)
      if (detected) { language = detected; languageSource = 'content'; }
    } catch (e) { log(`Sous-titre illisible : ${f} (${(e as Error).message})`); }
    insSub.run({
      key: f, path: f, codec: path.extname(f).slice(1).toLowerCase(), language, languageSource,
      forced: p.forced ? 1 : 0, sdh: p.sdh ? 1 : 0, encoding, guessTitle: p.title, guessYear: p.year, mtime,
    });
  }
  for (const r of subRows.values()) if (!subSeen.has(r.key)) db.prepare('DELETE FROM subtitles WHERE id = ?').run(r.id);
  return added;
}

async function probeAll() {
  if (!ffprobePath) { log('ffprobe introuvable : analyse technique ignorée.'); return; }
  const todo = db.prepare(`SELECT id, file_path, file_mtime FROM movies WHERE missing = 0 AND (probed_mtime IS NULL OR probed_mtime != file_mtime)`).all() as any[];
  status.phase = 'analyse'; status.done = 0; status.total = todo.length;
  const save = db.prepare(`UPDATE movies SET media = ?, probed_mtime = ? WHERE id = ?`);
  const delEmb = db.prepare(`DELETE FROM subtitles WHERE movie_id = ? AND source = 'embedded'`);
  const insEmb = db.prepare(`INSERT OR REPLACE INTO subtitles (key, source, movie_id, stream_index, codec, text_based, language, language_source, forced, sdh, title, match_method)
    VALUES (?, 'embedded', ?, ?, ?, ?, ?, 'stream', ?, ?, ?, 'embedded')`);

  const worker = async () => {
    for (let m = todo.shift(); m; m = todo.shift()) {
      try {
        const r = await probe(m.file_path);
        db.transaction(() => {
          save.run(JSON.stringify(r.media), m.file_mtime, m.id);
          delEmb.run(m.id);
          for (const s of r.subtitles) insEmb.run(`emb:${m.id}:${s.index}`, m.id, s.index, s.codec, s.textBased ? 1 : 0, s.language, s.forced ? 1 : 0, s.sdh ? 1 : 0, s.title);
        })();
      } catch (e) {
        log(`Analyse impossible : ${path.basename(m.file_path)} — ${(e as Error).message}`);
      }
      status.done++;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/** Associe chaque sous-titre externe à un film. Les associations manuelles ne sont jamais modifiées. */
export function matchSubtitles() {
  const movies = db.prepare(`SELECT id, file_path, parsed_title, parsed_year, title, original_title, year FROM movies WHERE missing = 0`).all() as any[];
  const subs = db.prepare(`SELECT id, path, guess_title, guess_year, match_method FROM subtitles WHERE source = 'external' AND (match_method IS NULL OR match_method != 'manual')`).all() as any[];
  const set = db.prepare(`UPDATE subtitles SET movie_id = ?, match_method = ?, match_score = ? WHERE id = ?`);

  db.transaction(() => {
    for (const s of subs) {
      let best: { id: number; method: string; score: number } | null = null;
      const subBase = path.basename(s.path).replace(/\.[^.]+$/, '').toLowerCase();
      for (const m of movies) {
        // 1. Même dossier, même nom de base (« Film.mkv » + « Film.fr.srt »)
        const vidBase = path.basename(m.file_path).replace(/\.[^.]+$/, '').toLowerCase();
        if (path.dirname(m.file_path) === path.dirname(s.path) && subBase.startsWith(vidBase)) {
          best = { id: m.id, method: 'basename', score: 1 };
          break;
        }
        // 2. Titre + année
        const movieYears = [m.year, m.parsed_year].filter(Boolean) as number[];
        if (s.guess_year && movieYears.length && !movieYears.some((y) => Math.abs(y - s.guess_year) <= 1)) continue;
        const titles = [m.parsed_title, m.title, m.original_title].filter(Boolean) as string[];
        const sim = Math.max(...titles.map((t) => similarity(s.guess_title ?? '', t)));
        const needed = s.guess_year ? 0.88 : 0.97; // sans année, on exige un titre quasi identique
        if (sim >= needed && (!best || sim > best.score)) best = { id: m.id, method: sim === 1 ? 'title' : 'fuzzy', score: sim };
      }
      if (best && best.method !== 'basename' && !s.guess_year) {
        // Sans année : refus si plusieurs films portent ce titre
        const norm = normalizeTitle(s.guess_title ?? '');
        const homonyms = movies.filter((m) => [m.parsed_title, m.title].some((t) => t && normalizeTitle(t) === norm));
        if (homonyms.length > 1) best = null;
      }
      set.run(best?.id ?? null, best?.method ?? null, best?.score ?? null, s.id);
    }
  })();
}

/** Récupère et met en cache la fiche TMDB complète d'un film. */
export async function enrichMovie(movieId: number, tmdbId: number, matchStatus: string, score: number | null) {
  await store(movieId, await getMovie(tmdbId), `m${tmdbId}`, matchStatus, score, 'tmdb');
}

/** Fiche Wikidata / Wikipédia (sans clé TMDB) : affiche, synopsis, générique. */
export async function enrichFromWiki(movieId: number, qid: string, matchStatus: string) {
  const meta = await wikiMovie(qid);
  await store(movieId, meta, `w${qid}`, matchStatus, null, 'wiki', qid);
}

async function store(movieId: number, meta: MovieMetadata, base: string, matchStatus: string, score: number | null, source: 'tmdb' | 'wiki', wikidataId: string | null = null) {
  const download = source === 'wiki' ? wikiImage : fetchBuffer;
  const get = (url: string | null) => (url ? download(url).catch((e) => { log(`Image : ${(e as Error).message}`); return null; }) : null);
  const [poster, backdrop, logo] = await Promise.all([get(meta.posterUrl), get(meta.backdropUrl), get(meta.logoUrl)]);
  const posterRef = poster ? await storeImage(poster, `${base}-poster`, 'poster') : null;
  const backdropRef = backdrop ? await storeImage(backdrop, `${base}-backdrop`, 'backdrop') : null;
  const logoRef = logo ? await storeImage(logo, `${base}-logo`, 'logo') : null;
  const palette = poster ? await extractPalette(poster) : null;
  // Titre affiché : celui du nom de fichier, jamais la traduction de la fiche (« Psycho », pas « Psychose »)
  const fileTitle = (db.prepare('SELECT parsed_title FROM movies WHERE id = ?').get(movieId) as { parsed_title: string | null } | undefined)?.parsed_title;

  db.prepare(`UPDATE movies SET tmdb_id = ?, match_status = ?, match_score = ?, title = ?, original_title = ?, year = ?, release_date = ?, overview = ?, tagline = ?,
      runtime = ?, original_language = ?, genres = ?, countries = ?, directors = ?, cast_json = ?, crew_json = ?, poster = ?, backdrop = ?, logo = ?, palette = ?,
      meta_source = ?, wikidata_id = ?, updated_at = datetime('now')
    WHERE id = ?`).run(
    source === 'tmdb' ? meta.tmdbId : null, matchStatus, score, fileTitle || meta.title, meta.originalTitle, meta.year, meta.releaseDate, meta.overview || null, meta.tagline || null,
    meta.runtime, meta.originalLanguage || null, JSON.stringify(meta.genres), JSON.stringify(meta.countries), JSON.stringify(meta.directors),
    JSON.stringify(meta.cast), JSON.stringify(meta.crew), json_(posterRef), json_(backdropRef), json_(logoRef), json_(palette),
    source, wikidataId, movieId,
  );
}
const json_ = (v: unknown) => (v ? JSON.stringify(v) : null);

async function fetchMetadata() {
  if (!tmdbEnabled()) return fetchWikiMetadata();
  // avec une clé : les films en attente, et ceux qui n'ont qu'une fiche Wikipédia
  const todo = db.prepare(`SELECT id, parsed_title, parsed_year FROM movies WHERE missing = 0 AND (match_status = 'pending' OR (meta_source = 'wiki' AND match_status != 'manual'))`).all() as any[];
  status.phase = 'métadonnées'; status.done = 0; status.total = todo.length;
  const worker = async () => {
    for (let m = todo.shift(); m; m = todo.shift()) {
      try {
        const best = await autoMatch(m.parsed_title, m.parsed_year);
        if (!best || best.score < 0.55) {
          db.prepare(`UPDATE movies SET match_status = CASE WHEN meta_source = 'wiki' THEN match_status ELSE 'unmatched' END, match_score = ? WHERE id = ?`).run(best?.score ?? null, m.id);
          log(`Aucune correspondance sûre : ${m.parsed_title} (${m.parsed_year ?? '?'})`);
        } else {
          await enrichMovie(m.id, best.id, best.score >= 0.75 ? 'matched' : 'review', best.score);
        }
      } catch (e) {
        log(`TMDB — ${m.parsed_title} : ${(e as Error).message}`);
      }
      status.done++;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/** Sans clé TMDB : Wikidata / Wikipédia, un film à la fois (débit limité par Wikimédia). */
async function fetchWikiMetadata() {
  const todo = db.prepare(`SELECT id, parsed_title, parsed_year FROM movies WHERE missing = 0 AND match_status = 'pending'`).all() as any[];
  if (!todo.length) return;
  log(`Pas de clé TMDB : fiches Wikipédia pour ${todo.length} film${todo.length > 1 ? 's' : ''}.`);
  status.phase = 'métadonnées'; status.done = 0; status.total = todo.length;
  for (const m of todo) {
    try {
      const qid = await wikiFind(m.parsed_title, m.parsed_year);
      if (!qid) {
        db.prepare(`UPDATE movies SET match_status = 'unmatched' WHERE id = ?`).run(m.id);
        log(`Wikipédia — introuvable : ${m.parsed_title} (${m.parsed_year ?? '?'})`);
      } else {
        await enrichFromWiki(m.id, qid, m.parsed_year ? 'matched' : 'review');
      }
    } catch (e) {
      log(`Wikipédia — ${m.parsed_title} : ${(e as Error).message}`); // reste en attente, repris au prochain scan
    }
    status.done++;
  }
}

// ---------- Scan complet ----------

let running: Promise<void> | null = null;
let rescanRequested = false;

export function scan(): Promise<void> {
  if (running) { rescanRequested = true; return running; }
  running = (async () => {
    status.scanning = true;
    try {
      do {
        rescanRequested = false;
        const dirs = getSettings().libraryDirs.filter((d) => fs.existsSync(d));
        status.phase = 'fichiers'; status.done = 0; status.total = 0;
        const files = { videos: [] as string[], subs: [] as string[] };
        for (const d of dirs) walk(d, files);
        const added = syncFiles(files.videos, files.subs);
        log(`Scan : ${files.videos.length} vidéos, ${files.subs.length} sous-titres (${added} nouveaux films).`);
        await probeAll();
        await fetchMetadata();
        matchSubtitles();
      } while (rescanRequested);
      status.lastScanAt = new Date().toISOString();
    } finally {
      status.scanning = false; status.phase = 'idle';
      running = null;
    }
  })();
  return running;
}

// ---------- Surveillance ----------

let watcher: FSWatcher | null = null;
let debounce: NodeJS.Timeout | null = null;

export function watch() {
  watcher?.close();
  const dirs = getSettings().libraryDirs.filter((d) => fs.existsSync(d));
  if (!dirs.length) return;
  watcher = chokidar.watch(dirs, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 1000 }, // attend la fin des copies
    ignored: (p, stats) => !!stats?.isFile() && !VIDEO_EXT.has(path.extname(p).toLowerCase()) && !SUB_EXT.has(path.extname(p).toLowerCase()),
  });
  const trigger = (evt: string, p: string) => {
    log(`Changement détecté (${evt}) : ${path.basename(p)}`);
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void scan(), 3000);
  };
  watcher.on('add', (p) => trigger('ajout', p)).on('unlink', (p) => trigger('suppression', p)).on('change', (p) => trigger('modification', p));
}

export async function stopWatching() {
  await watcher?.close();
}

export { json };
