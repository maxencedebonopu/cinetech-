// Analyse technique d'un fichier vidéo avec ffprobe.
import path from 'node:path';
import type { MediaInfo, AudioTrack, Chapter } from '@cine/shared';
import { ffprobePath, run } from '../tools/ffmpeg.ts';

export interface ProbedSubtitle {
  index: number;
  codec: string;
  language: string | null;
  title: string | null;
  forced: boolean;
  sdh: boolean;
  default: boolean;
  textBased: boolean;
}

export interface ProbeResult {
  media: MediaInfo;
  subtitles: ProbedSubtitle[];
}

const TEXT_SUB_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);

/** ISO 639-2 (MKV) → 639-1 */
const ISO3: Record<string, string> = {
  fre: 'fr', fra: 'fr', eng: 'en', spa: 'es', ger: 'de', deu: 'de', ita: 'it', por: 'pt', jpn: 'ja', kor: 'ko',
  chi: 'zh', zho: 'zh', rus: 'ru', ara: 'ar', dut: 'nl', nld: 'nl', hin: 'hi', swe: 'sv', dan: 'da', nor: 'no',
  fin: 'fi', pol: 'pl', cze: 'cs', ces: 'cs', hun: 'hu', gre: 'el', ell: 'el', tur: 'tr', heb: 'he', tha: 'th',
  ukr: 'uk', rum: 'ro', ron: 'ro', ind: 'id', vie: 'vi', cat: 'ca', per: 'fa', fas: 'fa',
  ice: 'is', isl: 'is', slo: 'sk', slk: 'sk', bul: 'bg', hrv: 'hr', scr: 'hr', est: 'et', lav: 'lv', lit: 'lt',
  may: 'ms', msa: 'ms', srp: 'sr', scc: 'sr', slv: 'sl', baq: 'eu', eus: 'eu', glg: 'gl', fil: 'tl', tam: 'ta', tel: 'te',
};
export function normalizeLang(l: string | undefined | null): string | null {
  if (!l) return null;
  const s = l.toLowerCase();
  if (s === 'und' || s === 'unk' || s === 'mis' || s === 'zxx') return null;
  if (s.length === 2) return s;
  return ISO3[s] ?? s;
}

function parseRate(r: string | undefined): number | null {
  if (!r || r === '0/0') return null;
  const [a, b] = r.split('/').map(Number);
  return b ? Math.round((a / b) * 1000) / 1000 : a || null;
}

export async function probe(filePath: string): Promise<ProbeResult> {
  if (!ffprobePath) throw new Error('ffprobe introuvable');
  const buf = await run(ffprobePath, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', filePath,
  ], { timeoutMs: 60_000 });
  const data = JSON.parse(buf.toString('utf8'));
  const streams: any[] = data.streams ?? [];
  const fmt = data.format ?? {};

  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  let hdr: 'SDR' | 'HDR10' | 'HLG' | 'DV' = 'SDR';
  if (v) {
    if ((v.side_data_list ?? []).some((d: any) => /dovi|dolby vision/i.test(d.side_data_type ?? ''))) hdr = 'DV';
    else if (v.color_transfer === 'smpte2084') hdr = 'HDR10';
    else if (v.color_transfer === 'arib-std-b67') hdr = 'HLG';
  }

  const audio: AudioTrack[] = streams
    .filter((s) => s.codec_type === 'audio')
    .map((s) => ({
      index: s.index,
      codec: s.profile && /DTS-HD MA|TrueHD|Atmos|DTS:X/i.test(s.profile) ? `${s.codec_name} (${s.profile})` : s.codec_name,
      language: normalizeLang(s.tags?.language),
      channels: s.channels ?? 2,
      layout: s.channel_layout ?? null,
      title: s.tags?.title ?? null,
      default: !!s.disposition?.default,
    }));

  const subtitles: ProbedSubtitle[] = streams
    .filter((s) => s.codec_type === 'subtitle')
    .map((s) => {
      const title: string | null = s.tags?.title ?? null;
      return {
        index: s.index,
        codec: s.codec_name ?? 'unknown',
        language: normalizeLang(s.tags?.language),
        title,
        forced: !!s.disposition?.forced || /forc/i.test(title ?? ''),
        sdh: !!s.disposition?.hearing_impaired || /sdh|malentendant/i.test(title ?? ''),
        default: !!s.disposition?.default,
        textBased: TEXT_SUB_CODECS.has(s.codec_name),
      };
    });

  const chapters: Chapter[] = (data.chapters ?? []).map((c: any) => ({
    start: Number(c.start_time),
    end: Number(c.end_time),
    title: c.tags?.title ?? null,
  }));

  const media: MediaInfo = {
    container: (fmt.format_name ?? path.extname(filePath).slice(1)).split(',')[0],
    duration: Number(fmt.duration ?? v?.duration ?? 0),
    size: Number(fmt.size ?? 0),
    bitrate: Number(fmt.bit_rate ?? 0),
    video: v
      ? {
          index: v.index,
          codec: v.codec_name,
          profile: v.profile ?? null,
          width: v.width,
          height: v.height,
          fps: parseRate(v.avg_frame_rate) ?? parseRate(v.r_frame_rate),
          bitDepth: v.bits_per_raw_sample ? Number(v.bits_per_raw_sample) : /10/.test(v.pix_fmt ?? '') ? 10 : 8,
          hdr,
          aspect: v.display_aspect_ratio && v.display_aspect_ratio !== '0:1' ? v.display_aspect_ratio : null,
        }
      : null,
    audio,
    chapters,
  };
  return { media, subtitles };
}
