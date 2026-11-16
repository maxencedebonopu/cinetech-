// Effets de salle : grain, vignettage, fuites de lumière, titres révélés ligne à ligne,
// cache letterbox, amorce 3-2-1.
import { useEffect, useRef, useState } from 'react';
import type { ElementType, ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { EASE_OUT, D3 } from '../lib/motion';

export function Grain() { return <div className="grain" aria-hidden />; }
export function Vignette() { return <div className="vignette" aria-hidden />; }

/** Fuites de lumière chaudes, très discrètes, qui dérivent lentement. */
export function LightLeak({ className = '' }: { className?: string }) {
  return (
    <div className={`leak ${className}`} aria-hidden>
      <span className="leak__a" />
      <span className="leak__b" />
    </div>
  );
}

/** Titre révélé ligne à ligne (chaque ligne monte depuis sous son filet). */
export function RevealTitle({ lines, as: Tag = 'h1', className = '', delay = 0, stagger = 0.09, play = true }: {
  lines: ReactNode[]; as?: ElementType; className?: string; delay?: number; stagger?: number; play?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <Tag className={`reveal ${className}`}>
      {lines.map((line, i) => (
        <span className="reveal__line" key={i}>
          <motion.span
            className="reveal__inner"
            initial={reduce ? false : { y: '110%' }}
            animate={play ? { y: '0%' } : { y: '110%' }}
            transition={{ duration: D3 * 1.15, ease: EASE_OUT, delay: delay + i * stagger }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}

/**
 * Cache de projection : « open » plein cadre, « scope » bandes 2,39:1, « shut » noir complet.
 * Le parent doit être en position relative.
 */
export function Letterbox({ state, ratio = 2.39, color }: { state: 'open' | 'scope' | 'shut'; ratio?: number; color?: string }) {
  return (
    <div className={`letterbox is-${state}`} style={{ ['--lb-ratio' as string]: ratio, ['--lb-color' as string]: color }} aria-hidden>
      <span className="letterbox__bar letterbox__bar--top" />
      <span className="letterbox__bar letterbox__bar--bottom" />
    </div>
  );
}

/**
 * Amorce de projection 3-2-1 (≈ 2 s). Passable au clic, Échap, Entrée ou Espace.
 * `contained` : dans son parent (démo) plutôt qu'en plein écran.
 */
export function Leader({ onDone, contained = false }: { onDone: () => void; contained?: boolean }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(3);
  const [flash, setFlash] = useState(false);
  const done = useRef(false);
  const finish = () => { if (!done.current) { done.current = true; onDone(); } };

  useEffect(() => {
    if (reduce) { finish(); return; }
    const STEP = 620;
    const t = [
      setTimeout(() => setN(2), STEP),
      setTimeout(() => setN(1), STEP * 2),
      setTimeout(() => setFlash(true), STEP * 3),
      setTimeout(finish, STEP * 3 + 140),
    ];
    const key = (e: KeyboardEvent) => { if (['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); finish(); } };
    window.addEventListener('keydown', key);
    return () => { t.forEach(clearTimeout); window.removeEventListener('keydown', key); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`leader${contained ? ' is-contained' : ''}${flash ? ' is-flash' : ''}`} onClick={finish} role="presentation">
      <div className="leader__frame">
        <span className="leader__cross leader__cross--h" />
        <span className="leader__cross leader__cross--v" />
        <span className="leader__ring leader__ring--outer" />
        <span className="leader__ring leader__ring--inner" />
        <span className="leader__sweep" key={n} />
        <span className="leader__num" key={`n${n}`}>{n}</span>
      </div>
      <span className="leader__skip t-mono">Passer · Échap</span>
    </div>
  );
}
