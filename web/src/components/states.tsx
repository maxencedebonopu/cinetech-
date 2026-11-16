// États : salle vide, bobine perdue, chargement, messages passagers.
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { EASE_OUT, D2 } from '../lib/motion';

/** Pellicule vide dessinée au trait. */
function EmptyReel() {
  return (
    <svg className="state__art" viewBox="0 0 240 120" fill="none" aria-hidden>
      <rect x="0.5" y="10.5" width="239" height="99" stroke="currentColor" />
      {Array.from({ length: 12 }, (_, i) => (
        <g key={i}>
          <rect x={8 + i * 19.5} y="16" width="9" height="7" stroke="currentColor" />
          <rect x={8 + i * 19.5} y="97" width="9" height="7" stroke="currentColor" />
        </g>
      ))}
      {[0, 1, 2].map((i) => <rect key={i} x={10 + i * 76} y="32.5" width="68" height="55" stroke="currentColor" strokeDasharray={i === 1 ? '0' : '2 3'} />)}
    </svg>
  );
}

export function EmptyState({ reel, title, children, action }: { reel?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="state state--empty">
      <EmptyReel />
      {reel && <span className="t-mono state__reel">{reel}</span>}
      <h3 className="state__title">{title}</h3>
      {children && <p className="state__text">{children}</p>}
      {action && <div className="state__action">{action}</div>}
    </section>
  );
}

export function ErrorState({ title = 'Bobine perdue.', code, children, action }: { title?: ReactNode; code?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="state state--error" role="alert">
      <span className="state__burn" aria-hidden />
      {code && <span className="t-mono state__reel state__code">{code}</span>}
      <h3 className="state__title">{title}</h3>
      {children && <p className="state__text">{children}</p>}
      {action && <div className="state__action">{action}</div>}
    </section>
  );
}

/** Bloc de chargement : scintillement de projecteur plutôt qu'un balayage brillant. */
export function Skeleton({ ratio, w, h, className = '' }: { ratio?: string; w?: string; h?: string; className?: string }) {
  return <span className={`skeleton ${className}`} style={{ aspectRatio: ratio, width: w, height: h }} aria-hidden />;
}

export function Toast({ message, meta, open, onClose, duration = 4200 }: { message: ReactNode; meta?: ReactNode; open: boolean; onClose: () => void; duration?: number }) {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [open, duration, onClose]);
  return (
    <div className="toast-zone" aria-live="polite">
      <AnimatePresence>
        {open && (
          <motion.div
            className="toast"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 12, opacity: 0 }}
            transition={{ duration: D2, ease: EASE_OUT }}
          >
            <span className="toast__msg">{message}</span>
            {meta && <span className="t-mono toast__meta">{meta}</span>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
