// Photogrammes de repli : une image représentative extraite du film, pour les fiches sans fond TMDB
// (et comme source de palette tant que l'affiche manque).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { ImageRef, MediaInfo } from '@cine/shared';
import { paths } from '../config.ts';
import { db, json } from '../db.ts';
import { ffmpegPath, run, FFMPEG_TAG } from '../tools/ffmpeg.ts';
import { storeImage, extractPalette } from '../metadata/images.ts';
import { TONEMAP_CPU } from '../playback/sessions.ts';

async function frameAt(file: string, at: number, filters: string) {
  return run(ffmpegPath!, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', at.toFixed(1), '-i', file, '-an', '-sn', '-dn',
    '-vf', filters, '-frames:v', '1', ...FFMPEG_TAG, '-f', 'image2pipe', '-c:v', 'png', '-',
  ], { timeoutMs: 90_000, lowPriority: true });
}

/** Retire les bandes noires incrustées (film 2,39 dans un cadre 16:9) sans rogner une scène sombre. */
async function trimBars(png: Buffer) {
  const meta = await sharp(png).metadata();
  const { data, info } = await sharp(png).trim({ background: '#000000', threshold: 18 }).toBuffer({ resolveWithObject: true });
  const kept = (info.width * info.height) / ((meta.width ?? 1) * (meta.height ?? 1));
  return kept > 0.6 && kept < 0.995 ? data : png;
}

/** Intérêt d'une image : détail (entropie, contraste) pénalisé si elle est trop sombre ou délavée. */
async function score(png: Buffer) {
  const st = await sharp(png).greyscale().stats();
  const { mean, stdev } = st.channels[0];
  const exposure = mean < 30 ? 0.25 : mean < 55 ? 0.7 : mean > 205 ? 0.5 : 1;
  return (st.entropy * 12 + stdev) * exposure;
}

export async function makeStill(movieId: number, file: string, media: MediaInfo) {
  const v = media.video!;
  const filters = [
    v.hdr !== 'SDR' ? TONEMAP_CPU : null,
    // « thumbnail » choisit l'image la plus représentative sur ~2 s : évite les fondus au noir
    'thumbnail=48',
    `scale=${Math.min(1920, v.width)}:-2:flags=lanczos`,
    'format=rgb24',
  ].filter(Boolean).join(',');
  // Quatre candidats répartis dans le film ; on garde le plus parlant
  let best: { png: Buffer; s: number } | null = null;
  for (const f of [0.22, 0.37, 0.51, 0.64]) {
    try {
      const png = await frameAt(file, media.duration * f, filters);
      const s = await score(png);
      if (!best || s > best.s) best = { png, s };
    } catch { /* candidat suivant */ }
  }
  if (!best) throw new Error('aucune image extraite');
  best.png = await trimBars(best.png);
  const ref = await storeImage(best.png, `still-m${movieId}-${Date.now().toString(36)}`, 'backdrop');
  const palette = await extractPalette(best.png);
  const old = json.parse<ImageRef | null>((db.prepare(`SELECT still FROM movies WHERE id = ?`).get(movieId) as any)?.still, null);
  db.prepare(`UPDATE movies SET still = ?, still_palette = ? WHERE id = ?`).run(JSON.stringify(ref), JSON.stringify(palette), movieId);
  // Nom versionné (cache navigateur immuable) : on supprime l'ancienne série
  if (old && old.base !== ref.base) for (const w of old.widths) fs.rmSync(path.join(paths.images, `${old.base}-${w}.webp`), { force: true });
  return ref;
}

/** Tâche de fond : un photogramme pour chaque film qui n'en a pas encore. */
export async function generateMissingStills(log: (m: string) => void) {
  if (!ffmpegPath) return;
  const rows = db.prepare(`SELECT id, file_path, media FROM movies WHERE missing = 0 AND media IS NOT NULL AND still IS NULL`).all() as any[];
  let ok = 0;
  for (const r of rows) {
    const media = json.parse<MediaInfo | null>(r.media, null);
    if (!media?.video || !media.duration) continue;
    try { await makeStill(r.id, r.file_path, media); ok++; }
    catch (e) { log(`Photogramme impossible : ${path.basename(r.file_path)} — ${(e as Error).message}`); }
  }
  if (ok) log(`Photogrammes : ${ok} extrait(s)`);
}
