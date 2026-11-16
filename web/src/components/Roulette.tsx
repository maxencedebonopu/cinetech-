// Séance surprise : une bobine de titres qui défile puis ralentit jusqu'au film tiré au sort.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { animate, useReducedMotion } from 'motion/react';
import type { MovieSummary } from '@cine/shared';
import { Play, ArrowsClockwise } from '@phosphor-icons/react';
import { Button } from './controls';
import { Poster } from './media';
import { runtime } from '../lib/format';

const LAPS = 3;

function shuffle<T>(a: T[]) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

export function Roulette({ pool, onProject }: { pool: MovieSummary[]; onProject: (m: MovieSummary) => void }) {
  const reduce = useReducedMotion();
  const [strip, setStrip] = useState<MovieSummary[]>(() => shuffle(pool).slice(0, 14));
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'done'>('idle');
  const [pick, setPick] = useState<MovieSummary | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const itemH = useRef(0);

  useLayoutEffect(() => {
    const first = listRef.current?.firstElementChild as HTMLElement | null;
    if (first) itemH.current = first.getBoundingClientRect().height;
  });

  // Défilement lent au repos : la bobine « respire »
  useEffect(() => {
    if (phase !== 'idle' || reduce || !listRef.current) return;
    const ctl = animate(listRef.current, { y: [0, -itemH.current * 6] }, { duration: 24, ease: 'linear', repeat: Infinity, repeatType: 'mirror' });
    return () => ctl.stop();
  }, [phase, reduce, strip]);

  const spin = () => {
    if (!pool.length || phase === 'spinning') return;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    const others = shuffle(pool.filter((m) => m.id !== chosen.id));
    const filler = Array.from({ length: LAPS * 8 }, (_, i) => others[i % Math.max(1, others.length)] ?? chosen);
    const next = [...filler, chosen, ...others.slice(0, 2)];
    const target = filler.length;
    setStrip(next);
    setPick(null);
    setPhase('spinning');
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      const h = (el.firstElementChild as HTMLElement).getBoundingClientRect().height;
      const done = () => { setPick(chosen); setPhase('done'); };
      if (reduce) { el.style.transform = `translateY(${-target * h}px)`; done(); return; }
      animate(el, { y: [0, -target * h] }, { duration: 2.8, ease: [0.12, 0.72, 0.18, 1] }).then(done);
    });
  };

  return (
    <div className={`roulette is-${phase}`}>
      <div className="roulette__window" aria-hidden={phase !== 'done'}>
        <span className="roulette__mark roulette__mark--l" />
        <span className="roulette__mark roulette__mark--r" />
        <ol ref={listRef} className="roulette__strip" role="list">
          {strip.map((m, i) => (
            <li key={`${m.id}-${i}`} className="roulette__item">
              <span className="t-mono roulette__no">{String((i % 99) + 1).padStart(2, '0')}</span>
              <span className="roulette__title">{m.title}</span>
              <span className="t-mono roulette__year">{m.year}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="roulette__panel" aria-live="polite">
        {phase === 'done' && pick ? (
          <div className="roulette__result">
            <div className="roulette__poster"><Poster movie={pick} caption={false} sizes="160px" href={`/film/${pick.id}`} shared={false} /></div>
            <div className="roulette__info">
              <span className="t-mono">Ce soir, la bobine a choisi</span>
              <Link to={`/film/${pick.id}`} className="roulette__pick">{pick.title}</Link>
              <span className="t-mono">{[pick.year, runtime(pick.runtime), pick.directors[0]].filter(Boolean).join(' · ')}</span>
              <div className="roulette__actions">
                <Button variant="primary" icon={<Play weight="fill" />} onClick={() => onProject(pick)}>Projeter</Button>
                <Button variant="quiet" icon={<ArrowsClockwise />} onClick={spin}>Relancer</Button>
              </div>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="lg" onClick={spin} disabled={phase === 'spinning' || !pool.length}>
            {phase === 'spinning' ? 'La bobine tourne…' : 'Lancer la bobine'}
          </Button>
        )}
      </div>
    </div>
  );
}
