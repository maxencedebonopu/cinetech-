// Mise en forme des données techniques (fiche mono) et des durées, en français.
import type { MediaInfo, SubtitleTrack } from '@cine/shared';

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf3 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const LANG = new Intl.DisplayNames(['fr'], { type: 'language' });

export const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function langName(code: string | null) {
  if (!code) return 'Inconnue';
  try { const n = LANG.of(code); return n ? n[0].toUpperCase() + n.slice(1) : code; } catch { return code; }
}

export function runtime(min: number | null) {
  if (!min) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h ${pad(m)}` : `${m} min`;
}

export function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

const VCODEC: Record<string, string> = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9', mpeg4: 'MPEG-4', mpeg2video: 'MPEG-2' };
const ACODEC: Record<string, string> = { aac: 'AAC', ac3: 'Dolby Digital', eac3: 'Dolby Digital+', dts: 'DTS', truehd: 'Dolby TrueHD', flac: 'FLAC', opus: 'Opus', mp3: 'MP3', pcm_s16le: 'PCM', pcm_s24le: 'PCM' };
const HDR: Record<string, string> = { HDR10: 'HDR10', HLG: 'HLG', DV: 'Dolby Vision', SDR: 'SDR' };

export function channels(n: number) { return n >= 8 ? '7.1' : n >= 6 ? '5.1' : n === 2 ? 'Stéréo' : n === 1 ? 'Mono' : `${n} canaux`; }

export function definition(w: number, h: number) {
  if (w >= 3200 || h >= 2000) return '4K';
  if (w >= 1800 || h >= 1000) return '1080p';
  if (w >= 1200 || h >= 700) return '720p';
  return 'SD';
}

/** Rapport d'image affiché : 2,39:1, 1,85:1, 1,33:1… */
export function aspect(w: number, h: number) {
  const r = w / h;
  const known = [1.33, 1.37, 1.66, 1.78, 1.85, 2.0, 2.2, 2.35, 2.39, 2.76];
  const k = known.find((x) => Math.abs(x - r) < 0.025);
  return `${(k ?? r).toFixed(2).replace('.', ',')}:1`;
}

/** Français et anglais d'abord, quatre langues au plus, puis « +N ». */
function langList(subs: SubtitleTrack[]) {
  const codes = [...new Set(subs.map((s) => s.language ?? 'und'))];
  const rank = (c: string) => (c === 'fr' ? 0 : c === 'en' ? 1 : 2);
  codes.sort((a, b) => rank(a) - rank(b));
  const shown = codes.slice(0, 4).map(langName).join(' · ');
  return codes.length > 4 ? `${shown} · +${codes.length - 4}` : shown;
}

export interface TechRow { label: string; value: string; note?: string }

export function techSheet(media: MediaInfo, subs: SubtitleTrack[] = []): TechRow[] {
  const rows: TechRow[] = [];
  const v = media.video;
  rows.push({ label: 'Durée', value: clock(media.duration) });
  if (v) {
    const parts = [VCODEC[v.codec] ?? v.codec.toUpperCase(), v.bitDepth && v.bitDepth > 8 ? `${v.bitDepth} bits` : null].filter(Boolean);
    rows.push({ label: 'Image', value: `${parts.join(' ')} · ${v.width} × ${v.height}`, note: definition(v.width, v.height) });
    rows.push({ label: 'Format', value: aspect(v.width, v.height) + (v.fps ? ` · ${nf3.format(v.fps)} i/s` : '') });
    rows.push({ label: 'Dynamique', value: HDR[v.hdr] });
  }
  media.audio.forEach((a, i) => rows.push({
    label: i === 0 ? 'Son' : '',
    value: `${langName(a.language)} · ${ACODEC[a.codec] ?? a.codec.toUpperCase()} ${channels(a.channels)}`,
  }));
  const text = subs.filter((s) => s.textBased), image = subs.filter((s) => !s.textBased);
  if (text.length) rows.push({ label: 'Sous-titres', value: langList(text) });
  if (image.length) rows.push({ label: text.length ? '' : 'Sous-titres', value: langList(image), note: 'Incrustés' });
  rows.push({ label: 'Fichier', value: `${media.container.split(',')[0].toUpperCase()} · ${nf1.format(media.size / 1e9)} Go · ${nf1.format(media.bitrate / 1e6)} Mb/s` });
  if (media.chapters.length) rows.push({ label: 'Chapitres', value: String(media.chapters.length) });
  return rows;
}
