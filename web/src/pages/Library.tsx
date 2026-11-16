// Bibliothèque : trois vues (affiches, planche-contact, chronologie), filtres et tris dans l'URL.
import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { MovieSummary } from '@cine/shared';
import { SquaresFour, FilmStrip, Calendar, X, CaretDown } from '@phosphor-icons/react';
import { useMovies, refreshMovies } from '../lib/store';
import { runtime, pad, langName } from '../lib/format';
import { Segmented, Button, Field } from '../components/controls';
import { ReelCode } from '../components/editorial';
import { Poster, Img } from '../components/media';
import { VirtualGrid } from '../components/VirtualGrid';
import { EmptyState, ErrorState, Skeleton } from '../components/states';
import '../styles/library.css';

type View = 'affiches' | 'planche' | 'chrono';
type Sort = 'titre' | 'annee' | 'ajout' | 'duree' | 'seance';

const SORTS: { value: Sort; label: string }[] = [
  { value: 'titre', label: 'Titre' }, { value: 'annee', label: 'Année' }, { value: 'ajout', label: 'Ajout récent' },
  { value: 'duree', label: 'Durée' }, { value: 'seance', label: 'Dernière séance' },
];
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const accent = (m: MovieSummary) => (m.palette?.accent ? ({ ['--film-accent' as string]: m.palette.accent } as CSSProperties) : undefined);

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className={`lselect${value ? ' is-set' : ''}`}>
      <span className="t-mono lselect__label">{label}</span>
      <span className="lselect__box">
        <select value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
        <CaretDown className="lselect__caret" aria-hidden />
      </span>
    </label>
  );
}

// ---------- Planche-contact : un photogramme par film, bords perforés, marquage de bord ----------
function ContactFrame({ m, i }: { m: MovieSummary; i: number }) {
  const img = m.still ?? m.backdrop;
  return (
    <Link to={`/film/${m.id}`} className="contact" style={accent(m)}>
      <span className="contact__perf" aria-hidden />
      <span className="contact__img">
        {img ? <Img image={img} sizes="(max-width: 600px) 46vw, 260px" /> : <span className="contact__blank">{m.title}</span>}
        {m.progress > 0 && !m.watched && <span className="contact__bar"><i style={{ transform: `scaleX(${m.progress})` }} /></span>}
      </span>
      <span className="contact__edge">
        <span className="contact__code">{pad(i + 1, 3)}A ▸</span>
        <span className="contact__title">{m.title}</span>
        <span className="contact__year">{m.year ?? '—'}</span>
      </span>
    </Link>
  );
}

// ---------- Chronologie : décennies, années, films ----------
function Chronology({ items }: { items: MovieSummary[] }) {
  const decades = useMemo(() => {
    const byDecade = new Map<number | null, Map<number | null, MovieSummary[]>>();
    for (const m of [...items].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || collator.compare(a.title, b.title))) {
      const d = m.year ? Math.floor(m.year / 10) * 10 : null;
      const years = byDecade.get(d) ?? new Map();
      years.set(m.year, [...(years.get(m.year) ?? []), m]);
      byDecade.set(d, years);
    }
    return [...byDecade.entries()];
  }, [items]);

  return (
    <div className="chrono">
      {decades.map(([decade, years]) => (
        <section key={decade ?? 'none'} className="chrono__decade" aria-label={decade ? `Années ${decade}` : 'Sans date'}>
          <h2 className="chrono__dlabel">
            {decade ? <><span className="chrono__dnum">{String(decade).slice(2)}</span><span className="t-mono">Années {decade}</span></> : <span className="t-mono">Sans date</span>}
          </h2>
          <ol className="chrono__years" role="list">
            {[...years.entries()].map(([year, films]) => (
              <li key={year ?? 'none'} className="chrono__year">
                <span className="chrono__ynum">{year ?? '—'}</span>
                <ul className="chrono__films" role="list">
                  {films.map((m) => (
                    <li key={m.id} style={accent(m)}>
                      <Link to={`/film/${m.id}`} className="chrono__film">
                        <span className="chrono__thumb">
                          {m.poster ? <Img image={m.poster} sizes="48px" /> : (m.still ?? m.backdrop) ? <Img image={(m.still ?? m.backdrop)!} sizes="96px" /> : null}
                        </span>
                        <span className="chrono__title">{m.title}</span>
                        <span className="t-mono chrono__meta">{[m.directors[0], runtime(m.runtime)].filter(Boolean).join(' · ')}</span>
                        {m.watched && <span className="t-mono chrono__seen">Vu</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function Library() {
  const { movies, error } = useMovies();
  const [params, setParams] = useSearchParams();
  const view = (params.get('vue') as View) || 'affiches';
  const sort = (params.get('tri') as Sort) || 'titre';
  const decade = params.get('decennie') ?? '';
  const seen = params.get('vu') ?? '';
  const genre = params.get('genre') ?? '';
  const lang = params.get('soustitres') ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };

  const options = useMemo(() => {
    const decades = new Set<number>(), genres = new Set<string>(), langs = new Set<string>();
    for (const m of movies ?? []) {
      if (m.year) decades.add(Math.floor(m.year / 10) * 10);
      m.genres.forEach((g) => genres.add(g));
      m.subtitleLanguages.forEach((l) => langs.add(l));
    }
    return {
      decades: [...decades].sort(),
      genres: [...genres].sort(collator.compare),
      langs: [...langs].sort((a, b) => (a === 'fr' ? -1 : b === 'fr' ? 1 : a === 'en' ? -1 : b === 'en' ? 1 : collator.compare(langName(a), langName(b)))),
    };
  }, [movies]);

  const list = useMemo(() => {
    if (!movies) return [];
    const nq = norm(q.trim());
    let r = movies.filter((m) =>
      (!decade || (m.year && Math.floor(m.year / 10) * 10 === Number(decade))) &&
      (!seen || (seen === 'oui' ? m.watched : !m.watched)) &&
      (seen !== 'encours' || (m.progress > 0 && !m.watched)) &&
      (!genre || m.genres.includes(genre)) &&
      (!lang || m.subtitleLanguages.includes(lang)) &&
      (!nq || norm(`${m.title} ${m.originalTitle ?? ''} ${m.directors.join(' ')} ${m.year ?? ''}`).includes(nq)));
    const by: Record<Sort, (a: MovieSummary, b: MovieSummary) => number> = {
      titre: (a, b) => collator.compare(a.title, b.title),
      annee: (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || collator.compare(a.title, b.title),
      ajout: (a, b) => b.addedAt.localeCompare(a.addedAt) || collator.compare(a.title, b.title),
      duree: (a, b) => (a.runtime ?? 0) - (b.runtime ?? 0),
      seance: (a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '') || collator.compare(a.title, b.title),
    };
    r = [...r].sort(by[sort]);
    return r;
  }, [movies, q, decade, seen, genre, lang, sort]);

  const filtered = !!(decade || seen || genre || lang || q);
  const reset = () => { setQ(''); setParams(new URLSearchParams(view !== 'affiches' ? { vue: view } : {}), { replace: true }); };
  const hours = list.reduce((s, m) => s + (m.runtime ?? 0), 0) / 60;

  if (error) {
    return (
      <main className="page wrap lib-state">
        <ErrorState code="ERR · /API/MOVIES" action={<Button onClick={refreshMovies}>Réessayer</Button>}>Le serveur ne répond pas ({error}).</ErrorState>
      </main>
    );
  }

  return (
    <main className="page library">
      <header className="wrap lib-head">
        <ReelCode n="00" label="Catalogue" />
        <h1 className="t-h1 lib-head__title">La <em>bibliothèque</em></h1>
        <p className="t-mono lib-head__count" aria-live="polite">
          {movies ? <>
            {list.length} film{list.length > 1 ? 's' : ''}{filtered ? ` sur ${movies.length}` : ''}
            {list.length > 0 && <> · {Math.floor(hours)} h {pad(Math.round((hours % 1) * 60))} de projection</>}
          </> : 'Chargement…'}
        </p>
      </header>

      <div className="lib-bar">
        <div className="wrap lib-bar__inner">
          <Segmented<View> label="Vue" value={view} onChange={(v) => set('vue', v === 'affiches' ? '' : v)} options={[
            { value: 'affiches', label: 'Affiches', icon: <SquaresFour /> },
            { value: 'planche', label: 'Planche-contact', icon: <FilmStrip /> },
            { value: 'chrono', label: 'Chronologie', icon: <Calendar /> },
          ]} />
          <div className="lib-bar__filters">
            <Field label="Filtrer" className="lib-filter" placeholder="Titre, cinéaste, année…" value={q}
              onChange={(e) => { setQ(e.target.value); set('q', e.target.value); }} />
            <Select label="Décennie" value={decade} onChange={(v) => set('decennie', v)}>
              <option value="">Toutes</option>
              {options.decades.map((d) => <option key={d} value={d}>Années {d}</option>)}
            </Select>
            <Select label="Séances" value={seen} onChange={(v) => set('vu', v)}>
              <option value="">Tous</option>
              <option value="non">Pas encore vus</option>
              <option value="encours">En cours</option>
              <option value="oui">Déjà vus</option>
            </Select>
            {options.genres.length > 0 && (
              <Select label="Genre" value={genre} onChange={(v) => set('genre', v)}>
                <option value="">Tous</option>
                {options.genres.map((g) => <option key={g} value={g}>{g}</option>)}
              </Select>
            )}
            <Select label="Sous-titres" value={lang} onChange={(v) => set('soustitres', v)}>
              <option value="">Toutes langues</option>
              {options.langs.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
            </Select>
            {view !== 'chrono' && (
              <Select label="Tri" value={sort === 'titre' ? '' : sort} onChange={(v) => set('tri', v)}>
                {SORTS.map((s) => <option key={s.value} value={s.value === 'titre' ? '' : s.value}>{s.label}</option>)}
              </Select>
            )}
            {filtered && <Button variant="quiet" icon={<X />} onClick={reset}>Tout effacer</Button>}
          </div>
        </div>
      </div>

      <div className="wrap lib-body">
        {!movies ? (
          <div className="lib-skel">{Array.from({ length: 12 }, (_, i) => <div key={i} className="lib-skel__item"><Skeleton ratio="2 / 3" /><Skeleton h="0.9rem" w="70%" /></div>)}</div>
        ) : list.length === 0 ? (
          movies.length === 0 ? (
            <EmptyState reel="BOB. 00 — Bibliothèque" title="La salle est vide." action={<Link to="/reglages" className="btn btn--secondary"><span className="btn__label">Choisir un dossier de films</span></Link>}>
              Aucun film pour l'instant. Indiquez où se trouvent vos films dans les réglages.
            </EmptyState>
          ) : (
            <EmptyState reel="BOB. ?? — Filtres" title="Aucun film ne correspond." action={<Button variant="secondary" onClick={reset}>Effacer les filtres</Button>}>
              {q ? <>Rien pour « {q} » avec ces filtres.</> : 'Essayez une autre combinaison de filtres.'}
            </EmptyState>
          )
        ) : view === 'affiches' ? (
          <VirtualGrid items={list} keyOf={(m) => m.id} minCol={(w) => (w < 600 ? 140 : 176)} gap={(w) => (w < 600 ? 16 : 28)} ratio={1.5} extra={78}
            render={(m) => <Poster movie={m} href={`/film/${m.id}`} sizes="(max-width: 600px) 45vw, 220px" shared={false} />} />
        ) : view === 'planche' ? (
          <VirtualGrid className="contact-sheet" items={list} keyOf={(m) => m.id} minCol={(w) => (w < 600 ? 160 : 240)} gap={0} ratio={9 / 16} extra={52}
            render={(m, i) => <ContactFrame m={m} i={i} />} />
        ) : (
          <Chronology items={list} />
        )}
      </div>
    </main>
  );
}
