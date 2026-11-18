// Moteur de lecture côté navigateur : séance serveur (direct / remux / transcodage), hls.js, sauts,
// suivi de progression. Temps du film = plan.offset + video.currentTime.
import type { ClientCaps, PlaybackPlan, PingResponse, Quality } from '@cine/shared';
import type HlsType from 'hls.js';

export function detectCaps(video: HTMLVideoElement): ClientCaps {
  const ms = (window as any).MediaSource ?? (window as any).ManagedMediaSource;
  const t = (c: string) => !!ms && ms.isTypeSupported(c);
  return {
    mse: !!ms,
    nativeHls: !!video.canPlayType('application/vnd.apple.mpegurl'),
    video: {
      h264: t('video/mp4; codecs="avc1.640029"'),
      hevc: t('video/mp4; codecs="hvc1.2.4.L153.B0"') || t('video/mp4; codecs="hev1.2.4.L153.B0"'),
      av1: t('video/mp4; codecs="av01.0.08M.10"'),
      vp9: t('video/mp4; codecs="vp09.00.40.08"'),
    },
    audio: {
      aac: t('audio/mp4; codecs="mp4a.40.2"'), ac3: t('audio/mp4; codecs="ac-3"'), eac3: t('audio/mp4; codecs="ec-3"'),
      opus: t('audio/mp4; codecs="opus"'), flac: t('audio/mp4; codecs="flac"'), mp3: t('audio/mpeg'),
    },
    hdr: matchMedia('(dynamic-range: high)').matches,
    maxAudioChannels: 6,
  };
}

const post = async <T,>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Erreur ${r.status}`);
  return j as T;
};

export interface StartOptions { audioIndex: number | null; burnSubtitleId: number | null; quality: Quality }

/** Une séance : se charge de relancer le flux quand on saute hors de la partie préparée. */
export class Projection {
  plan: PlaybackPlan | null = null;
  avail = { from: 0, to: 0 };
  private hls: HlsType | null = null;
  private timer: number | null = null;
  private generation = 0;
  private stopped = false;
  private recoveries = 0; // relances automatiques depuis le dernier segment chargé
  onPlan?: (p: PlaybackPlan) => void;
  onError?: (msg: string) => void;
  onWatched?: () => void;

  private lastGood = 0;  // dernière position plausible
  private fixing = false;

  constructor(private video: HTMLVideoElement, private movieId: number, public opts: StartOptions) {
    video.addEventListener('timeupdate', () => this.guard());
  }

  /** Garde-fou : un horodatage faux dans un segment peut projeter la lecture hors du film (268 466 s…).
   *  On revient alors au dernier moment plausible, sur un flux neuf. */
  private guard() {
    const p = this.plan;
    if (!p || p.mode === 'direct') return;
    const t = this.now();
    if (t >= 0 && t <= p.duration + 5) { this.lastGood = t; return; }
    if (this.fixing || this.stopped) return;
    this.fixing = true;
    const wasPlaying = !this.video.paused;
    void this.start(Math.min(this.lastGood + 0.5, p.duration - 1)).then(() => { if (wasPlaying) this.video.play().catch(() => {}); }).finally(() => { this.fixing = false; });
  }

  now() { return this.plan ? this.plan.offset + this.video.currentTime : 0; }

  async start(at: number) {
    const gen = ++this.generation;
    // L'ancien lecteur hls.js doit disparaître avant que le serveur ne supprime ses segments
    this.hls?.destroy(); this.hls = null;
    const plan = await post<PlaybackPlan>('/api/playback/start', {
      movieId: this.movieId, start: at, audioIndex: this.opts.audioIndex, burnSubtitleId: this.opts.burnSubtitleId,
      quality: this.opts.quality, caps: detectCaps(this.video), replaceSessionId: this.plan?.sessionId ?? null,
    });
    if (gen !== this.generation || this.stopped) {
      // Relance remplacée ou lecteur fermé pendant la requête : cette séance ne servira pas
      navigator.sendBeacon('/api/playback/stop', new Blob([JSON.stringify({ sessionId: plan.sessionId })], { type: 'application/json' }));
      return;
    }
    this.plan = plan;
    this.avail = { from: plan.offset, to: plan.offset };
    this.onPlan?.(plan);
    const v = this.video;
    if (plan.mode === 'direct') {
      v.src = plan.url;
      v.addEventListener('loadedmetadata', () => { v.currentTime = at; }, { once: true });
    } else {
      const { default: Hls } = await import('hls.js');
      if (gen !== this.generation || this.stopped) return;
      if (Hls.isSupported()) {
        const hls = new Hls({
          startPosition: 0,
          // Une minute d'avance (deux au plus) : absorbe les creux du réseau, surtout à distance
          maxBufferLength: 60, maxMaxBufferLength: 120, backBufferLength: 60,
          // Le remux coupe sur les images-clés du fichier : deux images-clés collées donnent un segment
          // d'une seule image (0,04 s). Avec la tolérance par défaut (0,25 s), hls.js le saute, laisse un trou
          // et la lecture cale. Tolérance quasi nulle : aucun segment n'est sauté.
          maxFragLookUpTolerance: 0.01,
          manifestLoadingTimeOut: 30000, fragLoadingTimeOut: 40000, levelLoadingTimeOut: 30000,
        });
        hls.on(Hls.Events.FRAG_BUFFERED, () => { this.recoveries = 0; });
        hls.on(Hls.Events.ERROR, (_e, d) => {
          if (!d.fatal || gen !== this.generation) return;
          // Avant d'abandonner : décodeur relancé, ou nouveau flux à la position courante (séance expirée…)
          if (this.recoveries++ < 2) {
            if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else { const wasPlaying = !v.paused; void this.start(this.now()).then(() => { if (wasPlaying) v.play().catch(() => {}); }); }
            return;
          }
          this.onError?.(`Flux interrompu (${d.details})`);
        });
        hls.loadSource(plan.url);
        hls.attachMedia(v);
        this.hls = hls;
      } else {
        v.src = plan.url; // Safari / iOS : HLS natif
      }
      // Le remux démarre à l'image-clé précédente. Ajustement fin une fois la lecture lancée :
      // la portion est alors déjà chargée, le saut est instantané (un saut sur un flux à l'arrêt bloque le chargement).
      const gap = at - plan.offset;
      if (gap > 0.3) v.addEventListener('playing', () => { if (gen === this.generation) v.currentTime = gap; }, { once: true });
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = window.setInterval(() => void this.ping(), 5000);
  }

  async ping() {
    if (!this.plan) return;
    if (this.now() > this.plan.duration + 5) return; // position impossible : jamais enregistrée
    try {
      const r = await post<PingResponse>('/api/playback/ping', { sessionId: this.plan.sessionId, position: this.now(), paused: this.video.paused });
      this.avail = { from: r.availableFrom, to: r.availableTo };
      if (r.watched) this.onWatched?.();
    } catch { /* la prochaine fois */ }
  }

  /** Saut : instantané dans la partie déjà préparée, sinon nouveau flux à cet endroit. */
  async seek(t: number) {
    const p = this.plan;
    if (!p) return;
    t = Math.max(0, Math.min(t, p.duration - 1));
    if (p.mode === 'direct') { this.video.currentTime = t; return; }
    await this.ping();
    if (t >= Math.max(p.offset, this.avail.from) && t < this.avail.to - 2) { this.video.currentTime = t - p.offset; return; }
    const wasPlaying = !this.video.paused;
    await this.start(t);
    if (wasPlaying) this.video.play().catch(() => {});
  }

  /** Change une option (piste audio, incrustation, qualité) : nouveau flux à la position courante. */
  async restart(patch: Partial<StartOptions>) {
    this.opts = { ...this.opts, ...patch };
    const wasPaused = this.video.paused;
    await this.start(this.now());
    if (!wasPaused) this.video.play().catch(() => {});
  }

  stop() {
    this.stopped = true;
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.hls?.destroy(); this.hls = null;
    if (this.plan) {
      const body = JSON.stringify({ sessionId: this.plan.sessionId });
      // Dernier point de progression, puis arrêt de ffmpeg
      navigator.sendBeacon('/api/playback/ping', new Blob([JSON.stringify({ sessionId: this.plan.sessionId, position: this.now(), paused: true })], { type: 'application/json' }));
      navigator.sendBeacon('/api/playback/stop', new Blob([body], { type: 'application/json' }));
    }
    this.plan = null;
  }
}

// ---------- Sous-titres texte (WebVTT) ----------
export interface Cue { start: number; end: number; text: string; top: boolean }

export async function loadCues(url: string): Promise<Cue[]> {
  const txt = await (await fetch(url)).text();
  const ts = (s: string) => { const p = s.trim().replace(',', '.').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
  const cues: Cue[] = [];
  for (const block of txt.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, rest] = lines[i].split('-->');
    const [b, ...settings] = rest.trim().split(/\s+/);
    const text = lines.slice(i + 1).join('\n').replace(/<(?!\/?i>)[^>]+>/g, '').trim();
    if (text) cues.push({ start: ts(a), end: ts(b), text, top: settings.some((s) => s === 'line:0' || s.startsWith('line:10%')) });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** Répliques actives à l'instant t (recherche dichotomique). */
export function activeCues(cues: Cue[], t: number) {
  let lo = 0, hi = cues.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cues[mid].start <= t) lo = mid + 1; else hi = mid; }
  const out: Cue[] = [];
  for (let i = lo - 1; i >= 0 && i >= lo - 8; i--) if (cues[i].end >= t) out.unshift(cues[i]);
  return out;
}

// ---------- Préférences d'affichage des sous-titres (par appareil) ----------
export interface SubStyle { size: number; font: 'sans' | 'serif' | 'mono'; background: 'none' | 'shadow' | 'box'; lift: number }
const SUB_KEY = 'cine.subtitles';
export const DEFAULT_SUB_STYLE: SubStyle = { size: 100, font: 'sans', background: 'shadow', lift: 8 };
export function loadSubStyle(): SubStyle {
  try { return { ...DEFAULT_SUB_STYLE, ...JSON.parse(localStorage.getItem(SUB_KEY) ?? '{}') }; } catch { return DEFAULT_SUB_STYLE; }
}
export function saveSubStyle(s: SubStyle) { try { localStorage.setItem(SUB_KEY, JSON.stringify(s)); } catch { /* navigation privée */ } }
