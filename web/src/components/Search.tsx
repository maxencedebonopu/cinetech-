// Recherche : surimpression ouverte par Ctrl K ou « / », pilotable entièrement au clavier.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import type { MovieSummary } from '@cine/shared';
import { MagnifyingGlass, X, ArrowRight, Play } from '@phosphor-icons/react';
import { useMovies } from '../lib/store';
import { runtime } from '../lib/format';
import { Img } from './media';
import { EASE_OUT, D1 } from '../lib/motion';

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const RECENT_KEY = 'cine.search.recent';

function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

/** Pertinence : titre qui commence par la requête > mot qui commence > contenu > faute de frappe légère. */
function score(m: MovieSummary, q: string): number {
  const t = norm(m.title), o = norm(m.originalTitle ?? '');
  const people = norm(m.directors.join(' '));
  if (t === q || o === q) return 100;
  if (t.startsWith(q) || o.startsWith(q)) return 80;
  const words = `${t} ${o}`.split(/[\s\-:'’.,]+/);
  if (words.some((w) => w.startsWith(q))) return 60;
  if (t.includes(q) || o.includes(q)) return 45;
  if (people.split(/\s+/).some((w) => w.startsWith(q))) return 40;
  if (m.year && String(m.year) === q) return 35;
  if (q.length >= 4 && words.some((w) => w.length >= 4 && lev(w, q) <= (q.length > 6 ? 2 : 1))) return 20;
  return 0;
}

/** Met en évidence la partie trouvée du titre. */
function highlight(title: string, q: string): ReactNode {
  const i = norm(title).indexOf(q);
  if (!q || i < 0) return title;
  return <>{title.slice(0, i)}<mark>{title.slice(i, i + q.length)}</mark>{title.slice(i + q.length)}</>;
}

type Row = { kind: 'film'; m: MovieSummary; group?: string } | { kind: 'link'; label: string; meta: string; to: string; group?: string };

export function Search() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; } });
  const { movies } = useMovies();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.matches?.('input, textarea, select, [contenteditable="true"]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === '/' && !typing && !location.pathname.startsWith('/lecture')) { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener('cine:search', onOpen);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('cine:search', onOpen); window.removeEventListener('keydown', onKey); };
  }, []);
  useEffect(() => {
    if (!open) return;
    setSel(0);
    const prev = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => input.current?.select());
    document.documentElement.style.overflow = 'hidden';
    return () => { document.documentElement.style.overflow = ''; prev?.focus?.(); };
  }, [open]);

  const nq = norm(q.trim());
  const rows: Row[] = useMemo(() => {
    if (!movies) return [];
    if (!nq) {
      const latest = [...movies].filter((m) => m.lastPlayedAt).sort((a, b) => b.lastPlayedAt!.localeCompare(a.lastPlayedAt!)).slice(0, 4);
      // Complète avec des films jamais vus, tirés au hasard du jour
      const day = new Date().getDate();
      const unseen = movies.filter((m) => !m.watched && m.progress === 0 && !latest.includes(m)).sort((a, b) => ((a.id * 7 + day) % 13) - ((b.id * 7 + day) % 13)).slice(0, 6 - latest.length);
      return [
        ...latest.map((m): Row => ({ kind: 'film', m, group: 'Dernières séances' })),
        ...unseen.map((m): Row => ({ kind: 'film', m, group: 'À découvrir' })),
      ];
    }
    const films: Row[] = movies.map((m) => ({ m, s: score(m, nq) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.m.title.localeCompare(b.m.title)).slice(0, 8).map((x) => ({ kind: 'film', m: x.m, group: 'Films' }));
    const links: Row[] = [];
    const directors = [...new Set(movies.flatMap((m) => m.directors))].filter((d) => norm(d).split(/\s+/).some((w) => w.startsWith(nq)) || norm(d).includes(nq));
    for (const d of directors.slice(0, 3)) {
      const n = movies.filter((m) => m.directors.includes(d)).length;
      links.push({ kind: 'link', label: d, meta: `Cinéaste · ${n} film${n > 1 ? 's' : ''}`, to: `/bibliotheque?q=${encodeURIComponent(d)}`, group: 'Ailleurs' });
    }
    const dec = nq.match(/^(?:annees?\s*)?(19|20)?(\d)0s?$/);
    if (/^\d{4}$/.test(nq) || dec) {
      const decade = /^\d{4}$/.test(nq) ? Math.floor(Number(nq) / 10) * 10 : Number(`${dec![1] ?? (Number(dec![2]) >= 3 ? '19' : '20')}${dec![2]}0`);
      const n = movies.filter((m) => m.year && Math.floor(m.year / 10) * 10 === decade).length;
      if (n) links.push({ kind: 'link', label: `Les années ${decade}`, meta: `Décennie · ${n} film${n > 1 ? 's' : ''}`, to: `/bibliotheque?decennie=${decade}&vue=chrono`, group: 'Ailleurs' });
    }
    return [...films, ...links];
  }, [movies, nq]);
  useEffect(() => { setSel(0); }, [nq]);
  useEffect(() => { list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const remember = () => {
    if (!q.trim()) return;
    const r = [q.trim(), ...recent.filter((x) => x !== q.trim())].slice(0, 6);
    setRecent(r);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch { /* */ }
  };
  const go = (row: Row, play = false) => {
    remember();
    setOpen(false);
    setQ('');
    if (row.kind === 'film') navigate(play ? `/lecture/${row.m.id}` : `/film/${row.m.id}`);
    else navigate(row.to);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); if (q) setQ(''); else setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter' && rows[sel]) { e.preventDefault(); go(rows[sel], e.shiftKey); }
  };

  const filmCount = rows.filter((r) => r.kind === 'film').length;
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="search" role="dialog" aria-modal="true" aria-label="Rechercher"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: D1 * 0.6 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }} onKeyDown={onKey}>
          <motion.div className="search__panel" initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={{ duration: D1, ease: EASE_OUT }}>
            <div className="search__field">
              <MagnifyingGlass className="search__icon" aria-hidden />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Un titre, un cinéaste, une année…"
                aria-label="Rechercher" aria-controls="search-results" aria-activedescendant={rows[sel] ? `sr-${sel}` : undefined}
                role="combobox" aria-expanded={rows.length > 0} autoComplete="off" spellCheck={false} />
              <button className="search__close" onClick={() => setOpen(false)} aria-label="Fermer"><X /></button>
            </div>

            {!nq && recent.length > 0 && (
              <div className="search__recent">
                <span className="t-mono">Recherches récentes</span>
                <div className="search__chips">{recent.map((r) => <button key={r} className="search__chip" onClick={() => setQ(r)}>{r}</button>)}</div>
              </div>
            )}

            {rows.length > 0 ? (
              <>
                <ol id="search-results" ref={list} className="search__list" role="listbox">
                  {rows.map((r, i) => [
                    r.group && r.group !== rows[i - 1]?.group && (
                      <li key={`g${r.group}`} className="t-mono search__label" role="presentation">
                        {r.group === 'Films' ? `${filmCount} film${filmCount > 1 ? 's' : ''}` : r.group}
                      </li>
                    ),
                    r.kind === 'film' ? (
                    <li key={`f${r.m.id}`} id={`sr-${i}`} data-i={i} role="option" aria-selected={i === sel}
                      className={`search__row${i === sel ? ' is-sel' : ''}`} onMouseMove={() => setSel(i)} onClick={() => go(r)}
                      style={r.m.palette?.accent ? ({ ['--film-accent' as string]: r.m.palette.accent } as CSSProperties) : undefined}>
                      <span className="search__thumb">{(r.m.poster ?? r.m.still) && <Img image={(r.m.poster ?? r.m.still)!} sizes="64px" />}</span>
                      <span className="search__text">
                        <span className="search__title">{highlight(r.m.title, nq)}</span>
                        <span className="t-mono">{[r.m.year, r.m.directors[0], runtime(r.m.runtime)].filter(Boolean).join(' · ')}{r.m.watched ? ' · Vu' : r.m.progress > 0 ? ` · En cours ${Math.round(r.m.progress * 100)} %` : ''}</span>
                      </span>
                      <button className="search__play" tabIndex={-1} aria-label={`Projeter ${r.m.title}`} onClick={(e) => { e.stopPropagation(); go(r, true); }}><Play /></button>
                    </li>
                  ) : (
                    <li key={`l${r.to}`} id={`sr-${i}`} data-i={i} role="option" aria-selected={i === sel}
                      className={`search__row search__row--link${i === sel ? ' is-sel' : ''}`} onMouseMove={() => setSel(i)} onClick={() => go(r)}>
                      <span className="search__thumb search__thumb--link"><ArrowRight /></span>
                      <span className="search__text"><span className="search__title">{r.label}</span><span className="t-mono">{r.meta}</span></span>
                    </li>
                  )])}
                </ol>
              </>
            ) : nq ? (
              <div className="search__empty">
                <p className="search__empty-title"><em>Rien à l'affiche pour « {q.trim()} ».</em></p>
                <p className="t-caption">Essayez le titre original, un nom de cinéaste ou une année.</p>
              </div>
            ) : null}

            <p className="t-mono search__keys"><kbd>↑↓</kbd> naviguer <kbd>↵</kbd> ouvrir la fiche <kbd>⇧ ↵</kbd> projeter <kbd>Échap</kbd> fermer</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
