import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');

function resolveFromRoot(p: string) {
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

export const config = {
  port: Number(process.env.PORT || 8765),
  tmdbKey: (process.env.TMDB_KEY || '').trim(),
  tmdbLanguage: process.env.TMDB_LANGUAGE || 'fr-FR',
  /** Mot de passe de l'accès distant (repli si aucun n'est défini dans Réglages). */
  password: (process.env.MOT_DE_PASSE || '').trim(),
  initialLibraryDirs: (process.env.LIBRARY_DIRS || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean),
  dataDir: resolveFromRoot(process.env.DATA_DIR || './data'),
  ffmpegPath: process.env.FFMPEG_PATH || '',
  ffprobePath: process.env.FFPROBE_PATH || '',
  webDist: path.join(ROOT, 'web', 'dist'),
};

export const paths = {
  db: path.join(config.dataDir, 'cinematheque.db'),
  images: path.join(config.dataDir, 'images'),
  cache: path.join(config.dataDir, 'cache'),
  transcode: path.join(config.dataDir, 'transcode'),
};

for (const dir of [config.dataDir, paths.images, paths.cache, paths.transcode]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const VIDEO_EXT = new Set(['.mkv', '.mp4', '.m4v', '.avi', '.mov', '.webm', '.ts', '.m2ts', '.wmv', '.mpg', '.mpeg']);
export const SUB_EXT = new Set(['.srt', '.vtt', '.ass', '.ssa']);
