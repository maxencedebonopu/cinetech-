// Statistiques : « Le registre ». Ce qui a été projeté (par année ou depuis le début) et l'état de la collection.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Count, MovieSummary, Stats as StatsData } from '@cine/shared';
import { api, ApiError } from '../lib/api';
import { useMovies } from '../lib/store';
import { pad } from '../lib/format';
import { ReelCode } from '../components/editorial';
import { Segmented, Button } from '../components/controls';
import { Img } from '../components/media';
import { EmptyState, ErrorState, Skeleton } from '../components/states';
import '../styles/stats.css';

const nf = new Intl.NumberFormat('fr-FR');
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const longDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

const accent = (m?: MovieSummary) => (m?.palette?.accent ? ({ ['--film-accent' as string]: m.palette.accent } as CSSProperties) : undefined);
const plural = (n: number, one: string, many = `${one}s`) => `${nf.format(n)} ${n > 1 ? many : one}`;
function hours(sec: number): [string, string] {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? [`${nf.format(h)}`, `h ${pad(m)}`] : [`${m}`, 'min'];
}
const hm = (sec: number) => hours(sec).join(' ');
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---------- Info-bulle partagée (survol et focus) ----------
function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: ReactNode } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const show = (el: Element, text: ReactNode) => {
    // une barre : la bulle se pose sur son sommet, pas en haut de la zone de survol
    const h = host.current?.getBoundingClientRect(), r = (el.querySelector('i') ?? el).getBoundingClientRect();
    if (h) setTip({ x: r.left + r.width / 2 - h.left, y: r.top - h.top, text });
  };
  const bind = (text: ReactNode) => ({
    onPointerEnter: (e: React.PointerEvent) => show(e.currentTarget, text),
    onPointerLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => show(e.currentTarget, text),
    onBlur: () => setTip(null),
  });
  const node = tip && (
    <span className="tip t-mono" role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</span>
  );
  return { host, bind, node };
}

// ---------- Morceaux ----------
function Figure({ value, unit, label, note }: { value: string; unit?: string; label: string; note?: ReactNode }) {
  return (
    <div className="fig">
      <span className="t-mono fig__label">{label}</span>
      <span className="fig__value">{value}{unit && <small>{unit}</small>}</span>
      {note && <span className="fig__note">{note}</span>}
    </div>
  );
}

function Head({ reel, title, children }: { reel: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="rowhead st-head">
      <ReelCode n={reel} className="rowhead__meta" />
      <h2 className="rowhead__title">{title}</h2>
      {children && <p className="st-head__kicker">{children}</p>}
    </header>
  );
}

/** Liste classée : libellé, filet proportionnel, valeur. Une seule série, une seule teinte. */
function Ranked({ items, format = (n) => nf.format(n), max, empty }: { items: Count[]; format?: (n: number) => string; max?: number; empty?: ReactNode }) {
  if (!items.length) return <p className="st-none">{empty ?? 'Rien à compter pour l\'instant.'}</p>;
  const top = max ?? Math.max(...items.map((i) => i.count));
  return (
    <ol className="ranked" role="list">
      {items.map((i) => (
        <li key={i.label} className="ranked__row">
          <span className="ranked__label">{i.label}</span>
          <span className="ranked__bar" aria-hidden><i style={{ transform: `scaleX(${top ? i.count / top : 0})` }} /></span>
          <span className="t-mono ranked__value">{format(i.count)}</span>
        </li>
      ))}
    </ol>
  );
}

function Thumb({ m }: { m?: MovieSummary }) {
  const img = m?.poster ?? m?.still ?? m?.backdrop;
  return <span className={`st-thumb${m?.poster ? '' : ' st-thumb--wide'}`}>{img && <Img image={img} sizes="64px" />}</span>;
}

// ---------- Registre jour par jour ----------
function Calendar({ daily, year }: { daily: Record<string, number>; year: number | null }) {
  const { host, bind, node } = useTip();
  const scroller = useRef<HTMLDivElement>(null);
  const { weeks, months } = useMemo(() => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const end = year == null || year === today.getFullYear() ? today : new Date(year, 11, 31, 12);
    const start = year == null ? new Date(end.getFullYear(), end.getMonth(), end.getDate() - 364, 12) : new Date(year, 0, 1, 12);
    const first = new Date(start); first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const weeks: (Date | null)[][] = [];
    const months: { col: number; label: string }[] = [];
    for (const d = new Date(first); d <= end; d.setDate(d.getDate() + 7)) {
      const week: (Date | null)[] = [];
      for (let i = 0; i < 7; i++) {
        const day = new Date(d); day.setDate(d.getDate() + i);
        week.push(day < start || day > end ? null : day);
        if (day.getDate() === 1 && day >= start && day <= end) months.push({ col: weeks.length, label: MONTHS[day.getMonth()] });
      }
      weeks.push(week);
    }
    return { weeks, months };
  }, [year]);
  useEffect(() => { const s = scroller.current; if (s) s.scrollLeft = s.scrollWidth; }, [weeks]);
  const level = (min: number) => (min <= 0 ? 0 : min < 45 ? 1 : min < 110 ? 2 : min < 200 ? 3 : 4);

  return (
    <div className="cal" ref={host}>
      <div className="cal__scroll" ref={scroller}>
        <div className="cal__grid" style={{ ['--weeks' as string]: weeks.length } as CSSProperties}>
          <span className="cal__months" aria-hidden>
            {months.map((m) => <span key={`${m.col}-${m.label}`} className="t-mono" style={{ gridColumn: m.col + 1 }}>{m.label}</span>)}
          </span>
          <span className="cal__days t-mono" aria-hidden><span>L</span><span /><span>M</span><span /><span>V</span><span /><span>D</span></span>
          <div className="cal__cells" role="list" aria-label="Minutes de projection par jour">
            {weeks.flatMap((w, wi) => w.map((d, di) => {
              if (!d) return <span key={`${wi}-${di}`} className="cal__cell is-out" aria-hidden />;
              const min = daily[keyOf(d)] ?? 0;
              const text = `${longDay.format(d)} · ${min ? hm(min * 60) : 'relâche'}`;
              return <span key={`${wi}-${di}`} role="listitem" aria-label={text} className="cal__cell" data-l={level(min)} {...bind(text)} />;
            }))}
          </div>
        </div>
      </div>
      <div className="cal__legend t-mono" aria-hidden>
        <span>Relâche</span>{[0, 1, 2, 3, 4].map((l) => <span key={l} className="cal__cell" data-l={l} />)}<span>Plus de 3 h</span>
      </div>
      {node}
    </div>
  );
}

// ---------- Rythme : heures et jours ----------
function Hours({ byHour }: { byHour: number[] }) {
  const { host, bind, node } = useTip();
  // la journée de cinéma commence à 6 h : la nuit reste à droite
  const order = Array.from({ length: 24 }, (_, i) => (i + 6) % 24);
  const max = Math.max(1, ...byHour);
  const peak = byHour.indexOf(Math.max(...byHour));
  return (
    <figure className="hours" ref={host}>
      <figcaption className="st-cap">
        <span className="t-mono">Heure de début</span>
        <span className="st-cap__big">Séance de <em>{peak} h</em></span>
      </figcaption>
      <div className="hours__bars" role="list" aria-label="Temps de projection selon l'heure de début">
        {order.map((h) => (
          <span key={h} role="listitem" tabIndex={0} className={`hours__bar${h === peak ? ' is-peak' : ''}`} aria-label={`${h} h : ${hm(byHour[h])}`} {...bind(`${h} h · ${byHour[h] ? hm(byHour[h]) : '—'}`)}>
            <i style={{ height: `${(byHour[h] / max) * 100}%` }} />
          </span>
        ))}
      </div>
      <div className="hours__axis t-mono" aria-hidden>
        {order.map((h) => <span key={h}>{h % 6 === 0 ? `${h} h` : ''}</span>)}
      </div>
      {node}
    </figure>
  );
}

function Weekdays({ byWeekday }: { byWeekday: number[] }) {
  const max = Math.max(1, ...byWeekday);
  const peak = byWeekday.indexOf(Math.max(...byWeekday));
  return (
    <figure className="weekdays">
      <figcaption className="st-cap">
        <span className="t-mono">Jour de la semaine</span>
        <span className="st-cap__big">Le <em>{DAYS[peak].toLowerCase()}</em></span>
      </figcaption>
      <Ranked items={DAYS.map((label, i) => ({ label, count: byWeekday[i] }))} max={max} format={(s) => (s ? hm(s) : '—')} />
    </figure>
  );
}

// ---------- Page ----------
export function Stats() {
  const [params, setParams] = useSearchParams();
  const year = params.get('annee');
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { movies } = useMovies();
  const byId = useMemo(() => new Map((movies ?? []).map((m) => [m.id, m])), [movies]);

  const load = () => {
    setError(null);
    api.stats(year).then(setData).catch((e: ApiError) => setError(e.message));
  };
  useEffect(load, [year]);

  if (error) {
    return (
      <main className="page wrap st-state">
        <ErrorState code="ERR · /API/STATS" action={<Button onClick={load}>Réessayer</Button>}>Le serveur ne répond pas ({error}).</ErrorState>
      </main>
    );
  }

  const v = data?.viewing, c = data?.collection;
  const periodLabel = data?.year ? `en ${data.year}` : 'depuis le début';
  const yearOptions = [{ value: '', label: 'Depuis le début' }, ...(data?.years ?? []).slice(0, 4).map((y) => ({ value: String(y), label: String(y) }))];
  const seenShare = c && c.films ? Math.round((c.watched / c.films) * 100) : 0;
  const ratingsTotal = data?.ratings.reduce((s, n) => s + n, 0) ?? 0;

  return (
    <main className="page stats">
      <header className="wrap st-top">
        <ReelCode n="00" label="Registre" />
        <h1 className="t-h1 st-top__title">Le <em>registre</em></h1>
        <div className="st-top__bar">
          <p className="t-mono st-top__sub">
            {data ? <>Ce qui a été projeté {periodLabel}, et ce que contient la collection.</> : 'Chargement…'}
          </p>
          {data && data.years.length > 0 && (
            <Segmented label="Période" value={year ?? ''} options={yearOptions}
              onChange={(y) => setParams(y ? { annee: y } : {}, { replace: true })} />
          )}
        </div>
      </header>

      {!data || !v || !c ? (
        <div className="wrap st-skel" aria-busy="true">
          <Skeleton h="9rem" /><Skeleton h="12rem" /><Skeleton h="16rem" />
        </div>
      ) : (
        <>
          {/* ---- Projection ---- */}
          {v.sessions === 0 ? (
            <section className="wrap st-sec">
              <EmptyState reel="BOB. 01 — Registre vierge" title={data.years.length ? `Aucune séance ${periodLabel}.` : 'Le registre est vierge.'}
                action={<Link className="btn btn--secondary" to="/bibliotheque"><span className="btn__label">Choisir un film</span></Link>}>
                Chaque projection de plus d'une minute s'inscrit ici : durée, heure, film. La collection est décrite plus bas.
              </EmptyState>
            </section>
          ) : (
            <>
              <section className="wrap st-figs" aria-label="En chiffres">
                <Figure label="Projection" value={hours(v.seconds)[0]} unit={hours(v.seconds)[1]} note={`soit ${nf1.format(v.seconds / 3600 / Math.max(1, v.days))} h par soir de séance`} />
                <Figure label="Séances" value={nf.format(v.sessions)} note={plural(v.days, 'soir', 'soirs') + ' de cinéma'} />
                <Figure label="Films" value={nf.format(v.films)} note={c.films ? `${Math.round((v.films / c.films) * 100)} % de la collection` : undefined} />
                <Figure label="Plus longue série" value={nf.format(v.longestStreak)} unit={v.longestStreak > 1 ? 'jours' : 'jour'} note="d'affilée avec une séance" />
              </section>

              <section className="wrap st-sec">
                <Head reel="01" title={<>Jour après <em>jour</em></>}>
                  {data.year ? `Chaque case est un jour de ${data.year}.` : 'Les 52 dernières semaines, un jour par case.'} Plus elle est claire, plus la séance a été longue.
                </Head>
                <Calendar daily={v.daily} year={data.year} />
              </section>

              <section className="wrap st-sec st-two">
                <Hours byHour={v.byHour} />
                <Weekdays byWeekday={v.byWeekday} />
              </section>

              <section className="wrap st-sec">
                <Head reel="02" title={<>Les plus <em>revus</em></>} />
                <div className="st-two st-two--wide">
                  <ol className="top" role="list">
                    {v.top.map((t, i) => {
                      const m = byId.get(t.movieId);
                      return (
                        <li key={t.movieId} style={accent(m)}>
                          <Link to={`/film/${t.movieId}`} className="top__row">
                            <span className="top__rank">{i + 1}</span>
                            <Thumb m={m} />
                            <span className="top__text">
                              <span className="top__title">{m?.title ?? '…'}</span>
                              <span className="t-mono top__meta">{[m?.directors[0], m?.year].filter(Boolean).join(' · ')}</span>
                            </span>
                            <span className="top__count"><b>{t.sessions}</b><span className="t-mono">{t.sessions > 1 ? 'séances' : 'séance'}<span className="top__hours"> · {hm(t.seconds)}</span></span></span>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="journal">
                    <h3 className="t-mono journal__title">Journal de cabine</h3>
                    <ol role="list">
                      {v.journal.map((j) => {
                        const m = byId.get(j.movieId), d = new Date(j.startedAt);
                        return (
                          <li key={j.startedAt + j.movieId} className="journal__row" style={accent(m)}>
                            <span className="t-mono journal__date">{dayFmt.format(d)} · {timeFmt.format(d)}</span>
                            <Link to={`/film/${j.movieId}`} className="journal__film">{m?.title ?? '…'}</Link>
                            <span className="t-mono journal__dur">{hm(j.seconds)}</span>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </div>
              </section>

              <section className="wrap st-sec">
                <Head reel="03" title={<>Ce qui a été <em>regardé</em></>}>Temps de projection {periodLabel}, par décennie de sortie, genre et cinéaste.</Head>
                <div className="st-three">
                  <div><h3 className="t-mono st-sub">Décennies</h3><Ranked items={[...v.decades].sort((a, b) => b.count - a.count)} format={hm} /></div>
                  <div><h3 className="t-mono st-sub">Genres · films</h3><Ranked items={v.genres} empty="Les genres viendront avec les fiches TMDB." /></div>
                  <div><h3 className="t-mono st-sub">Cinéastes · films</h3><Ranked items={v.directors} empty="Les cinéastes viendront avec les fiches TMDB." /></div>
                </div>
              </section>
            </>
          )}

          {/* ---- Collection ---- */}
          <section className="wrap st-sec">
            <Head reel={v.sessions ? '04' : '02'} title={<>La <em>collection</em></>}>État au {new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}, toutes périodes confondues.</Head>
            <div className="st-figs st-figs--flush">
              <Figure label="Films" value={nf.format(c.films)} note={c.matched < c.films ? `${c.matched} avec fiche TMDB` : 'tous identifiés'} />
              <Figure label="Durée totale" value={hours(c.durationSeconds)[0]} unit="h" note={`${nf1.format(c.durationSeconds / 86400)} jours sans dormir`} />
              <Figure label="Sur disque" value={c.sizeBytes >= 1e12 ? nf1.format(c.sizeBytes / 1e12) : nf.format(Math.round(c.sizeBytes / 1e9))} unit={c.sizeBytes >= 1e12 ? 'To' : 'Go'} note={`${nf1.format(c.sizeBytes / 1e9 / Math.max(1, c.films))} Go par film en moyenne`} />
              <Figure label="Déjà vus" value={`${seenShare}`} unit="%" note={`${plural(c.films - c.watched, 'film')} à découvrir`} />
            </div>

            <div className="decades">
              <div className="decades__legend t-mono">
                <span><i className="sw sw--all" />Dans la collection</span>
                <span><i className="sw sw--seen" />Vus</span>
              </div>
              <ol className="decades__cols" role="list">
                {c.decades.map((d) => {
                  const max = Math.max(...c.decades.map((x) => x.count));
                  return (
                    <li key={d.label} className="decades__col" aria-label={`Années ${d.label} : ${d.count} films, ${d.watched} vus`}>
                      <span className="decades__n t-mono"><b>{d.watched}</b> / {d.count}</span>
                      <span className="decades__bar" style={{ height: `${(d.count / max) * 100}%` }}>
                        <i style={{ height: `${d.count ? (d.watched / d.count) * 100 : 0}%` }} />
                      </span>
                      <Link to={`/bibliotheque?vue=chronologie&decennie=${d.label}`} className="decades__label">{d.label.slice(2)}<span className="t-mono">s</span></Link>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="st-three st-three--tech">
              <div><h3 className="t-mono st-sub">Définition</h3><Ranked items={c.resolution} /></div>
              <div><h3 className="t-mono st-sub">Image</h3><Ranked items={[...c.dynamicRange, ...c.videoCodecs.map((x) => ({ ...x, label: `Codec ${x.label}` }))]} /></div>
              <div><h3 className="t-mono st-sub">Son</h3><Ranked items={c.audio} /></div>
              <div>
                <h3 className="t-mono st-sub">Sous-titres · films</h3>
                <Ranked items={c.subtitles} />
                {c.withoutSubtitles > 0 && <p className="st-none">{plural(c.withoutSubtitles, 'film')} sans aucun sous-titre.</p>}
              </div>
              <div><h3 className="t-mono st-sub">Genres · films</h3><Ranked items={c.genres} empty="Les genres viendront avec les fiches TMDB." /></div>
              <div><h3 className="t-mono st-sub">Pays · films</h3><Ranked items={c.countries}empty="Les pays viendront avec les fiches TMDB." /></div>
            </div>

            {c.records.length > 0 && (
              <ul className="records" role="list">
                {c.records.map((r) => {
                  const m = byId.get(r.movieId);
                  return (
                    <li key={r.label} style={accent(m)}>
                      <Link to={`/film/${r.movieId}`} className="records__item">
                        <Thumb m={m} />
                        <span className="t-mono records__label">{r.label}</span>
                        <span className="records__title">{m?.title ?? '…'}</span>
                        <span className="records__value">{r.value}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {ratingsTotal > 0 && (
            <section className="wrap st-sec st-last">
              <Head reel={v.sessions ? '05' : '03'} title={<>Les <em>notes</em></>}>{plural(ratingsTotal, 'film noté', 'films notés')}.</Head>
              <Ranked items={[5, 4, 3, 2, 1].map((n) => ({ label: '★'.repeat(n) + '☆'.repeat(5 - n), count: data.ratings[n - 1] }))} format={(n) => plural(n, 'film')} />
            </section>
          )}
        </>
      )}
    </main>
  );
}
