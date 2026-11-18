// Sessions de lecture : un process ffmpeg par flux HLS (fMP4), relancé au bon offset lors d'un seek.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import type { MediaInfo, PlaybackMode, PlaybackPlan, PlaybackRequest } from '@cine/shared';
import { paths } from '../config.ts';
import { ffmpegPath, ffprobePath, detectHwEncoders, detectOpenclTonemap, run, FFMPEG_TAG } from '../tools/ffmpeg.ts';
import { decide, type Decision } from './decide.ts';

const SEGMENT = 4;          // durée cible des segments (s)
const KEEP_BEHIND = 300;    // segments conservés derrière la tête de lecture (s)
// Une séance survit à une pause ou à un passage en arrière-plan (téléphone verrouillé, autre appli) :
// à 60 s, le retour dans la lecture tombait sur un flux supprimé.
const IDLE_TIMEOUT = 10 * 60_000;

export interface Session {
  id: string;
  movieId: number;
  mode: PlaybackMode;
  dir: string;
  offset: number;
  duration: number;
  proc: ChildProcess | null;
  exited: boolean;
  error: string | null;
  lastAccess: number;
  position: number;
  watchedCounted: boolean;
  playId: number | null;
  stderr: string;
}

const sessions = new Map<string, Session>();
export const getSession = (id: string) => sessions.get(id);
export const activeStreamCount = () => [...sessions.values()].filter((s) => s.mode !== 'direct' && !s.exited).length;

// ---------- Nettoyage ----------

export function wipeTranscodeDir() {
  for (const e of fs.readdirSync(paths.transcode)) fs.rmSync(path.join(paths.transcode, e), { recursive: true, force: true, maxRetries: 5 });
}

export function stopSession(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  if (s.proc && !s.exited) s.proc.kill('SIGKILL');
  // Windows garde les fichiers verrouillés quelques instants après la fin du process
  setTimeout(() => fs.rm(s.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }, () => {}), 500);
}

export function stopAll() {
  for (const id of [...sessions.keys()]) stopSession(id);
}

setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) if (now - s.lastAccess > IDLE_TIMEOUT) stopSession(s.id);
}, 15_000).unref();

// ---------- Playlist ----------

export interface SegmentInfo { file: string; start: number; duration: number }

export function readSegments(s: Session): SegmentInfo[] {
  const p = path.join(s.dir, 'index.m3u8');
  if (!fs.existsSync(p)) return [];
  const out: SegmentInfo[] = [];
  let t = s.offset;
  let dur = 0;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('#EXTINF:')) dur = parseFloat(line.slice(8));
    else if (line && !line.startsWith('#')) { out.push({ file: line.trim(), start: t, duration: dur }); t += dur; }
  }
  return out;
}

/** Plage disponible (temps du film) et suppression des segments trop anciens. */
export function housekeep(s: Session) {
  const segs = readSegments(s);
  let from = s.offset;
  for (const seg of segs) {
    if (seg.start + seg.duration < s.position - KEEP_BEHIND) {
      const f = path.join(s.dir, seg.file);
      if (fs.existsSync(f)) fs.rmSync(f, { force: true });
      from = seg.start + seg.duration;
    }
  }
  const to = segs.length ? segs[segs.length - 1].start + segs[segs.length - 1].duration : s.offset;
  return { availableFrom: from, availableTo: s.exited && !s.error ? s.duration : to, finished: s.exited && !s.error };
}

// ---------- Construction de la commande ffmpeg ----------

/** Image-clé ≤ t (lecture rapide d'une petite fenêtre du fichier). Le remux doit démarrer sur une image-clé. */
async function keyframeBefore(file: string, t: number): Promise<number> {
  if (t <= 0.5 || !ffprobePath) return 0;
  for (const win of [12, 40, 120]) {
    const from = Math.max(0, t - win);
    try {
      const out = await run(ffprobePath, [
        '-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-read_intervals', `${from.toFixed(3)}%${(t + 0.05).toFixed(3)}`,
        '-show_entries', 'frame=pts_time,best_effort_timestamp_time', '-of', 'csv=p=0', file,
      ], { timeoutMs: 15_000 });
      const times = out.toString().split(/\r?\n/).flatMap((l) => l.split(',')).map(Number).filter((n) => Number.isFinite(n) && n <= t + 0.01);
      if (times.length) return Math.max(...times);
    } catch { /* fenêtre suivante */ }
  }
  return Math.max(0, t - 10);
}

/** Durée de segment pour un remux. Le muxer HLS coupe à la première image-clé après n × hls_time
 *  (cumul depuis le début). Si les images-clés du fichier sont plus espacées que hls_time, il coupe à
 *  CHAQUE image-clé, et deux images-clés collées (Memento, 973,139 s puis 973,181 s) donnent un segment
 *  d'une seule image, à l'horodatage faux : hls.js calait puis sautait à 268 466 s.
 *  Avec hls_time au-dessus de l'écart maximal entre images-clés, ces paires sont fusionnées. */
const gopCache = new Map<string, number>();
async function remuxSegmentTime(file: string, videoIndex: number): Promise<number> {
  const hit = gopCache.get(file);
  if (hit) return hit;
  let gop = 0;
  if (ffprobePath) {
    try {
      // Paquets seulement (pas de décodage) : les drapeaux K des 3 premières minutes
      const out = await run(ffprobePath, ['-v', 'error', '-select_streams', String(videoIndex), '-read_intervals', '%+180',
        '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', file], { timeoutMs: 20_000 });
      const keys = out.toString().split(/\r?\n/).filter((l) => /,K/.test(l)).map((l) => parseFloat(l)).filter(Number.isFinite).sort((a, b) => a - b);
      for (let i = 1; i < keys.length; i++) gop = Math.max(gop, keys[i] - keys[i - 1]);
    } catch { /* valeur par défaut */ }
  }
  const t = Math.min(16, Math.max(SEGMENT, Math.ceil((gop || 10) + 1.5)));
  gopCache.set(file, t);
  return t;
}

/** Cadre des sous-titres image. ffprobe ne le connaît souvent pas pour les PGS : on déduit alors le cadre Blu-ray standard. */
async function subtitleCanvas(file: string, index: number, video: { width: number; height: number }): Promise<{ w: number; h: number } | null> {
  if (!ffprobePath) return null;
  let codec = '';
  try {
    const out = await run(ffprobePath, ['-v', 'error', '-select_streams', String(index), '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', '-i', file], { timeoutMs: 10_000 });
    const [c, w, h] = out.toString().trim().split(',');
    codec = c;
    if (Number(w) && Number(h)) return { w: Number(w), h: Number(h) };
  } catch { /* déduction ci-dessous */ }
  if (codec === 'hdmv_pgs_subtitle') {
    for (const [w, h] of [[3840, 2160], [1920, 1080], [1280, 720]]) if (Math.abs(video.width - w) <= w * 0.07) return { w, h };
  }
  return null;
}

export const TONEMAP_CPU = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';
const TONEMAP_OPENCL = 'format=p010,hwupload,tonemap_opencl=tonemap=hable:desat=0:format=nv12:t=bt709:m=bt709:p=bt709,hwdownload';

async function buildArgs(file: string, media: MediaInfo, d: Decision, start: number) {
  const v = media.video!;
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
  const opencl = d.mode === 'transcode' && d.tonemap && (await detectOpenclTonemap());
  if (opencl) args.push('-init_hw_device', 'opencl=ocl', '-filter_hw_device', 'ocl');
  const TONEMAP = opencl ? TONEMAP_OPENCL : TONEMAP_CPU;
  // Lecture limitée à 4× le temps réel après 60 s d'avance : CPU et disque restent sobres
  args.push('-readrate', '4', '-readrate_initial_burst', '60');
  if (start > 0) args.push('-ss', start.toFixed(3));
  const canvas = d.mode === 'transcode' && d.burnIndex != null ? await subtitleCanvas(file, d.burnIndex, v) : null;
  // Sans cadre explicite, ffmpeg dessine les sous-titres dans un cadre de la taille de la vidéo et coupe ceux du bas
  if (canvas) args.push('-canvas_size', `${canvas.w}x${canvas.h}`);
  args.push('-i', file);

  let encoder: string | null = null;
  let videoLabel: string;

  if (d.mode === 'remux') {
    args.push('-map', `0:${v.index}`, '-c:v', 'copy');
    if (v.codec === 'hevc') args.push('-tag:v', 'hvc1');
    videoLabel = `${v.codec} ${v.width}×${v.height} → copie`;
  } else {
    const hw = await detectHwEncoders();
    encoder = hw[0] ?? 'libx264';
    const chain: string[] = [];
    if (d.tonemap) chain.push(TONEMAP);
    let filter: string;
    let outW = v.width;
    let outH = v.height;

    if (d.burnIndex != null) {
      const base: string[] = [...chain];
      let subChain = '';
      if (canvas && canvas.h / canvas.w > (v.height / v.width) * 1.04) {
        // Blu-ray recadré (1920×800 dans un cadre PGS 1920×1080) : on restitue le cadre d'origine avec ses bandes noires,
        // sinon les sous-titres placés dans la bande du bas seraient écrasés ou coupés
        base.push(`scale=${canvas.w}:-2`, `pad=${canvas.w}:${canvas.h}:0:(oh-ih)/2:black`);
        outW = canvas.w;
        outH = canvas.h;
      } else if (canvas && (canvas.w !== v.width || canvas.h !== v.height)) {
        // DVD (VobSub 720×576) : le cadre couvre toute l'image, on l'étire aux dimensions de la vidéo
        subChain = `scale=${v.width}:${v.height}`;
      }
      const post: string[] = [];
      if (d.targetHeight && outH > d.targetHeight) { post.push(`scale=-2:${d.targetHeight}`); }
      post.push('format=nv12');
      filter = `[0:${v.index}]${base.length ? base.join(',') : 'null'}[base];[0:${d.burnIndex}]${subChain || 'null'}[sub];[base][sub]overlay=eof_action=pass:repeatlast=0,${post.join(',')}[vout]`;
      args.push('-filter_complex', filter, '-map', '[vout]');
    } else {
      if (d.targetHeight && v.height > d.targetHeight) chain.push(`scale=-2:${d.targetHeight}`);
      chain.push('format=nv12');
      args.push('-map', `0:${v.index}`, '-vf', chain.join(','));
    }
    if (d.targetHeight && outH > d.targetHeight) { outW = Math.round((outW * d.targetHeight) / outH); outH = d.targetHeight; }

    const br = d.videoBitrate ?? 8_000_000;
    if (encoder === 'h264_amf') args.push('-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'vbr_peak', '-b:v', String(br), '-maxrate', String(Math.round(br * 1.5)));
    else if (encoder === 'h264_nvenc') args.push('-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-b:v', String(br), '-maxrate', String(Math.round(br * 1.5)));
    else if (encoder === 'h264_qsv') args.push('-c:v', 'h264_qsv', '-preset', 'faster', '-b:v', String(br), '-maxrate', String(Math.round(br * 1.5)));
    else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-maxrate', String(Math.round(br * 1.5)));
    args.push('-bufsize', String(br * 2), '-profile:v', 'high', '-g', String(Math.round((v.fps ?? 24) * SEGMENT)),
      '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT})`);
    videoLabel = `${v.codec}${d.tonemap ? ` ${v.hdr} → SDR (${opencl ? 'OpenCL' : 'CPU'})` : ''} → h264 ${outW}×${outH} (${encoder.replace('h264_', '').toUpperCase()})`;
  }

  // Audio
  const a = media.audio.find((x) => x.index === d.audioIndex);
  let audioLabel = 'aucun';
  if (a) {
    args.push('-map', `0:${a.index}`);
    if (d.copyAudio) { args.push('-c:a', 'copy'); audioLabel = `${a.codec} ${a.channels}ch → copie`; }
    else {
      args.push('-c:a', 'aac', '-ac', String(d.audioChannels), '-b:a', d.audioChannels === 6 ? '384k' : '192k');
      audioLabel = `${a.codec} ${a.channels}ch → aac ${d.audioChannels === 6 ? '5.1' : 'stéréo'}`;
    }
  }

  args.push('-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1', ...FFMPEG_TAG, '-max_muxing_queue_size', '2048',
    '-f', 'hls', '-hls_time', String(d.mode === 'remux' ? await remuxSegmentTime(file, v.index) : SEGMENT), '-hls_init_time', '2', '-hls_playlist_type', 'event', '-hls_list_size', '0',
    '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
    // Chemins relatifs : ffmpeg tourne dans le dossier de la session (sinon init.mp4 atterrit dans le dossier courant)
    '-hls_segment_filename', 'seg%05d.m4s',
    '-hls_flags', 'independent_segments+temp_file',
    'index.m3u8');
  return { args, encoder, videoLabel, audioLabel };
}

// ---------- Démarrage ----------

export async function startSession(movie: { id: number; file_path: string; media: MediaInfo }, req: PlaybackRequest): Promise<{ session: Session; plan: PlaybackPlan }> {
  if (req.replaceSessionId) stopSession(req.replaceSessionId);
  const media = movie.media;
  const d = decide(media, req.caps, { quality: req.quality, audioIndex: req.audioIndex, burnIndex: req.burnSubtitleId != null ? req.burnSubtitleId : null });
  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(paths.transcode, id);
  const start = Math.max(0, Math.min(req.start || 0, Math.max(0, media.duration - 5)));

  const session: Session = {
    id, movieId: movie.id, mode: d.mode, dir, offset: 0, duration: media.duration, proc: null, exited: false, error: null,
    lastAccess: Date.now(), position: start, watchedCounted: false, playId: null, stderr: '',
  };

  if (d.mode === 'direct') {
    sessions.set(id, session);
    const a = media.audio.find((x) => x.index === d.audioIndex);
    return {
      session,
      plan: {
        sessionId: id, mode: 'direct', url: `/api/movies/${movie.id}/file`, offset: 0, duration: media.duration, reasons: d.reasons,
        video: `${media.video?.codec ?? '—'} ${media.video?.width ?? ''}×${media.video?.height ?? ''} → direct`,
        audio: a ? `${a.codec} ${a.channels}ch → direct` : 'aucun', encoder: null,
      },
    };
  }

  if (!ffmpegPath) throw new Error('ffmpeg introuvable');
  fs.mkdirSync(dir, { recursive: true });
  // Remux : démarrage sur l'image-clé précédente, sinon la vidéo copiée commencerait par une image incomplète
  const offset = d.mode === 'remux' ? await keyframeBefore(movie.file_path, start) : start;
  session.offset = offset;
  const { args, encoder, videoLabel, audioLabel } = await buildArgs(movie.file_path, media, d, offset);

  const proc = spawn(ffmpegPath, args, { cwd: dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  session.proc = proc;
  proc.stderr!.on('data', (b) => { session.stderr = (session.stderr + b).slice(-4000); });
  proc.on('close', (code) => {
    session.exited = true;
    if (code !== 0 && sessions.has(id)) session.error = session.stderr.trim().split('\n').slice(-3).join(' | ') || `ffmpeg code ${code}`;
  });
  sessions.set(id, session);

  return {
    session,
    plan: {
      sessionId: id, mode: d.mode, url: `/api/hls/${id}/index.m3u8`, offset, duration: media.duration,
      reasons: d.reasons, video: videoLabel, audio: audioLabel, encoder: d.mode === 'transcode' ? encoder : null,
    },
  };
}

/** Attend qu'un fichier du flux existe (ou que ffmpeg échoue). */
export async function waitForFile(s: Session, file: string, timeoutMs = 30_000): Promise<string | null> {
  const p = path.join(s.dir, file);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    s.lastAccess = Date.now();
    if (fs.existsSync(p)) {
      if (file !== 'index.m3u8') return p;
      // La playlist doit contenir au moins un segment
      if (/#EXTINF/.test(fs.readFileSync(p, 'utf8'))) return p;
    }
    if (s.exited) return fs.existsSync(p) ? p : null;
    await new Promise((r) => setTimeout(r, 80));
  }
  return null;
}
