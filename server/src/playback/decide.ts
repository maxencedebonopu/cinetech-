// Décision de lecture par appareil : lecture directe, remux HLS ou transcodage complet.
import type { ClientCaps, MediaInfo, PlaybackMode, Quality } from '@cine/shared';

export interface Decision {
  mode: PlaybackMode;
  reasons: string[];
  audioIndex: number | null;
  copyAudio: boolean;
  audioChannels: number;      // canaux de sortie AAC
  tonemap: boolean;
  burnIndex: number | null;
  targetHeight: number | null;
  videoBitrate: number | null; // bits/s
}

const DIRECT_CONTAINERS = new Set(['mov', 'mp4', 'm4a', '3gp']); // ffprobe nomme le MP4 « mov,mp4,… »

function videoSupported(codec: string, caps: ClientCaps) {
  switch (codec) {
    case 'h264': return caps.video.h264;
    case 'hevc': return caps.video.hevc;
    case 'av1': return caps.video.av1;
    case 'vp9': return caps.video.vp9;
    default: return false;
  }
}

const QUALITY: Record<Exclude<Quality, 'original'>, { height: number; bitrate: number }> = {
  '8M': { height: 1080, bitrate: 8_000_000 },
  '4M': { height: 720, bitrate: 4_000_000 },
};

export function decide(media: MediaInfo, caps: ClientCaps, opts: { quality: Quality; audioIndex?: number | null; burnIndex?: number | null }): Decision {
  const reasons: string[] = [];
  const v = media.video;
  const audio = media.audio.find((a) => a.index === opts.audioIndex) ?? media.audio.find((a) => a.default) ?? media.audio[0] ?? null;
  const audioIndex = audio?.index ?? null;
  const firstAudio = media.audio[0]?.index ?? null;

  const channelsOut = audio ? Math.min(audio.channels >= 6 ? 6 : 2, Math.max(2, caps.maxAudioChannels)) : 2;
  const audioIsAac = audio?.codec === 'aac' && audio.channels <= channelsOut;
  const audioPlayable = !audio || (audio.codec === 'aac' && caps.audio.aac) || (audio.codec === 'mp3' && caps.audio.mp3);

  const hdr = !!v && v.hdr !== 'SDR';
  // HDR10 / HLG sur un écran SDR : un navigateur qui décode le codec convertit lui-même l'image en SDR
  // (Chrome, Edge, Safari). La conversion par ffmpeg ne tenait que 1,5× le temps réel sur ce PC : à la
  // moindre charge, la lecture calait. Elle reste pour Dolby Vision (profil 5 sans couche HDR10 lisible).
  const tonemap = hdr && !caps.hdr && (v!.hdr === 'DV' || !videoSupported(v!.codec, caps));
  const vOk = !!v && videoSupported(v.codec, caps) && !tonemap;

  let mustTranscode = false;
  let targetHeight: number | null = null;
  let videoBitrate: number | null = null;

  if (!v) reasons.push('pas de piste vidéo');
  if (v && !videoSupported(v.codec, caps)) { mustTranscode = true; reasons.push(`vidéo ${v.codec} non lisible par ce navigateur`); }
  if (tonemap) { mustTranscode = true; reasons.push(`${v!.hdr} → conversion SDR (écran non HDR)`); }
  if (opts.burnIndex != null) { mustTranscode = true; reasons.push('sous-titres image incrustés'); }
  if (opts.quality !== 'original') {
    const q = QUALITY[opts.quality];
    const srcBitrate = media.bitrate || Infinity;
    if (srcBitrate > q.bitrate * 1.15 || (v && v.height > q.height)) {
      mustTranscode = true;
      targetHeight = v && v.height > q.height ? q.height : null;
      videoBitrate = q.bitrate;
      reasons.push(`débit limité à ${opts.quality.replace('M', ' Mb/s')}`);
    }
  }

  if (mustTranscode) {
    if (!videoBitrate) videoBitrate = Math.min(Math.max(media.bitrate || 0, 6_000_000), (v?.height ?? 1080) > 1080 ? 20_000_000 : 12_000_000);
    return { mode: 'transcode', reasons, audioIndex, copyAudio: audioIsAac, audioChannels: channelsOut, tonemap, burnIndex: opts.burnIndex ?? null, targetHeight, videoBitrate };
  }

  const container = media.container;
  if (DIRECT_CONTAINERS.has(container) && vOk && audioPlayable && audioIndex === firstAudio) {
    reasons.push('conteneur et codecs lus nativement');
    return { mode: 'direct', reasons, audioIndex, copyAudio: true, audioChannels: channelsOut, tonemap: false, burnIndex: null, targetHeight: null, videoBitrate: null };
  }

  if (!DIRECT_CONTAINERS.has(container)) reasons.push(`conteneur ${container} → HLS`);
  if (audio && !audioIsAac) reasons.push(`audio ${audio.codec} ${audio.channels}ch → AAC ${channelsOut === 6 ? '5.1' : 'stéréo'}`);
  if (audioIndex !== firstAudio) reasons.push('piste audio secondaire');
  return { mode: 'remux', reasons, audioIndex, copyAudio: audioIsAac, audioChannels: channelsOut, tonemap: false, burnIndex: null, targetHeight: null, videoBitrate: null };
}
