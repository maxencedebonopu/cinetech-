// Accueil : le film à l'affiche, la séance à reprendre, des programmes composés, la séance surprise.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { MovieDetail, MovieSummary } from '@cine/shared';
import { Play, ArrowRight, ClockCounterClockwise } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { useMovies, refreshMovies } from '../lib/store';
import { runtime, clock, definition, channels, pad } from '../lib/format';
import { imgUrl } from '../lib/img';
import { Button } from '../components/controls';
import { ReelCode, Badge, Rule } from '../components/editorial';
import { Poster, KenBurns, Img } from '../components/media';
import { RevealTitle, Letterbox, LightLeak } from '../components/cinema';
import { EmptyState, ErrorState, Skeleton } from '../components/states';
import { Roulette } from '../components/Roulette';
import '../styles/home.css';

// ---------- Tirages reproductibles (le film à l'affiche change chaque jour, pas à chaque visite) ----------
function seeded(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const today = new Date();
const daySeed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
function dailyShuffle<T>(arr: T[], salt = 0) {
  const rnd = seeded(daySeed + salt);
  const r = [...arr];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

const DATE_FR = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const accentStyle = (m: MovieSummary | null | undefined) =>
  m?.palette?.accent ? ({ ['--film-accent' as string]: m.palette.accent } as CSSProperties) : undefined;
const wide = (m: MovieSummary) => m.backdrop ?? m.still;

/** Coupe un titre en deux lignes équilibrées pour la révélation. */
function titleLines(t: string): string[] {
  const words = t.split(' ');
  if (words.length < 3 || t.length < 14) return [t];
  let best = 1, diff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (d < diff) { diff = d; best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

function RowHead({ reel, title, count, more }: { reel: ReactNode; title: ReactNode; count?: string; more?: { to: string; label: string } }) {
  return (
    <header className="rowhead">
      <span className="t-mono rowhead__meta">{reel}</span>
      {count && <span className="t-mono rowhead__count">{count}</span>}
      {more && <Link to={more.to} className="t-mono rowhead__more link">{more.label}</Link>}
      <h2 className="rowhead__title">{title}</h2>
    </header>
  );
}

// ---------- À l'affiche ----------
function Feature({ movie, onProject }: { movie: MovieSummary; onProject: (m: MovieSummary) => void }) {
  const [detail, setDetail] = useState<MovieDetail | null>(null);
  const [frame, setFrame] = useState<'open' | 'scope'>('open');
  useEffect(() => { api.movie(movie.id).then(setDetail).catch(() => {}); }, [movie.id]);
  useEffect(() => {
    if (!matchMedia('(min-aspect-ratio: 13/10)').matches) return;
    const t = setTimeout(() => setFrame('scope'), 700);
    return () => clearTimeout(t);
  }, []);
  const img = wide(movie);
  const media = detail?.media;
  const v = media?.video;
  const audio = media?.audio[0];
  const hasFr = detail?.subtitles.some((s) => s.language === 'fr');
  const resumeAt = movie.progress > 0 && media ? movie.progress * media.duration : 0;
  const long = movie.title.length > 16;

  return (
    <section className="feature" style={accentStyle(movie)} aria-label="À l'affiche">
      {img && <KenBurns image={img} className="feature__img" origin="65% 45%" />}
      <LightLeak />
      <div className="feature__shade" />
      <Letterbox state={frame} color="var(--c-bg)" />
      <div className="feature__content wrap">
        <div className="feature__kicker">
          <ReelCode n={1} label="À l'affiche" />
          <span className="t-mono feature__date">{DATE_FR.format(today)}</span>
        </div>
        {movie.logo ? (
          <h1 className="feature__logo"><img src={imgUrl(movie.logo, movie.logo.widths.at(-1)!)} alt={movie.title} /></h1>
        ) : (
          <RevealTitle className={`feature__title ${long ? 't-h1' : 't-display'}`} lines={titleLines(movie.title)} delay={0.35} />
        )}
        <p className="t-mono feature__meta">
          {[movie.year, runtime(movie.runtime), movie.directors[0]].filter(Boolean).join(' · ')}
        </p>
        {(detail?.overview || detail?.tagline) && <p className="feature__overview">{detail.overview ?? detail.tagline}</p>}
        <div className="feature__badges">
          {v && <Badge>{definition(v.width, v.height)}</Badge>}
          {v && v.hdr !== 'SDR' && <Badge>{v.hdr === 'DV' ? 'Dolby Vision' : v.hdr}</Badge>}
          {audio && <Badge>{channels(audio.channels)}</Badge>}
          {hasFr && <Badge tone="film">VOSTFR</Badge>}
        </div>
        <div className="feature__actions">
          {resumeAt > 60 ? (
            <Button variant="primary" size="lg" icon={<ClockCounterClockwise />} meta={clock(resumeAt)} onClick={() => onProject(movie)}>Reprendre</Button>
          ) : (
            <Button variant="primary" size="lg" icon={<Play weight="fill" />} meta={runtime(movie.runtime)} onClick={() => onProject(movie)}>Projeter</Button>
          )}
          <Link to={`/film/${movie.id}`} className="btn btn--secondary btn--lg"><span className="btn__label">Fiche du film</span><span className="btn__icon" aria-hidden><ArrowRight /></span></Link>
        </div>
      </div>
      {img === movie.still && <p className="t-mono feature__credit">Photogramme</p>}
    </section>
  );
}

// ---------- Reprendre ----------
function Resume({ items, onProject }: { items: MovieSummary[]; onProject: (m: MovieSummary) => void }) {
  return (
    <section className="hsec wrap" aria-labelledby="h-resume">
      <RowHead reel={<ReelCode n={2} label="En cours" />} title={<span id="h-resume">Reprendre <em>la séance</em></span>} count={`${items.length} film${items.length > 1 ? 's' : ''}`} />
      <ul className={`resume resume--${Math.min(items.length, 3)}`} role="list">
        {items.slice(0, 3).map((m) => {
          const total = (m.runtime ?? 0) * 60;
          const left = total * (1 - m.progress);
          const reels = Math.max(1, Math.round(total / 1200));
          const reel = Math.min(reels, Math.floor(m.progress * reels) + 1);
          const img = wide(m);
          return (
            <li key={m.id} style={accentStyle(m)}>
              <button className="resume__item" onClick={() => onProject(m)}>
                <span className="resume__frame">
                  {img ? <Img image={img} sizes="(max-width: 760px) 92vw, 45vw" /> : <span className="resume__blank" />}
                  <span className="resume__play" aria-hidden><Play weight="fill" /></span>
                  <span className="resume__bar"><i style={{ transform: `scaleX(${m.progress})` }} /></span>
                </span>
                <span className="resume__text">
                  <span className="resume__title">{m.title}</span>
                  <span className="t-mono">
                    {total ? `Reste ${runtime(Math.max(1, Math.round(left / 60)))}` : `${Math.round(m.progress * 100)} %`} · Bobine {reel} sur {reels}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- Nouveaux venus : une affiche, une liste ----------
function Arrivals({ items, reel }: { items: MovieSummary[]; reel: number }) {
  const [active, setActive] = useState(0);
  const cur = items[active];
  return (
    <section className="hsec wrap" aria-labelledby="h-new">
      <RowHead reel={<ReelCode n={reel} label="Arrivages" />} title={<span id="h-new">Nouveaux <em>venus</em></span>} more={{ to: '/bibliotheque?tri=ajout', label: 'Tout voir' }} />
      <div className="arrivals">
        <div className="arrivals__poster" style={accentStyle(cur)}>
          <Poster key={cur.id} movie={cur} caption={false} href={`/film/${cur.id}`} sizes="(max-width: 760px) 60vw, 26vw" shared={false} />
        </div>
        <ol className="arrivals__list" role="list">
          {items.map((m, i) => (
            <li key={m.id}>
              <Link
                to={`/film/${m.id}`}
                className={`arrivals__item${i === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                style={accentStyle(m)}
              >
                <span className="t-mono arrivals__no">{pad(i + 1)}</span>
                <span className="arrivals__title">{m.title}</span>
                <span className="t-mono arrivals__meta">{[m.year, m.directors[0], runtime(m.runtime)].filter(Boolean).join(' · ')}</span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ---------- Programme du soir : un horaire de salle ----------
function Tonight({ items, reel, onProject }: { items: MovieSummary[]; reel: number; onProject: (m: MovieSummary) => void }) {
  const slots = useMemo(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
    if (d.getHours() < 18) d.setHours(20, 30);
    const out: { m: MovieSummary; at: Date }[] = [];
    const limit = new Date(d); limit.setHours(24, 45, 0, 0); // dernière séance avant 0 h 45
    for (const m of items) {
      if (out.length && d > limit) break;
      out.push({ m, at: new Date(d) });
      d.setMinutes(d.getMinutes() + (m.runtime ?? 100) + 15);
      d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
    }
    return out;
  }, [items]);
  const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return (
    <section className="hsec wrap" aria-labelledby="h-tonight">
      <RowHead reel={<ReelCode n={reel} label="Programme" />} title={<span id="h-tonight">Ce soir, <em>à l'écran</em></span>} count="Moins de deux heures chacun" />
      <ol className="schedule" role="list">
        {slots.map(({ m, at }) => (
          <li key={m.id} className="schedule__row" style={accentStyle(m)}>
            <span className="schedule__time">{hm(at)}</span>
            <span className="schedule__what">
              <Link to={`/film/${m.id}`} className="schedule__title">{m.title}</Link>
              <span className="t-mono schedule__meta">{[m.year, m.directors[0], m.countries[0]].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="t-mono schedule__dur">{runtime(m.runtime)}</span>
            <button className="schedule__play" onClick={() => onProject(m)} aria-label={`Projeter ${m.title}`}><Play /></button>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------- Une décennie ----------
function Decade({ decade, items, total, reel }: { decade: number; items: MovieSummary[]; total: number; reel: number }) {
  return (
    <section className="hsec wrap decade" aria-labelledby="h-decade">
      <RowHead reel={<ReelCode n={reel} label="Rétrospective" />} title={<span id="h-decade">Les années <em>{decade}</em></span>} count={`${total} films`} more={{ to: `/bibliotheque?decennie=${decade}`, label: 'Tout voir' }} />
      <div className="decade__body">
        <span className="decade__num" aria-hidden>{String(decade).slice(2)}</span>
        <div className="posters-row">
          {items.map((m) => <Poster key={m.id} movie={m} href={`/film/${m.id}`} sizes="(max-width: 760px) 44vw, 14vw" />)}
        </div>
      </div>
    </section>
  );
}

function Unseen({ items, total, reel }: { items: MovieSummary[]; total: number; reel: number }) {
  return (
    <section className="hsec wrap" aria-labelledby="h-unseen">
      <RowHead reel={<ReelCode n={reel} label="En attente" />} title={<span id="h-unseen">Jamais <em>projetés</em></span>} count={`${total} film${total > 1 ? 's attendent' : ' attend'} leur première séance`} more={{ to: '/bibliotheque?vu=non', label: 'Tout voir' }} />
      <div className="posters-row posters-row--6">
        {items.map((m) => <Poster key={m.id} movie={m} href={`/film/${m.id}`} sizes="(max-width: 760px) 44vw, 15vw" />)}
      </div>
    </section>
  );
}

// ---------- Page ----------
export function Home() {
  const { movies, error } = useMovies();
  const navigate = useNavigate();
  const project = (m: MovieSummary) => navigate(`/lecture/${m.id}`);

  const data = useMemo(() => {
    if (!movies?.length) return null;
    const unwatched = movies.filter((m) => !m.watched);
    const featurePool = unwatched.filter((m) => wide(m) && m.progress === 0);
    const feature = dailyShuffle(featurePool.length ? featurePool : movies)[0];
    const resume = movies.filter((m) => m.progress > 0.01 && !m.watched)
      .sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? ''));
    const used = new Set([feature.id, ...resume.slice(0, 3).map((m) => m.id)]);
    const take = (list: MovieSummary[], n: number) => {
      const r = list.filter((m) => !used.has(m.id)).slice(0, n);
      r.forEach((m) => used.add(m.id));
      return r;
    };
    const recent = take([...movies].sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.title.localeCompare(b.title)), 6);
    const tonight = take(dailyShuffle(unwatched.filter((m) => m.runtime && m.runtime <= 120), 7), 4);
    const byDecade = new Map<number, MovieSummary[]>();
    for (const m of movies) if (m.year) { const d = Math.floor(m.year / 10) * 10; byDecade.set(d, [...(byDecade.get(d) ?? []), m]); }
    const [decade, decadeAll] = [...byDecade.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [null, []];
    // Six affiches pleines : on complète au besoin avec des films déjà montrés plus haut
    const decadeFresh = take(dailyShuffle(decadeAll, 3), 6);
    const decadeItems = [...decadeFresh, ...dailyShuffle(decadeAll, 4).filter((m) => !decadeFresh.includes(m))].slice(0, 6);
    const neverAll = movies.filter((m) => !m.watched && !m.lastPlayedAt);
    const never = take(dailyShuffle(neverAll, 5), 6);
    const hours = movies.reduce((s, m) => s + (m.runtime ?? 0), 0) / 60;
    return { feature, resume, recent, tonight, decade, decadeAll, decadeItems, neverAll, never, hours, unwatched };
  }, [movies]);

  if (error) {
    return (
      <main className="page wrap home-state">
        <ErrorState code="ERR · /API/MOVIES" action={<Button onClick={refreshMovies}>Réessayer</Button>}>
          Le serveur ne répond pas ({error}). Vérifiez que la Cinémathèque est lancée sur ce poste.
        </ErrorState>
      </main>
    );
  }
  if (!movies) {
    return (
      <main className="page" aria-busy="true">
        <div className="feature feature--loading"><div className="feature__content wrap"><Skeleton w="12rem" h="0.8rem" /><Skeleton w="min(36rem, 80vw)" h="6rem" /><Skeleton w="20rem" h="0.8rem" /></div></div>
        <div className="hsec wrap"><div className="posters-row posters-row--6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} ratio="2 / 3" />)}</div></div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="page wrap home-state">
        <EmptyState reel="BOB. 00 — Bibliothèque" title="La salle est vide." action={<Link to="/reglages" className="btn btn--secondary"><span className="btn__label">Choisir un dossier de films</span></Link>}>
          Aucun film trouvé pour l'instant. Indiquez où se trouvent vos films : la Cinémathèque les analyse, puis surveille les nouvelles copies.
        </EmptyState>
      </main>
    );
  }

  let reel = data.resume.length ? 3 : 2;
  return (
    <main className="page home">
      <Feature movie={data.feature} onProject={project} />
      {data.resume.length > 0 && <Resume items={data.resume} onProject={project} />}
      {data.recent.length > 0 && <Arrivals items={data.recent} reel={reel++} />}
      {data.tonight.length > 0 && <Tonight items={data.tonight} reel={reel++} onProject={project} />}
      {data.decade && data.decadeItems.length >= 3 && <Decade decade={data.decade} items={data.decadeItems} total={data.decadeAll.length} reel={reel++} />}

      <section className="surprise" aria-labelledby="h-surprise">
        <div className="wrap surprise__inner">
          <div className="surprise__intro">
            <ReelCode n={reel++} label="Hasard" />
            <h2 id="h-surprise" className="t-h2">Séance <em>surprise</em></h2>
            <p className="surprise__text">Pas d'idée ? Laissez la bobine tourner : elle s'arrête sur un film que vous n'avez pas encore vu.</p>
          </div>
          <Roulette pool={data.unwatched.length ? data.unwatched : movies} onProject={project} />
        </div>
      </section>

      {data.never.length >= 3 && <Unseen items={data.never} total={data.neverAll.length} reel={reel++} />}

      <footer className="wrap home-end">
        <Rule variant="double" />
        <p className="t-mono home-end__stats">
          {movies.length} films · {Math.floor(data.hours)} h {pad(Math.round((data.hours % 1) * 60))} de cinéma · {movies.filter((m) => m.watched).length} vus
        </p>
        <p className="home-end__fin"><em>Fin</em></p>
      </footer>
    </main>
  );
}
