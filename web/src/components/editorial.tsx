// Éléments éditoriaux : codes de bobine, filets, en-têtes de section, badges, fiche technique, nuancier.
import type { ReactNode } from 'react';
import { pad } from '../lib/format';
import type { TechRow } from '../lib/format';

/** « BOB. 02 — 1958 » : repère de bobine en mono. */
export function ReelCode({ n, label, className = '' }: { n: number | string; label?: ReactNode; className?: string }) {
  return (
    <span className={`t-mono reel ${className}`}>
      BOB.&nbsp;{typeof n === 'number' ? pad(n) : n}
      {label != null && <><span className="reel__dash" aria-hidden> — </span>{label}</>}
    </span>
  );
}

export function Rule({ variant = 'hair', className = '' }: { variant?: 'hair' | 'double' | 'strong'; className?: string }) {
  return <hr className={`rule rule--${variant} ${className}`} />;
}

/** Filet avec une légende au milieu : ── ENTRACTE ── */
export function LabeledRule({ children }: { children: ReactNode }) {
  return (
    <div className="lrule" role="separator">
      <span className="lrule__line" />
      <span className="t-mono">{children}</span>
      <span className="lrule__line" />
    </div>
  );
}

export function SectionHead({ reel, page, title, kicker, id }: { reel: number; page?: number; title: ReactNode; kicker?: ReactNode; id?: string }) {
  return (
    <header className="shead" id={id}>
      <div className="shead__meta">
        <ReelCode n={reel} />
        {page != null && <span className="t-mono shead__page">p.&nbsp;{pad(page)}</span>}
      </div>
      <h2 className="t-h2 shead__title">{title}</h2>
      {kicker && <p className="shead__kicker">{kicker}</p>}
    </header>
  );
}

export function Badge({ children, tone = 'plain', title }: { children: ReactNode; tone?: 'plain' | 'film' | 'velvet' | 'solid'; title?: string }) {
  return <span className={`badge badge--${tone} t-mono`} title={title}>{children}</span>;
}

/** Fiche technique façon programme de salle : libellé · pointillés · valeur. */
export function TechSheet({ rows, className = '' }: { rows: TechRow[]; className?: string }) {
  return (
    <dl className={`tech ${className}`}>
      {rows.map((r, i) => (
        <div className="tech__row" key={i}>
          <dt className="tech__label">{r.label}</dt>
          <span className="tech__leader" aria-hidden />
          <dd className="tech__value">
            {r.value}
            {r.note && <span className="tech__note">{r.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Swatches({ colors, active }: { colors: { hex: string; name: string }[]; active?: string }) {
  return (
    <ul className="swatches" role="list">
      {colors.map((c) => (
        <li key={c.name} className={`swatch${active && c.hex.toLowerCase() === active.toLowerCase() ? ' is-active' : ''}`}>
          <span className="swatch__chip" style={{ background: c.hex }} />
          <span className="t-mono swatch__hex">{c.hex.toUpperCase()}</span>
          <span className="swatch__name">{c.name}</span>
        </li>
      ))}
    </ul>
  );
}
