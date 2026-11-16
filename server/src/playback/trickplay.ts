// Vignettes de prévisualisation (planches sprite) pour le survol de la barre de lecture.
import fs from 'node:fs';
import path from 'node:path';
import type { TrickplayInfo } from '@cine/shared';
import { db, json } from '../db.ts';
import { paths } from '../config.ts';
import { ffmpegPath, run, FFMPEG_TAG } from '../tools/ffmpeg.ts';
import { activeStreamCount } from './sessions.ts';

const W = 240;
const COLS = 10;
const ROWS = 10;

const dirOf = (movieId: number) => path.join(paths.cache, 'trickplay', `m${movieId}`);

export function getTrickplay(movieId: number): TrickplayInfo | null {
  const manifest = path.join(dirOf(movieId), 'manifest.json');
  if (!fs.existsSync(manifest)) return null;
  const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  return { ...m, sheets: m.sheets.map((s: string) => `/api/movies/${movieId}/trickplay/${s}`) };
}

export function trickplayFile(movieId: number, name: string) {
  if (!/^sheet\d+\.jpg$/.test(name)) return null;
  const p = path.join(dirOf(movieId), name);
  return fs.existsSync(p) ? p : null;
}

async function generate(movieId: number, file: string, duration: number, height: number, width: number) {
  const interval = duration > 3 * 3600 ? 20 : 10;
  const h = Math.round(((W * height) / width) / 2) * 2;
  const dir = dirOf(movieId);
  fs.mkdirSync(dir, { recursive: true });
  // Décodage des seules images-clés : 10 à 30× plus rapide qu'un décodage complet
  await run(ffmpegPath!, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-skip_frame', 'nokey', '-i', file, '-an', '-sn', '-dn',
    '-vf', `fps=1/${interval},scale=${W}:${h}:flags=bilinear,tile=${COLS}x${ROWS}`, '-fps_mode', 'vfr', '-q:v', '5', ...FFMPEG_TAG,
    path.join(dir, 'sheet%03d.jpg'),
  ], { timeoutMs: 15 * 60_000, lowPriority: true });
  const sheets = fs.readdirSync(dir).filter((f) => /^sheet\d+\.jpg$/.test(f)).sort();
  const info = { interval, width: W, height: h, columns: COLS, rows: ROWS, count: Math.ceil(duration / interval), sheets };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(info));
}

let running = false;
/** File d'attente en tâche de fond : un film à la fois, après le scan. */
export async function generateMissingTrickplay(log: (m: string) => void) {
  if (running || !ffmpegPath) return;
  running = true;
  try {
    const rows = db.prepare(`SELECT id, file_path, media FROM movies WHERE missing = 0 AND media IS NOT NULL ORDER BY added_at DESC`).all() as any[];
    for (const r of rows) {
      if (getTrickplay(r.id)) continue;
      const media = json.parse<any>(r.media, null);
      if (!media?.video || !media.duration) continue;
      // Pas de calcul pendant une séance : le processeur est réservé à la lecture
      while (activeStreamCount() > 0) await new Promise((r) => setTimeout(r, 10_000));
      const t = Date.now();
      try {
        await generate(r.id, r.file_path, media.duration, media.video.height, media.video.width);
        log(`Vignettes : ${path.basename(r.file_path)} (${((Date.now() - t) / 1000).toFixed(0)} s)`);
      } catch (e) {
        fs.rmSync(dirOf(r.id), { recursive: true, force: true });
        log(`Vignettes impossibles : ${path.basename(r.file_path)} — ${(e as Error).message}`);
      }
    }
  } finally { running = false; }
}
