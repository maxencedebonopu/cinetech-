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

let openclCache: boolean | null = null;
/** Conversion HDR → SDR sur le GPU via OpenCL (≈ 2× plus rapide que zscale sur le CPU). */
export async function detectOpenclTonemap(): Promise<boolean> {
  if (openclCache !== null) return openclCache;
  if (!ffmpegPath) return (openclCache = false);
  openclCache = await new Promise<boolean>((resolve) => {
    const p = spawn(ffmpegPath!, ['-hide_banner', '-loglevel', 'error', '-init_hw_device', 'opencl=ocl', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:d=0.2',
      // L'image de test doit être marquée HDR (PQ / BT.2020), sinon tonemap_opencl refuse l'entrée
      '-filter_hw_device', 'ocl', '-vf', 'setparams=color_trc=smpte2084:color_primaries=bt2020:colorspace=bt2020nc,format=p010,hwupload,tonemap_opencl=tonemap=hable:format=nv12:t=bt709:m=bt709:p=bt709,hwdownload,format=nv12', '-f', 'null', '-'], { windowsHide: true });
    const t = setTimeout(() => { p.kill(); resolve(false); }, 10000);
    p.on('close', (code) => { clearTimeout(t); resolve(code === 0); });
    p.on('error', () => { clearTimeout(t); resolve(false); });
  });
  return openclCache;
}

/** Marqueur ajouté à la ligne de commande de nos ffmpeg, pour retrouver les orphelins. */
export const FFMPEG_TAG = ['-metadata', 'comment=cinematheque'];

/**
 * Si le serveur a été fermé brutalement (fenêtre fermée), Windows laisse tourner les ffmpeg enfants.
 * Au démarrage, on arrête ceux qui portent notre marqueur.
 */
export function killOrphanFfmpeg(): number {
  if (process.platform !== 'win32') return 0;
  // Seuls les vrais orphelins : ffmpeg marqués dont le process parent n'existe plus
  // (un autre serveur Cinémathèque encore en marche garde ses séances).
  const ps = `$all = Get-CimInstance Win32_Process; $ids = @{}; $all | ForEach-Object { $ids[[int]$_.ProcessId] = $true }; ` +
    `$all | Where-Object { $_.Name -eq 'ffmpeg.exe' -and $_.CommandLine -like '*comment=cinematheque*' -and -not $ids[[int]$_.ParentProcessId] } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force; 1 }`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  return (r.stdout ?? '').split(/\r?\n/).filter((l) => l.trim() === '1').length;
}

/** Lance un binaire et renvoie stdout (Buffer). */
export function run(bin: string, args: string[], opts: { timeoutMs?: number; lowPriority?: boolean } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    if (opts.lowPriority && p.pid) { try { os.setPriority(p.pid, os.constants.priority.PRIORITY_LOW); } catch { /* sans importance */ } }
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
