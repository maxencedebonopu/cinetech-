// Lecteur : séquence de lancement, image, sous-titres dessinés par nous, commandes qui s'effacent,
// barre de lecture à chapitres et vignettes, menus, raccourcis clavier et télécommande.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as RPointerEvent, ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import type { MovieDetail, PlaybackPlan, Quality, Settings, SubtitleTrack, TrickplayInfo } from '@cine/shared';
import {
  Play, Pause, ArrowLeft, ClockCounterClockwise, ClockClockwise, SpeakerHigh, SpeakerLow, SpeakerSlash, Subtitles,
  CornersOut, CornersIn, PictureInPicture, Airplay, Gauge, Waveform, Check, Question, FilmReel, SlidersHorizontal,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import { Projection, loadCues, activeCues, loadSubStyle, saveSubStyle, type Cue, type SubStyle } from '../lib/playback';
import { clock, langName, channels, pad } from '../lib/format';
import { refreshMovies } from '../lib/store';
import { ReelCode } from '../components/editorial';
import { Leader, Letterbox } from '../components/cinema';
import { Img } from '../components/media';
import { Button, Segmented, Slider } from '../components/controls';
import { ErrorState } from '../components/states';
import { EASE_OUT, D1 } from '../lib/motion';
import { isBackKey } from '../lib/spatial';
import '../styles/player.css';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Cache qui se referme au montage (fondu au noir façon projection). */
function Curtain() {
  const [state, setState] = useState<'scope' | 'shut'>('scope');
  useEffect(() => { const r = requestAnimationFrame(() => requestAnimationFrame(() => setState('shut'))); return () => cancelAnimationFrame(r); }, []);
  return <Letterbox state={state} color="#000" />;
}
const QUALITIES: { value: Quality; label: string; hint: string }[] = [
  { value: 'original', label: 'Original', hint: 'Image intacte quand c\'est possible' },
  { value: '8M', label: '8 Mb/s', hint: '1080p au plus' },
  { value: '4M', label: '4 Mb/s', hint: '720p, pour l\'accès à distance' },
];
type Menu = null | 'subs' | 'audio' | 'speed' | 'quality';

/** Choix initial : sous-titres texte dans la langue préférée, sauf si le film est déjà dans cette langue. */
function defaultSub(film: MovieDetail, lang: string, audioLang: string | null): SubtitleTrack | null {
  if (audioLang === lang) return film.subtitles.find((s) => s.language === lang && s.forced && s.textBased) ?? null;
  const text = film.subtitles.filter((s) => s.textBased && s.language === lang && !s.forced);
  return text.find((s) => s.source === 'external') ?? text[0] ?? null;
}

// ---------- Barre de lecture ----------
function SeekBar({ t, duration, avail, chapters, trick, onSeek, onScrub }: {
  t: number; duration: number; avail: { from: number; to: number }; chapters: { start: number; title: string | null }[];
  trick: TrickplayInfo | null; onSeek: (t: number) => void; onScrub: (active: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const at = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  };
  const shown = drag ?? t;
  const tip = drag ?? hover;
  const chapter = tip != null ? [...chapters].reverse().find((c) => c.start <= tip) : null;
  let thumb: CSSProperties | null = null;
  if (tip != null && trick) {
    const idx = Math.min(trick.count - 1, Math.floor(tip / trick.interval));
    const per = trick.columns * trick.rows;
    const sheet = trick.sheets[Math.floor(idx / per)];
    const k = idx % per;
    if (sheet) thumb = {
      width: trick.width, height: trick.height,
      backgroundImage: `url(${sheet})`, backgroundPosition: `-${(k % trick.columns) * trick.width}px -${Math.floor(k / trick.columns) * trick.height}px`,
    };
  }
  const pct = (x: number) => `${(x / (duration || 1)) * 100}%`;
  return (
    <div
      ref={ref}
      className={`seek${drag != null ? ' is-drag' : ''}`}
      role="slider" aria-label="Position dans le film" aria-valuemin={0} aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(t)} aria-valuetext={`${clock(t)} sur ${clock(duration)}`} tabIndex={0}
      onPointerMove={(e) => { setHover(at(e)); if (drag != null) setDrag(at(e)); }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(at(e)); onScrub(true); }}
      onPointerUp={(e) => { if (drag != null) { onSeek(at(e)); setDrag(null); onScrub(false); } }}
      onPointerCancel={() => { setDrag(null); onScrub(false); }}
    >
      <div className="seek__track">
        <span className="seek__avail" style={{ left: pct(avail.from), width: pct(Math.max(0, avail.to - avail.from)) }} />
        <span className="seek__fill" style={{ width: pct(shown) }} />
        {chapters.slice(1).map((c, i) => <span key={i} className="seek__chap" style={{ left: pct(c.start) }} />)}
        <span className="seek__knob" style={{ left: pct(shown) }} />
      </div>
      {tip != null && (
        <div className="seek__tip" style={{ left: `clamp(${(trick?.width ?? 120) / 2}px, ${pct(tip)}, calc(100% - ${(trick?.width ?? 120) / 2}px))` }}>
          {thumb && <span className="seek__thumb" style={thumb} />}
          <span className="t-mono seek__time">{clock(tip)}</span>
          {chapter?.title && <span className="seek__chapter">{chapter.title}</span>}
        </div>
      )}
    </div>
  );
}

// ---------- Panneau de menu ----------
function Panel({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { (ref.current?.querySelector('[aria-checked="true"], button') as HTMLElement | null)?.focus(); }, []);
  return (
    <motion.div
      ref={ref}
      className="ppanel" role="dialog" aria-label={title}
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
      transition={{ duration: D1 * 0.7, ease: EASE_OUT }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      <p className="t-mono ppanel__title">{title}</p>
      {children}
    </motion.div>
  );
}

function Choice({ on, onClick, children, note }: { on: boolean; onClick: () => void; children: ReactNode; note?: ReactNode }) {
  return (
    <button className={`pchoice${on ? ' is-on' : ''}`} role="menuitemradio" aria-checked={on} onClick={onClick}>
      <span className="pchoice__check" aria-hidden>{on && <Check />}</span>
      <span className="pchoice__label">{children}</span>
      {note && <span className="pchoice__note">{note}</span>}
    </button>
  );
}

const HELP: [string, string][] = [
  ['Espace · K', 'Lecture / pause'], ['← →', 'Reculer / avancer de 5 s'], ['J · L', 'Reculer / avancer de 10 s'],
  ['↑ ↓', 'Volume'], ['M', 'Couper le son'], ['F', 'Plein écran'], ['S', 'Sous-titres suivants'],
  ['[ ]', 'Décalage des sous-titres ±0,1 s'], ['< >', 'Vitesse'], ['0 … 9', 'Aller à 0 %, 10 % … 90 %'],
  ['?', 'Cette aide'], ['Échap', 'Fermer · quitter'],
];

export function Player() {
  const { id } = useParams();
  const movieId = Number(id);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const proj = useRef<Projection | null>(null);

  const [film, setFilm] = useState<MovieDetail | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [plan, setPlan] = useState<PlaybackPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intro, setIntro] = useState<'closing' | 'leader' | 'waiting' | 'done'>('closing');
  const [ready, setReady] = useState(false);
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('cine.volume') ?? 1));
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [ui, setUi] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [help, setHelp] = useState(false);
  const [full, setFull] = useState(false);
  const [sub, setSub] = useState<SubtitleTrack | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [style, setStyle] = useState<SubStyle>(loadSubStyle);
  const [offset, setOffset] = useState(0);
  const [audioIndex, setAudioIndex] = useState<number | null>(null);
  const [quality, setQuality] = useState<Quality>('original');
  const [trick, setTrick] = useState<TrickplayInfo | null>(null);
  const [flash, setFlash] = useState<{ key: number; icon: ReactNode; label?: string } | null>(null);
  const [ended, setEnded] = useState(false);
  const [airplay, setAirplay] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const lastTap = useRef<{ t: number; x: number } | null>(null);

  // ---------- Chargement ----------
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.movie(movieId), api.settings().catch(() => null)]).then(([f, s]) => {
      if (cancelled) return;
      setFilm(f); setSettings(s);
      // Audio : « original » garde la piste par défaut du fichier (VO), sinon la langue préférée hors commentaires.
      const tracks = f.media?.audio ?? [];
      const pref = s?.preferredAudioLanguage ?? 'original';
      const audio = (pref !== 'original' ? tracks.find((a) => a.language === pref && !/comment/i.test(a.title ?? '')) : undefined)
        ?? tracks.find((a) => a.default) ?? tracks[0];
      setAudioIndex(audio?.index ?? null);
      setOffset(f.user.subtitleOffset ?? 0);
      setQuality(s?.remoteQuality && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' ? s.remoteQuality : 'original');
      const subPref = s?.preferredSubtitleLanguage ?? 'fr';
      setSub(subPref === 'none' ? null : defaultSub(f, subPref, audio?.language ?? null));
      if (s && !s.leader) setIntro('closing');
    }).catch((e) => setError(e.message));
    api.trickplay(movieId).then(setTrick).catch(() => {});
    return () => { cancelled = true; };
  }, [movieId]);

  // ---------- Séance ----------
  useEffect(() => {
    const v = videoRef.current;
    if (!film || !v || audioIndex === undefined || proj.current) return;
    const textSub = sub && !sub.textBased ? sub.id : null;
    const p = new Projection(v, film.id, { audioIndex, burnSubtitleId: textSub, quality });
    p.onPlan = (pl) => setPlan(pl);
    p.onError = (m) => setError(m);
    p.onWatched = () => refreshMovies();
    proj.current = p;
    const from = params.get('debut') ? 0 : film.user.position > 30 ? film.user.position : 0;
    p.start(from).catch((e) => setError(e.message));
    const leave = () => p.stop();
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); p.stop(); proj.current = null; refreshMovies(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [film]);

  // ---------- Sous-titres texte ----------
  useEffect(() => {
    setCues([]);
    if (sub?.textBased && sub.url) loadCues(sub.url).then(setCues).catch(() => setCues([]));
  }, [sub]);

  // ---------- Événements vidéo ----------
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    // L'indicateur n'apparaît qu'après 700 ms d'attente : pas de clignotement sur les petits sauts
    let wait: number | null = null;
    const settle = () => { if (wait) clearTimeout(wait); wait = null; setBuffering(false); };
    const on: Record<string, () => void> = {
      timeupdate: () => setT(proj.current?.now() ?? 0),
      play: () => setPaused(false),
      pause: () => setPaused(true),
      waiting: () => { if (!wait) wait = window.setTimeout(() => setBuffering(true), 700); },
      playing: () => { settle(); setReady(true); },
      canplay: () => { settle(); setReady(true); },
      seeked: settle,
      ended: () => setEnded(true),
      ratechange: () => setRate(v.playbackRate),
      volumechange: () => { setMuted(v.muted); setVolume(v.volume); },
    };
    for (const [k, f] of Object.entries(on)) v.addEventListener(k, f);
    const wk = (e: any) => setAirplay(e.availability === 'available');
    v.addEventListener('webkitplaybacktargetavailabilitychanged', wk);
    return () => { for (const [k, f] of Object.entries(on)) v.removeEventListener(k, f); v.removeEventListener('webkitplaybacktargetavailabilitychanged', wk); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { try { localStorage.setItem('cine.volume', String(volume)); } catch { /* */ } }, [volume]);
  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);

  // ---------- Séquence de lancement : noir, cache, amorce ----------
  useEffect(() => {
    if (intro !== 'closing' || !film) return;
    const tm = setTimeout(() => setIntro(settings?.leader === false ? 'waiting' : 'leader'), 750);
    return () => clearTimeout(tm);
  }, [intro, film, settings]);
  useEffect(() => { if (intro === 'waiting' && ready) setIntro('done'); }, [intro, ready]);
  // Fin de la séquence : le film commence (le clic sur « Projeter » autorise la lecture sonore)
  useEffect(() => { if (intro === 'done') videoRef.current?.play().catch(() => setPaused(true)); }, [intro]);
  const skipIntro = () => setIntro(ready ? 'done' : 'waiting');

  // ---------- Commandes qui s'effacent ----------
  const poke = useCallback(() => {
    setUi(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setUi(false), 2000);
  }, []);
  const keepUi = paused || !!menu || help || scrubbing || intro !== 'done' || ended;
  useEffect(() => { if (keepUi) setUi(true); else poke(); }, [keepUi, poke]);

  // ---------- Actions ----------
  const v = () => videoRef.current!;
  const toggle = () => { if (ended) { setEnded(false); void proj.current?.seek(0); v().play(); return; } v().paused ? v().play() : v().pause(); setFlash({ key: Date.now(), icon: v().paused ? <Play weight="fill" /> : <Pause weight="fill" /> }); };
  const jump = (d: number) => { const to = Math.max(0, (proj.current?.now() ?? 0) + d); void proj.current?.seek(to); setT(to); setFlash({ key: Date.now(), icon: d < 0 ? <ClockCounterClockwise /> : <ClockClockwise />, label: `${d > 0 ? '+' : '−'}${Math.abs(d)} s` }); };
  const seekTo = (to: number) => { setEnded(false); void proj.current?.seek(to); setT(to); };
  const setVol = (x: number) => { const vv = Math.max(0, Math.min(1, x)); v().volume = vv; v().muted = vv === 0; };
  // Téléphone : le plein écran passe en paysage (l'API n'existe qu'en plein écran, et pas sur iPhone)
  const toggleFull = () => {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    stageRef.current?.requestFullscreen().then(() => {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      if (matchMedia('(pointer: coarse)').matches && o?.lock) o.lock('landscape').catch(() => {});
    }).catch(() => {});
  };
  const pip = () => { (document as any).pictureInPictureElement ? (document as any).exitPictureInPicture() : (v() as any).requestPictureInPicture?.().catch(() => {}); };
  const exit = () => { proj.current?.stop(); navigate(`/film/${movieId}`, { replace: true }); };

  const chooseSub = (s: SubtitleTrack | null) => {
    const prev = sub;
    setSub(s);
    const burnBefore = prev && !prev.textBased ? prev.id : null;
    const burnAfter = s && !s.textBased ? s.id : null;
    if (burnBefore !== burnAfter) void proj.current?.restart({ burnSubtitleId: burnAfter });
  };
  const textSubs = film?.subtitles ?? [];
  const cycleSub = () => {
    const list = [null, ...textSubs.filter((s) => s.textBased)];
    const i = list.findIndex((s) => (s?.id ?? null) === (sub?.id ?? null));
    const next = list[(i + 1) % list.length];
    chooseSub(next);
    setFlash({ key: Date.now(), icon: <Subtitles />, label: next ? next.label : 'Sans sous-titres' });
  };
  const nudge = (d: number) => {
    const o = Math.round((offset + d) * 10) / 10;
    setOffset(o);
    void api.patchSubtitleOffset(movieId, o);
    setFlash({ key: Date.now(), icon: <Subtitles />, label: `Décalage ${o > 0 ? '+' : o < 0 ? '−' : '±'}${Math.abs(o).toFixed(1).replace('.', ',')} s` });
  };
  const setSpeed = (r: number) => { v().playbackRate = r; setFlash({ key: Date.now(), icon: <Gauge />, label: `Vitesse ×${String(r).replace('.', ',')}` }); };
  const updateStyle = (p: Partial<SubStyle>) => { const s = { ...style, ...p }; setStyle(s); saveSubStyle(s); };

  // ---------- Clavier et télécommande ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (intro !== 'done' && intro !== 'waiting') return; // l'amorce gère ses propres touches
      const target = e.target as HTMLElement;
      const inControls = target.closest?.('.pctrl, .ppanel, .phelp');
      poke();
      if (isBackKey(e)) {
        e.preventDefault();
        if (help) setHelp(false); else if (menu) setMenu(null); else if (document.fullscreenElement) document.exitFullscreen(); else exit();
        return;
      }
      if (menu || help) return;
      // Télécommande : quand une commande a le focus, les flèches déplacent le focus entre commandes
      if (inControls && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && !target.classList.contains('seek')) {
        const items = [...document.querySelectorAll<HTMLElement>('.pctrl [data-nav]')];
        const i = items.indexOf(target);
        if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); items[i - 1].focus(); }
        if (e.key === 'ArrowRight' && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); document.querySelector<HTMLElement>('.seek')?.focus(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); (document.activeElement as HTMLElement)?.blur(); }
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && inControls && !target.classList.contains('seek')) return; // bouton natif
      switch (e.key) {
        case ' ': case 'k': case 'K': case 'Enter': case 'MediaPlayPause': e.preventDefault(); toggle(); break;
        case 'ArrowLeft': e.preventDefault(); jump(-5); break;
        case 'ArrowRight': e.preventDefault(); jump(5); break;
        case 'j': case 'J': case 'MediaRewind': jump(-10); break;
        case 'l': case 'L': case 'MediaFastForward': jump(10); break;
        case 'ArrowUp':
          e.preventDefault();
          if (!inControls && !ui) { document.querySelector<HTMLElement>('.pctrl [data-nav]')?.focus(); break; }
          setVol(v().volume + 0.1); break;
        case 'ArrowDown': e.preventDefault(); setVol(v().volume - 0.1); break;
        case 'm': case 'M': v().muted = !v().muted; break;
        case 'f': case 'F': toggleFull(); break;
        case 's': case 'S': cycleSub(); break;
        case '[': nudge(-0.1); break;
        case ']': nudge(0.1); break;
        case '<': setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(rate) - 1)] ?? 1); break;
        case '>': setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(rate) + 1)] ?? 1); break;
        case '?': setHelp(true); break;
        default:
          if (/^[0-9]$/.test(e.key) && plan) seekTo((Number(e.key) / 10) * plan.duration);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- Écran tactile : double tape à gauche / à droite = ∓10 s ----------
  const onStageTap = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('.pctrl, .ppanel, .ptop, .phelp, .pend')) return;
    const now = Date.now();
    const x = e.clientX / window.innerWidth;
    if (e.pointerType === 'touch') {
      if (lastTap.current && now - lastTap.current.t < 300) {
        lastTap.current = null;
        if (x < 0.4) jump(-10); else if (x > 0.6) jump(10); else toggle();
        return;
      }
      lastTap.current = { t: now, x };
      setTimeout(() => { if (lastTap.current?.t === now) { lastTap.current = null; ui ? setUi(false) : poke(); } }, 300);
      return;
    }
    toggle();
  };

  const duration = plan?.duration ?? film?.media?.duration ?? 0;
  const chapters = useMemo(() => (film?.media?.chapters ?? []).map((c) => ({ start: c.start, title: c.title })), [film]);
  const shownCues = activeCues(cues, t - offset);
  const accent = film?.palette?.accent;
  const wide = film?.backdrop ?? film?.still;
  const subFont = style.font === 'serif' ? 'var(--font-display)' : style.font === 'mono' ? 'var(--font-mono)' : 'var(--font-text)';
  const audioTracks = film?.media?.audio ?? [];
  const VolIcon = muted || volume === 0 ? SpeakerSlash : volume < 0.5 ? SpeakerLow : SpeakerHigh;
  const modeLabel = plan ? { direct: 'Direct', remux: 'Remux', transcode: 'Transcodage' }[plan.mode] : '';

  if (error) {
    return (
      <main className="player is-error">
        <div className="player__error">
          <ErrorState title="La projection s'est interrompue." code={`ERR · LECTURE · ${film?.title ?? movieId}`}
            action={<><Button variant="secondary" onClick={() => location.reload()}>Relancer</Button><Button variant="quiet" onClick={exit}>Retour à la fiche</Button></>}>
            {error}
          </ErrorState>
        </div>
      </main>
    );
  }

  return (
    <main
      ref={stageRef as any}
      className={`player${ui ? ' is-ui' : ''}${intro === 'done' ? ' is-live' : ''}`}
      style={accent ? ({ ['--film-accent' as string]: accent } as CSSProperties) : undefined}
      onPointerMove={(e) => { if (e.pointerType === 'mouse') poke(); }}
      onPointerUp={onStageTap}
    >
      <video ref={videoRef} className="player__video" playsInline x-webkit-airplay="allow" />

      {/* Sous-titres */}
      {shownCues.length > 0 && intro === 'done' && (
        <div className={`psubs psubs--${style.background}${shownCues.some((c) => c.top) ? ' is-top' : ''}${ui ? ' is-lifted' : ''}`}
          style={{ ['--sub-size' as string]: style.size / 100, ['--sub-lift' as string]: `${style.lift}%`, fontFamily: subFont } as CSSProperties}>
          {shownCues.map((c, i) => <p key={i} className="psubs__line" dangerouslySetInnerHTML={{ __html: c.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/&lt;(\/?)i>/g, '<$1i>').replace(/\n/g, '<br>') }} />)}
        </div>
      )}

      {/* Attente du flux */}
      {buffering && intro === 'done' && !ended && (
        <div className="pwait" aria-live="polite"><FilmReel className="pwait__reel" /><span className="t-mono">Chargement de la bobine</span></div>
      )}

      {/* Retour visuel d'une action */}
      <AnimatePresence>
        {flash && (
          <motion.div key={flash.key} className="pflash" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }} onAnimationComplete={() => setTimeout(() => setFlash((f) => (f?.key === flash.key ? null : f)), 450)}>
            <span className="pflash__icon">{flash.icon}</span>
            {flash.label && <span className="t-mono pflash__label">{flash.label}</span>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Haut : retour, titre */}
      <header className="ptop">
        <button className="ptop__back" onClick={exit} aria-label="Quitter la projection"><ArrowLeft /></button>
        <div className="ptop__title">
          <ReelCode n={pad(movieId, 2)} label={film?.year ?? '—'} />
          <span className="ptop__name">{film?.title}</span>
        </div>
        {plan && <span className="t-mono ptop__mode" title={`${plan.video} · ${plan.audio}`}>{modeLabel}{sub && !sub.textBased ? ' · Incrustation' : ''}</span>}
      </header>

      {/* Commandes */}
      <div className="pctrl" onPointerDown={poke}>
        <SeekBar t={t} duration={duration} avail={proj.current?.avail ?? { from: 0, to: 0 }} chapters={chapters} trick={trick} onSeek={seekTo} onScrub={setScrubbing} />
        <div className="pctrl__row">
          <div className="pctrl__group">
            <button data-nav className="pbtn pbtn--main" onClick={toggle} aria-label={paused ? 'Lecture' : 'Pause'}>{paused ? <Play weight="fill" /> : <Pause weight="fill" />}</button>
            <button data-nav className="pbtn" onClick={() => jump(-10)} aria-label="Reculer de 10 secondes"><ClockCounterClockwise /></button>
            <button data-nav className="pbtn" onClick={() => jump(10)} aria-label="Avancer de 10 secondes"><ClockClockwise /></button>
            <div className="pvol">
              <button data-nav className="pbtn" onClick={() => { v().muted = !v().muted; }} aria-label={muted ? 'Rétablir le son' : 'Couper le son'}><VolIcon /></button>
              <input className="pvol__range" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Volume"
                style={{ ['--p' as string]: `${(muted ? 0 : volume) * 100}%` }} onChange={(e) => setVol(Number(e.target.value))} />
            </div>
            <span className="t-mono ptime"><span className="ptime__now">{clock(t)}</span> / {clock(duration)}</span>
          </div>
          <div className="pctrl__group pctrl__group--end">
            {chapters.length > 1 && <span className="t-mono pchap">{[...chapters].reverse().find((c) => c.start <= t)?.title ?? ''}</span>}
            <button data-nav className={`pbtn${sub ? ' is-on' : ''}`} onClick={() => setMenu(menu === 'subs' ? null : 'subs')} aria-label="Sous-titres" aria-expanded={menu === 'subs'}><Subtitles /></button>
            {audioTracks.length > 1 && <button data-nav className="pbtn" onClick={() => setMenu(menu === 'audio' ? null : 'audio')} aria-label="Piste audio" aria-expanded={menu === 'audio'}><Waveform /></button>}
            <button data-nav className="pbtn" onClick={() => setMenu(menu === 'speed' ? null : 'speed')} aria-label="Vitesse" aria-expanded={menu === 'speed'}><Gauge /></button>
            <button data-nav className="pbtn" onClick={() => setMenu(menu === 'quality' ? null : 'quality')} aria-label="Qualité" aria-expanded={menu === 'quality'}><SlidersHorizontal /></button>
            {'pictureInPictureEnabled' in document && <button data-nav className="pbtn" onClick={pip} aria-label="Image dans l'image"><PictureInPicture /></button>}
            {airplay && <button data-nav className="pbtn" onClick={() => (v() as any).webkitShowPlaybackTargetPicker?.()} aria-label="AirPlay"><Airplay /></button>}
            <button data-nav className="pbtn" onClick={() => setHelp(true)} aria-label="Raccourcis clavier"><Question /></button>
            <button data-nav className="pbtn" onClick={toggleFull} aria-label={full ? 'Quitter le plein écran' : 'Plein écran'}>{full ? <CornersIn /> : <CornersOut />}</button>
          </div>
        </div>

        <AnimatePresence>
          {menu === 'subs' && film && (
            <Panel key="subs" title="Sous-titres" onClose={() => setMenu(null)}>
              <div className="ppanel__cols">
                <div className="ppanel__list" role="menu">
                  <Choice on={!sub} onClick={() => chooseSub(null)}>Aucun</Choice>
                  {film.subtitles.map((s) => (
                    <Choice key={s.id} on={sub?.id === s.id} onClick={() => chooseSub(s)}
                      note={s.textBased ? (s.source === 'external' ? 'Fichier' : 'Intégré') : <span className="pnote--burn">Incrustation</span>}>
                      {s.label}
                    </Choice>
                  ))}
                  {sub && !sub.textBased && <p className="ppanel__warn">Sous-titres image (Blu-ray ou DVD) : ils sont incrustés dans l'image, ce qui demande un transcodage. Taille et police ne s'appliquent pas.</p>}
                </div>
                <div className="ppanel__style">
                  <Slider label="Taille" value={style.size} min={60} max={180} step={10} format={(x) => `${x} %`} onChange={(x) => updateStyle({ size: x })} />
                  <Slider label="Hauteur" value={style.lift} min={2} max={30} step={1} format={(x) => `${x} %`} onChange={(x) => updateStyle({ lift: x })} />
                  <div className="ppanel__field"><span className="t-mono">Police</span>
                    <Segmented label="Police" value={style.font} onChange={(f) => updateStyle({ font: f })} options={[{ value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }]} />
                  </div>
                  <div className="ppanel__field"><span className="t-mono">Fond</span>
                    <Segmented label="Fond" value={style.background} onChange={(b) => updateStyle({ background: b })} options={[{ value: 'none', label: 'Aucun' }, { value: 'shadow', label: 'Ombre' }, { value: 'box', label: 'Bandeau' }]} />
                  </div>
                  <div className="ppanel__offset">
                    <span className="t-mono">Synchronisation · mémorisée pour ce film</span>
                    <div className="ppanel__offrow">
                      <button className="pbtn pbtn--small" onClick={() => nudge(-0.1)} aria-label="Avancer les sous-titres de 0,1 s">−0,1</button>
                      <span className="t-mono ppanel__offval">{offset > 0 ? '+' : offset < 0 ? '−' : '±'}{Math.abs(offset).toFixed(1).replace('.', ',')} s</span>
                      <button className="pbtn pbtn--small" onClick={() => nudge(0.1)} aria-label="Retarder les sous-titres de 0,1 s">+0,1</button>
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          )}
          {menu === 'audio' && (
            <Panel key="audio" title="Piste audio" onClose={() => setMenu(null)}>
              <div className="ppanel__list" role="menu">
                {audioTracks.map((a) => (
                  <Choice key={a.index} on={audioIndex === a.index} onClick={() => { setAudioIndex(a.index); void proj.current?.restart({ audioIndex: a.index }); setMenu(null); }}
                    note={`${a.codec.toUpperCase()} · ${channels(a.channels)}`}>
                    {langName(a.language)}{a.title ? ` — ${a.title}` : ''}
                  </Choice>
                ))}
              </div>
            </Panel>
          )}
          {menu === 'speed' && (
            <Panel key="speed" title="Vitesse" onClose={() => setMenu(null)}>
              <div className="ppanel__list" role="menu">
                {SPEEDS.map((r) => <Choice key={r} on={rate === r} onClick={() => { setSpeed(r); setMenu(null); }}>{r === 1 ? 'Normale' : `×${String(r).replace('.', ',')}`}</Choice>)}
              </div>
            </Panel>
          )}
          {menu === 'quality' && (
            <Panel key="quality" title="Qualité" onClose={() => setMenu(null)}>
              <div className="ppanel__list" role="menu">
                {QUALITIES.map((q) => (
                  <Choice key={q.value} on={quality === q.value} note={q.hint} onClick={() => { setQuality(q.value); void proj.current?.restart({ quality: q.value }); setMenu(null); }}>{q.label}</Choice>
                ))}
              </div>
              {plan && <p className="t-mono ppanel__tech">{plan.video} · {plan.audio}</p>}
            </Panel>
          )}
        </AnimatePresence>
      </div>

      {/* Aide */}
      <AnimatePresence>
        {help && (
          <motion.div className="phelp" role="dialog" aria-label="Raccourcis clavier" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setHelp(false)}>
            <div className="phelp__card">
              <p className="t-mono">Raccourcis · comme VLC et YouTube</p>
              <dl className="phelp__list">
                {HELP.map(([k, d]) => <div key={k}><dt className="t-mono">{k}</dt><dd>{d}</dd></div>)}
              </dl>
              <p className="t-caption">Télécommande : flèches haut / bas pour atteindre les commandes, OK pour valider, Retour pour quitter.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fin */}
      {ended && (
        <div className="pend">
          <p className="pend__fin"><em>Fin</em></p>
          <div className="pend__actions">
            <Button variant="secondary" onClick={exit}>Retour à la fiche</Button>
            <Button variant="quiet" onClick={() => { setEnded(false); seekTo(0); v().play(); }}>Revoir depuis le début</Button>
          </div>
        </div>
      )}

      {/* Séquence de lancement */}
      {intro !== 'done' && (
        <div className="pintro" onClick={skipIntro}>
          {wide && intro === 'closing' && <Img image={wide} sizes="100vw" className="pintro__still" eager />}
          <Curtain />
          {intro === 'leader' && <Leader contained onDone={() => setIntro(ready ? 'done' : 'waiting')} />}
          {intro === 'waiting' && <div className="pwait pwait--intro"><FilmReel className="pwait__reel" /><span className="t-mono">Chargement de la bobine</span></div>}
          {intro === 'closing' && film && <p className="pintro__title"><span className="t-mono">Projection</span><span className="pintro__name">{film.title}</span></p>}
        </div>
      )}
    </main>
  );
}
