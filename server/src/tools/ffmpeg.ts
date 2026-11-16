// Localisation de ffmpeg/ffprobe et détection de l'encodage matériel.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { config } from '../config.ts';

function onPath(bin: string): string | null {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.split(/\r?\n/)[0].trim() || null;
  return null;
}

function wingetLocation(bin: string): string | null {
  const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(base)) return null;
  for (const pkg of fs.readdirSync(base).filter((d) => /ffmpeg/i.test(d))) {
    const pkgDir = path.join(base, pkg);
    for (const sub of fs.readdirSync(pkgDir)) {
      const candidate = path.join(pkgDir, sub, 'bin', `${bin}.exe`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function locate(bin: 'ffmpeg' | 'ffprobe', explicit: string): string | null {
  if (explicit && fs.existsSync(explicit)) return explicit;
  return onPath(bin) ?? wingetLocation(bin);
}

export const ffmpegPath = locate('ffmpeg', config.ffmpegPath);
export const ffprobePath = locate('ffprobe', config.ffprobePath);

export type HwEncoder = 'h264_nvenc' | 'h264_qsv' | 'h264_amf';
let hwCache: HwEncoder[] | null = null;

/** Teste réellement chaque encodeur matériel (un encodeur compilé n'est pas forcément utilisable). */
export async function detectHwEncoders(): Promise<HwEncoder[]> {
  if (hwCache) return hwCache;
  if (!ffmpegPath) return (hwCache = []);
  const ok: HwEncoder[] = [];
  for (const enc of ['h264_nvenc', 'h264_qsv', 'h264_amf'] as HwEncoder[]) {
    const works = await new Promise<boolean>((resolve) => {
      const p = spawn(ffmpegPath!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'nullsrc=s=256x256:d=0.2', '-c:v', enc, '-f', 'null', '-']);
      const t = setTimeout(() => { p.kill(); resolve(false); }, 8000);
      p.on('close', (code) => { clearTimeout(t); resolve(code === 0); });
      p.on('error', () => { clearTimeout(t); resolve(false); });
    });
    if (works) ok.push(enc);
  }
  return (hwCache = ok);
}

/** Lance un binaire et renvoie stdout (Buffer). */
export function run(bin: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    const out: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    const t = opts.timeoutMs ? setTimeout(() => p.kill('SIGKILL'), opts.timeoutMs) : null;
    p.on('error', reject);
    p.on('close', (code) => {
      if (t) clearTimeout(t);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${path.basename(bin)} a échoué (code ${code}) : ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}
