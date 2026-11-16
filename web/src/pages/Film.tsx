// Fiche du film : mise en page de revue, asymétrique ; générique typographique, fiche technique,
// palette, « Dans votre collection » et correction de l'association TMDB.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import type { MovieDetail, MovieSummary, Person, TmdbSearchResult } from '@cine/shared';
import { Play, ClockCounterClockwise, ArrowCounterClockwise, PencilSimple, MagnifyingGlass } from '@phosphor-icons/react';
import { api, ApiError } from '../lib/api';
import { useMovies, refreshMovies, sqlDate } from '../lib/store';
import { techSheet, runtime, clock, langName, pad, definition, channels } from '../lib/format';
import { Button, Rating, Toggle, Field } from '../components/controls';
import { ReelCode, Badge, TechSheet, Swatches, Rule } from '../components/editorial';
import { Poster, KenBurns } from '../components/media';
import { RevealTitle, Letterbox } from '../components/cinema';
import { EmptyState, ErrorState, Skeleton, Toast } from '../components/states';
import { Dialog } from '../components/Dialog';
import { EASE_OUT, D3 } from '../lib/motion';
import '../styles/film.css';

const JOBS: Record<string, string> = {
  Director: 'Réalisation', Screenplay: 'Scénario', Writer: 'Scénario', 'Original Story': 'Histoire originale', Novel: 'Roman',
  'Director of Photography': 'Image', 'Original Music Composer': 'Musique', Music: 'Musique', Editor: 'Montage', Producer: 'Production',
  'Production Design': 'Décors', 'Costume Design': 'Costumes',
};
const DATE_LONG = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const PALETTE_NAMES: Record<string, string> = { vibrant: 'Vive', darkVibrant: 'Vive sombre', lightVibrant: 'Vive claire', muted: 'Sourde', darkMuted: 'Sourde sombre', lightMuted: 'Sourde claire' };

/** Regroupe l'équipe par poste, dans l'ordre d'un générique. */
function creditBlocks(crew: Person[]) {
  const map = new Map<string, string[]>();
  for (const p of crew) {
    const job = JOBS[p.job ?? ''];
    if (!job) continue;
    const list = map.get(job) ?? [];
    if (!list.includes(p.name)) list.push(p.name);
    map.set(job, list);
  }
  const order = ['Réalisation', 'Scénario', 'Histoire originale', 'Roman', 'Image', 'Musique', 'Montage', 'Décors', 'Costumes', 'Production'];
  return order.filter((j) => map.has(j)).map((j) => ({ job: j, names: map.get(j)!.slice(0, 3) }));
}

function titleLines(t: string): string[] {
  const words = t.split(' ');
  if (words.length < 3 || t.length < 16) return [t];
  let best = 1, diff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (d < diff) { diff = d; best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

// ---------- Correction de l'association ----------
function MatchDialog({ movie, open, onClose, onMatched }: { movie: MovieDetail; open: boolean; onClose: () => void; onMatched: (m: MovieDetail) => void }) {
  const [q, setQ] = useState(movie.title);
  const [year, setYear] = useState(movie.year ? String(movie.year) : '');
  const [results, setResults] = useState<TmdbSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | 'search' | null>(null);
  const [tmdbOn, setTmdbOn] = useState<boolean | null>(null);
  useEffect(() => { if (open) api.health().then((h) => setTmdbOn(h.tmdb)).catch(() => setTmdbOn(false)); }, [open]);

  const search = async () => {
    setBusy('search'); setError(null);
    try { setResults(await api.tmdbSearch(q, year ? Number(year) : null)); }
    catch (e) { setError((e as ApiError).message); }
    finally { setBusy(null); }
  };
  const choose = async (r: TmdbSearchResult) => {
    setBusy(r.tmdbId); setError(null);
    try { onMatched(await api.match(movie.id, r.tmdbId)); onClose(); }
    catch (e) { setError((e as ApiError).message); }
    finally { setBusy(null); }
  };

  return (
    <Dialog open={open} onClose={onClose} kicker={`Fichier · ${movie.fileName}`} title="Associer ce film à sa fiche">
      {tmdbOn === false ? (
        <p className="match__note">
          La recherche passe par TMDB, et la clé n'est pas encore renseignée. Ajoutez <code className="t-mono">TMDB_KEY</code> dans
          le fichier <code className="t-mono">.env</code> puis relancez la Cinémathèque.
        </p>
      ) : (
        <>
          <form className="match__form" onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <Field label="Titre" value={q} onChange={(e) => setQ(e.target.value)} />
            <Field label="Année" value={year} inputMode="numeric" onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            <Button type="submit" variant="secondary" icon={<MagnifyingGlass />} disabled={busy === 'search' || !q.trim()}>Chercher</Button>
          </form>
          {error && <p className="match__error" role="alert">{error}</p>}
          {results && (results.length ? (
            <ol className="match__results" role="list">
              {results.slice(0, 8).map((r) => (
                <li key={r.tmdbId}>
                  <button className="match__item" onClick={() => choose(r)} disabled={busy !== null}>
                    {r.posterUrl ? <img src={r.posterUrl} alt="" loading="lazy" /> : <span className="match__noimg" />}
                    <span className="match__text">
                      <span className="match__title">{r.title}</span>
                      <span className="t-mono">{[r.year, r.originalTitle !== r.title ? r.originalTitle : null].filter(Boolean).join(' · ')}</span>
                      <span className="match__overview">{r.overview}</span>
                    </span>
                    <span className="t-mono match__pick">{busy === r.tmdbId ? 'Association…' : 'Choisir'}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : <p className="match__note">Aucun résultat. Essayez le titre original, ou retirez l'année.</p>)}
        </>
      )}
    </Dialog>
  );
}

// ---------- Page ----------
export function Film() {
  const { id } = useParams();
  const movieId = Number(id);
  const navigate = useNavigate();
  const { movies } = useMovies();
  const [film, setFilm] = useState<MovieDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [frame, setFrame] = useState<'open' | 'scope'>('open');
  const [matchOpen, setMatchOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setFilm(null); setError(null);
    api.movie(movieId).then(setFilm).catch((e) => setError(e));
  }, [movieId]);
  useEffect(() => {
    if (!film || !matchMedia('(min-aspect-ratio: 13/10)').matches) return;
    const t = setTimeout(() => setFrame('scope'), 500);
    return () => clearTimeout(t);
  }, [film]);

  const related = useMemo(() => {
    if (!film || !movies) return { title: '', items: [] as MovieSummary[] };
    const others = movies.filter((m) => m.id !== film.id);
    const director = film.directors[0];
    const byDirector = director ? others.filter((m) => m.directors.includes(director)) : [];
    if (byDirector.length >= 2) return { title: `Du même cinéaste`, sub: director, items: byDirector.slice(0, 6) };
    if (film.year) {
      const near = [...others].filter((m) => m.year).sort((a, b) => Math.abs(a.year! - film.year!) - Math.abs(b.year! - film.year!));
      return { title: 'À la même époque', sub: `Autour de ${film.year}`, items: near.slice(0, 6) };
    }
    return { title: '', items: [] };
  }, [film, movies]);

  const update = async (patch: Partial<{ rating: number | null; watched: boolean; position: number }>) => {
    if (!film) return;
    const user = await api.patchUser(film.id, patch);
    setFilm({ ...film, user, watched: user.watched });
    refreshMovies();
  };

  if (error) {
    return (
      <main className="page wrap film-state">
        {error.status === 404 ? (
          <EmptyState reel="BOB. ?? — Introuvable" title="Cette bobine n'est plus en rayon." action={<Link to="/bibliotheque" className="btn btn--secondary"><span className="btn__label">Voir la bibliothèque</span></Link>}>
            Le film a peut-être été déplacé ou supprimé du disque.
          </EmptyState>
        ) : (
          <ErrorState code={`ERR ${error.status || '—'} · /API/MOVIES/${movieId}`} action={<Button onClick={() => location.reload()}>Réessayer</Button>}>{error.message}</ErrorState>
        )}
      </main>
    );
  }

  const summary = movies?.find((m) => m.id === movieId);
  const base = film ?? summary;
  if (!base) {
    return (
      <main className="page film" aria-busy="true">
        <div className="film-hero film-hero--loading" />
        <div className="wrap film-body"><Skeleton ratio="2 / 3" /><div className="film-main">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h="1.2rem" />)}</div></div>
      </main>
    );
  }

  const accent = base.palette?.accent;
  const style = accent ? ({ ['--film-accent' as string]: accent } as CSSProperties) : undefined;
  const wide = base.backdrop ?? base.still;
  const media = film?.media;
  const resumeAt = film && media && film.user.position > 60 ? film.user.position : 0;
  const credits = film ? creditBlocks(film.crew) : [];
  const cast = film?.cast ?? [];
  const imageSubs = film?.subtitles.filter((s) => !s.textBased) ?? [];
  const textSubs = film?.subtitles.filter((s) => s.textBased) ?? [];
  // Une ligne par langue : « Français ×2 — Fichier SRT · Intégré PGS »
  const subGroups = (() => {
    const map = new Map<string, { label: string; count: number; kinds: string[] }>();
    for (const s of [...textSubs, ...imageSubs]) {
      const kind = `${s.source === 'external' ? 'Fichier' : 'Intégré'} ${s.codec === 'hdmv_pgs_subtitle' ? 'PGS' : s.codec === 'dvd_subtitle' ? 'VobSub' : s.codec === 'subrip' ? 'SRT' : s.codec.toUpperCase()}`;
      const g = map.get(s.label) ?? { label: s.label, count: 0, kinds: [] };
      g.count++;
      if (!g.kinds.includes(kind)) g.kinds.push(kind);
      map.set(s.label, g);
    }
    return [...map.values()];
  })();
  const number = movies ? [...movies].sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id - b.id).findIndex((m) => m.id === movieId) + 1 : 0;
  const lastPlay = sqlDate(film?.lastPlayedAt ?? null);
  const added = sqlDate(base.addedAt);
  const play = (from?: number) => navigate(`/lecture/${movieId}${from === 0 ? '?debut=1' : ''}`);
  const needsMatch = base.matchStatus !== 'matched' && base.matchStatus !== 'manual';

  return (
    <main className="page film" style={style}>
      {/* ---------- En-tête image ---------- */}
      <section className="film-hero">
        {wide && <KenBurns image={wide} className="film-hero__img" origin="55% 40%" />}
        <div className="film-hero__shade" />
        <Letterbox state={frame} color="var(--c-bg)" />
        <div className="wrap film-hero__content">
          <div className="film-hero__kicker">
            <ReelCode n={number || '—'} label={base.year ?? 'Année inconnue'} />
            {base.matchStatus === 'review' && <Badge tone="velvet">Association à vérifier</Badge>}
          </div>
          <RevealTitle key={movieId} className={`film-hero__title ${base.title.length > 18 ? 't-h1' : 't-display'}`} lines={titleLines(base.title)} delay={0.2} />
          {film?.originalTitle && film.originalTitle !== film.title && <p className="film-hero__original"><em>{film.originalTitle}</em></p>}
          <p className="t-mono film-hero__meta">
            {[base.year, runtime(base.runtime), ...base.countries.slice(0, 2), ...base.genres.slice(0, 2)].filter(Boolean).join(' · ')}
          </p>
          <div className="film-hero__actions">
            {resumeAt ? (
              <>
                <Button variant="primary" size="lg" icon={<ClockCounterClockwise />} meta={clock(resumeAt)} onClick={() => play()}>Reprendre</Button>
                <Button variant="secondary" size="lg" icon={<ArrowCounterClockwise />} onClick={() => play(0)}>Depuis le début</Button>
              </>
            ) : (
              <Button variant="primary" size="lg" icon={<Play weight="fill" />} meta={runtime(base.runtime)} onClick={() => play()}>Projeter</Button>
            )}
          </div>
        </div>
      </section>

      {/* ---------- Corps : colonne d'affiche, colonne de texte ---------- */}
      <div className="wrap film-body">
        <aside className="film-side">
          <motion.div className="film-poster" layoutId={`poster-${movieId}`} transition={{ duration: D3, ease: EASE_OUT }}>
            <Poster movie={base} caption={false} sizes="(max-width: 900px) 50vw, 24vw" focusable={false} shared={false} eager />
          </motion.div>

          <section className="film-own" aria-labelledby="h-own">
            <h2 id="h-own" className="t-mono film-own__title">Dans votre collection</h2>
            {film ? (
              <>
                <div className="film-own__rating">
                  <Rating value={film.user.rating} onChange={(v) => update({ rating: v })} />
                  <span className="t-mono">{film.user.rating ? `${film.user.rating} / 5` : 'Pas de note'}</span>
                </div>
                <Toggle label="Déjà vu" checked={film.user.watched} onChange={(v) => { void update({ watched: v }); setToast(v ? 'Marqué comme vu.' : 'Marqué comme non vu.'); }} />
                <dl className="film-own__facts">
                  <div><dt className="t-mono">Séances</dt><dd>{film.user.watchCount ? `${film.user.watchCount} fois` : 'Jamais projeté'}</dd></div>
                  {lastPlay && <div><dt className="t-mono">Dernière</dt><dd>{DATE_LONG.format(lastPlay)}</dd></div>}
                  {resumeAt > 0 && media && <div><dt className="t-mono">Arrêté à</dt><dd>{clock(resumeAt)} <span className="film-own__dim">sur {clock(media.duration)}</span></dd></div>}
                  {added && <div><dt className="t-mono">Entré le</dt><dd>{DATE_LONG.format(added)}</dd></div>}
                  <div><dt className="t-mono">N°</dt><dd>{pad(number, 3)} sur {movies?.length ?? '—'}</dd></div>
                </dl>
              </>
            ) : <Skeleton h="8rem" />}
          </section>

          {base.palette && (
            <section className="film-palette" aria-labelledby="h-pal">
              <h2 id="h-pal" className="t-mono">Palette</h2>
              <Swatches
                active={base.palette.accent}
                colors={Object.entries(base.palette).filter(([k, v]) => v && k !== 'accent').map(([k, v]) => ({ hex: v as string, name: PALETTE_NAMES[k] ?? k }))}
              />
            </section>
          )}
        </aside>

        <div className="film-main">
          {film?.tagline && <p className="film-tagline"><em>« {film.tagline} »</em></p>}

          {film?.overview ? (
            <p className="dropcap film-overview">{film.overview}</p>
          ) : film && (
            <div className="film-nometa">
              <p className="film-nometa__title"><em>Pas encore de fiche.</em></p>
              <p className="t-caption">
                Ce film n'est relié à aucune fiche TMDB : pas de résumé, de générique ni d'affiche. Le photogramme et la fiche technique viennent du fichier lui-même.
              </p>
              <Button variant="secondary" icon={<PencilSimple />} onClick={() => setMatchOpen(true)}>Associer à une fiche</Button>
            </div>
          )}

          {(credits.length > 0 || cast.length > 0) && (
            <section className="film-credits" aria-labelledby="h-credits">
              <h2 id="h-credits" className="film-h">Générique</h2>
              {credits.length > 0 && (
                <dl className="crew">
                  {credits.map((c) => (
                    <div key={c.job} className="crew__row"><dt className="t-mono">{c.job}</dt><dd>{c.names.join(', ')}</dd></div>
                  ))}
                </dl>
              )}
              {cast.length > 0 && (
                <ol className="cast" role="list">
                  {cast.slice(0, 14).map((p, i) => (
                    <li key={p.id + '-' + i} className={`cast__row${i < 3 ? ' is-lead' : ''}`}>
                      <span className="cast__name">{p.name}</span>
                      <span className="cast__leader" aria-hidden />
                      <span className="cast__role">{p.character || '—'}</span>
                    </li>
                  ))}
                  {cast.length > 14 && <li className="t-mono cast__more">et {cast.length - 14} autres</li>}
                </ol>
              )}
            </section>
          )}

          <section className="film-tech" aria-labelledby="h-tech">
            <h2 id="h-tech" className="film-h">Fiche technique</h2>
            {media ? (
              <>
                <div className="film-tech__badges">
                  {media.video && <Badge>{definition(media.video.width, media.video.height)}</Badge>}
                  {media.video && media.video.hdr !== 'SDR' && <Badge>{media.video.hdr === 'DV' ? 'Dolby Vision' : media.video.hdr}</Badge>}
                  {media.audio[0] && <Badge>{channels(media.audio[0].channels)}</Badge>}
                  {textSubs.some((s) => s.language === 'fr') && <Badge tone="film">VOSTFR</Badge>}
                </div>
                <TechSheet rows={techSheet(media, film.subtitles)} />
              </>
            ) : film ? <p className="t-caption">Analyse du fichier en attente.</p> : <Skeleton h="12rem" />}
          </section>

          {film && (film.subtitles.length > 0 || (media?.audio.length ?? 0) > 1) && (
            <section className="film-tracks" aria-labelledby="h-tracks">
              <h2 id="h-tracks" className="film-h">Pistes</h2>
              <div className="tracks">
                {media && media.audio.length > 0 && (
                  <div className="tracks__col">
                    <h3 className="t-mono">Son · {media.audio.length}</h3>
                    <ul role="list">
                      {media.audio.map((a) => (
                        <li key={a.index}><span>{langName(a.language)}</span><span className="t-mono">{a.codec.toUpperCase()} · {channels(a.channels)}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
                {film.subtitles.length > 0 && (
                  <div className="tracks__col">
                    <h3 className="t-mono">Sous-titres · {film.subtitles.length}</h3>
                    <ul role="list">
                      {subGroups.slice(0, 10).map((g) => (
                        <li key={g.label}>
                          <span>{g.label}{g.count > 1 && <span className="tracks__count"> ×{g.count}</span>}</span>
                          <span className="t-mono">{g.kinds.join(' · ')}</span>
                        </li>
                      ))}
                      {subGroups.length > 10 && <li className="t-mono tracks__more">et {subGroups.length - 10} autres langues</li>}
                    </ul>
                  </div>
                )}
              </div>
              {imageSubs.length > 0 && (
                <p className="tracks__warn">
                  <Badge tone="velvet">Incrustation</Badge>
                  <span>{imageSubs.length > 1 ? `${imageSubs.length} pistes sont des images` : 'Une piste est une image'} (Blu-ray PGS ou DVD VobSub) : elles ne peuvent pas devenir du texte. Choisies au lecteur, elles sont incrustées dans l'image, ce qui demande un transcodage.</span>
                </p>
              )}
            </section>
          )}

          {film && !needsMatch && (
            <p className="film-fix"><button className="btn btn--quiet" onClick={() => setMatchOpen(true)}><span className="btn__label">Ce n'est pas le bon film ?</span></button></p>
          )}
          {film && <p className="t-mono film-file" title={film.filePath}>{film.fileName}</p>}
        </div>
      </div>

      {related.items.length > 0 && (
        <section className="wrap film-related" aria-labelledby="h-rel">
          <header className="rowhead">
            <span className="t-mono rowhead__meta">{related.sub}</span>
            <h2 id="h-rel" className="rowhead__title">{related.title}</h2>
          </header>
          <div className="posters-row">
            {related.items.map((m) => <Poster key={m.id} movie={m} href={`/film/${m.id}`} sizes="(max-width: 760px) 44vw, 14vw" />)}
          </div>
        </section>
      )}
      <div className="wrap film-end"><Rule variant="double" /></div>

      {film && <MatchDialog movie={film} open={matchOpen} onClose={() => setMatchOpen(false)} onMatched={(m) => { setFilm(m); refreshMovies(); setToast('Fiche associée.'); }} />}
      <Toast open={!!toast} message={toast} onClose={() => setToast(null)} />
    </main>
  );
}
