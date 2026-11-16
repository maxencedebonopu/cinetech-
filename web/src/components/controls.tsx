// Contrôles : boutons, sélecteur segmenté, interrupteur, curseur, champ, note.
import { useId, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { motion } from 'motion/react';
import { Star, MagnifyingGlass } from '@phosphor-icons/react';
import { isTv } from '../lib/spatial';
import { EASE_OUT, D2 } from '../lib/motion';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet';
  size?: 'md' | 'lg';
  icon?: ReactNode;
  /** Mention mono après un filet : « 2 H 08 », « REPRISE 42:10 » */
  meta?: ReactNode;
};

export function Button({ variant = 'secondary', size = 'md', icon, meta, children, className = '', ...rest }: ButtonProps) {
  return (
    <button className={`btn btn--${variant} btn--${size} ${className}`} {...rest}>
      {icon && <span className="btn__icon" aria-hidden>{icon}</span>}
      <span className="btn__label">{children}</span>
      {meta && <span className="btn__meta t-mono">{meta}</span>}
    </button>
  );
}

export function IconButton({ label, children, variant = 'ring', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: 'ring' | 'bare' }) {
  return (
    <button className={`ibtn ibtn--${variant} ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

/** Choix exclusif (vues de la bibliothèque, qualité…) ; souligné qui glisse. */
export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const id = useId();
  const move = (e: KeyboardEvent, dir: number) => {
    const i = options.findIndex((o) => o.value === value);
    // télécommande : pas de bouclage aux bords, la navigation spatiale prend le relais
    if (isTv() && (i + dir < 0 || i + dir >= options.length)) return;
    e.preventDefault();
    const next = options[(i + dir + options.length) % options.length];
    onChange(next.value);
    (e.currentTarget.parentElement?.querySelector(`[data-v="${next.value}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            data-v={o.value}
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={`seg__opt${on ? ' is-on' : ''}`}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              // haut / bas restent libres en mode TV pour quitter le sélecteur
              if (e.key === 'ArrowRight' || (e.key === 'ArrowDown' && !isTv())) move(e, 1);
              if (e.key === 'ArrowLeft' || (e.key === 'ArrowUp' && !isTv())) move(e, -1);
            }}
          >
            {o.icon && <span aria-hidden className="seg__icon">{o.icon}</span>}
            {o.label}
            {on && <motion.span layoutId={`seg-${id}`} className="seg__bar" transition={{ duration: D2, ease: EASE_OUT }} />}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle">
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {hint && <span className="t-caption">{hint}</span>}
      </span>
      <button role="switch" aria-checked={checked} className="toggle__track" onClick={() => onChange(!checked)}>
        <span className="toggle__knob" />
        <span className="t-mono toggle__state" aria-hidden>{checked ? 'Oui' : 'Non'}</span>
      </button>
    </label>
  );
}

export function Slider({ label, value, min, max, step = 1, format, onChange }: {
  label: string; value: number; min: number; max: number; step?: number;
  format?: (v: number) => string; onChange: (v: number) => void;
}) {
  const id = useId();
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <div className="slider__head">
        <label htmlFor={id} className="slider__label">{label}</label>
        <output htmlFor={id} className="t-mono slider__value">{format ? format(value) : value}</output>
      </div>
      <input
        id={id} type="range" min={min} max={max} step={step} value={value}
        style={{ ['--p' as string]: `${p}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Field({ label, variant = 'text', className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; variant?: 'text' | 'search' }) {
  const id = useId();
  return (
    <div className={`field field--${variant} ${className}`}>
      <label htmlFor={id} className={variant === 'search' ? 'visually-hidden' : 't-mono field__label'}>{label}</label>
      <div className="field__box">
        {variant === 'search' && <MagnifyingGlass className="field__icon" weight="thin" aria-hidden />}
        <input id={id} {...rest} />
        {variant === 'search' && <kbd className="t-mono field__kbd">Ctrl K</kbd>}
      </div>
    </div>
  );
}

/** Note personnelle sur 5 ; clavier : flèches. */
export function Rating({ value, onChange, label = 'Ma note' }: { value: number | null; onChange?: (v: number | null) => void; label?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const readOnly = !onChange;
  return (
    <div
      className={`rating${readOnly ? ' is-readonly' : ''}`}
      role={readOnly ? 'img' : 'slider'}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={value ?? 0}
      aria-valuetext={value ? `${value} sur 5` : 'Pas de note'}
      tabIndex={readOnly ? undefined : 0}
      onMouseLeave={() => setHover(null)}
      onKeyDown={(e) => {
        if (!onChange) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(5, (value ?? 0) + 1)); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); const v = (value ?? 0) - 1; onChange(v <= 0 ? null : v); }
      }}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`rating__star${n <= shown ? ' is-on' : ''}`}
          onMouseEnter={() => !readOnly && setHover(n)}
          onClick={() => onChange?.(value === n ? null : n)}
        >
          <Star weight={n <= shown ? 'fill' : 'thin'} />
        </span>
      ))}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} />
    </div>
  );
}
