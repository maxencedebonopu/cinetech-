// Nuancier : démonstration du système de dessin, composée comme un programme de salle.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { MovieDetail, MovieSummary } from '@cine/shared';
import {
  Play, Pause, ClockCounterClockwise, ClockClockwise, SpeakerHigh, Subtitles, CornersOut,
  PictureInPicture, Airplay, SquaresFour, FilmStrip, Calendar, ArrowRight, Shuffle,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import { techSheet, runtime, clock } from '../lib/format';
import { Button, IconButton, Segmented, Toggle, Slider, Field, Rating, Progress } from '../components/controls';
import { ReelCode, Rule, LabeledRule, SectionHead, Badge, TechSheet, Swatches } from '../components/editorial';
import { Poster, KenBurns, Img } from '../components/media';
import { RevealTitle, Letterbox, Leader, LightLeak } from '../components/cinema';
import { EmptyState, ErrorState, Skeleton, Toast } from '../components/states';
import '../styles/design.css';

const NAV = [
  ['couleurs', 'Couleurs'], ['typo', 'Typographie'], ['controles', 'Contrôles'], ['affiches', 'Affiches'],
  ['fiche', 'Fiche'], ['mouvement', 'Mouvement'], ['etats', 'États'], ['canape', 'Télécommande'],
] as const;

const BASE_COLORS = [
  { hex: '#0D0B09', name: 'Fond de salle', token: '--c-bg' },
  { hex: '#16130F', name: 'Surface 1', token: '--c-surface-1' },
  { hex: '#1F1B16', name: 'Surface 2', token: '--c-surface-2' },
];
const TEXT_COLORS = [
  { hex: '#EDE6D6', name: 'Ivoire', ratio: '14,9', use: 'Titres, texte courant' },
  { hex: '#A39A88', name: 'Pierre', ratio: '7,0', use: 'Texte secondaire, données' },
  { hex: '#6B6357', name: 'Cendre', ratio: '3,3', use: 'Grand texte, folios, décor' },
];

const SCALE = [
  ['Display', 'var(--fs-display)', '208 · 0,88', 'Vertigo'],
  ['Titre 1', 'var(--fs-h1)', '136 · 0,88', 'La mort aux trousses'],
  ['Titre 2', 'var(--fs-h2)', '76 · 1,00', 'Reprendre la séance'],
  ['Titre 3', 'var(--fs-h3)', '42 · 1,00', 'Dans votre collection'],
  ['Titre 4', 'var(--fs-h4)', '28 · 1,10', 'Distribution'],
] as const;

function useMovies() {
  const [movies, setMovies] = useState<MovieSummary[] | null>(null);
  const [detail, setDetail] = useState<MovieDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.movies().then(async (list) => {
      setMovies(list);
      const pick = list.find((m) => m.title === 'Vertigo') ?? list.find((m) => m.still) ?? list[0];
      if (pick) setDetail(await api.movie(pick.id));
    }).catch((e) => setError(e.message));
  }, []);
  return { movies, detail, error };
}

export function DesignPage() {
  const { movies, detail, error } = useMovies();
  const [grain, setGrain] = useState(() => document.documentElement.dataset.grain !== 'off');
  const [leaderOn, setLeaderOn] = useState(true);
  const [view, setView] = useState<'affiches' | 'planche' | 'chrono'>('affiches');
  const [quality, setQuality] = useState<'original' | '8M' | '4M'>('original');
  const [subSize, setSubSize] = useState(100);
  const [offset, setOffset] = useState(0);
  const [rating, setRating] = useState<number | null>(4);
  const [frame, setFrame] = useState<'open' | 'scope' | 'shut'>('scope');
  const [replay, setReplay] = useState(0);
  const [leader, setLeader] = useState<'none' | 'stage' | 'full'>('none');
  const [toast, setToast] = useState(false);
  const [heroFrame, setHeroFrame] = useState<'open' | 'scope'>('open');

  useEffect(() => { document.documentElement.dataset.grain = grain ? 'on' : 'off'; }, [grain]);
  // Scope seulement sur un écran en paysage : en portrait, les bandes mangeraient l'image
  useEffect(() => {
    if (!matchMedia('(min-aspect-ratio: 13/10)').matches) return;
    const t = setTimeout(() => setHeroFrame('scope'), 900);
    return () => clearTimeout(t);
  }, []);

  const withStill = useMemo(() => (movies ?? []).filter((m) => m.still), [movies]);
  const hero = useMemo(() => withStill.find((m) => m.title === 'Vertigo') ?? withStill[0], [withStill]);
  const posters = useMemo(() => {
    const prefer = ['Chungking Express', 'Barry Lyndon', 'Psycho', 'Memento', 'Blade Runner', 'Possession', 'Angst', 'Boogie Nights'];
    const chosen = prefer.map((t) => withStill.find((m) => m.title === t)).filter(Boolean) as MovieSummary[];
    const rest = withStill.filter((m) => !chosen.includes(m));
    return [...chosen, ...rest].slice(0, 12);
  }, [withStill]);
  const demoPosters = useMemo(() => posters.slice(0, 6).map((m, i) => ({
    ...m,
    progress: i === 1 ? 0.42 : m.progress,
    watched: i === 3 ? true : m.watched,
  })), [posters]);
  const accents = useMemo(() => withStill.slice(0, 10).map((m) => ({ hex: m.palette?.accent ?? '#D8C7A3', name: m.title })), [withStill]);
  const filmAccent = detail?.palette?.accent;
  const filmStyle = filmAccent ? ({ ['--film-accent' as string]: filmAccent } as CSSProperties) : undefined;

  return (
    <div className="ds">
      {/* ---------- Bandeau ---------- */}
      <header className="ds-top">
        <a className="ds-top__mark" href="/">Cinémathèque</a>
        <nav className="ds-top__nav" aria-label="Sections du nuancier">
          {NAV.map(([id, label], i) => (
            <a key={id} href={`#${id}`} className="ds-top__link"><span className="t-mono">{String(i + 1).padStart(2, '0')}</span>{label}</a>
          ))}
        </nav>
      </header>

      {/* ---------- Ouverture ---------- */}
      <section className="ds-hero">
        {hero?.still ? (
          <KenBurns image={hero.still} className="ds-hero__img" origin="60% 40%" />
        ) : <div className="ds-hero__img" />}
        <LightLeak />
        <div className="ds-hero__shade" />
        <Letterbox state={heroFrame} ratio={2.39} color="var(--c-bg)" />
        <div className="ds-hero__content">
          <ReelCode n={0} label="Système de dessin · v0.3" />
          <RevealTitle className="t-h1 ds-hero__title" lines={['Le nuancier', <em key="i">de la salle</em>]} delay={0.25} />
          <p className="t-lead ds-hero__lead">
            Couleurs, caractères, contrôles et mouvement de la Cinémathèque, réunis sur une seule bobine.
            Chaque écran se compose avec ces pièces, et rien d'autre.
          </p>
          <div className="ds-hero__actions">
            <Button variant="primary" size="lg" icon={<Play weight="fill" />} meta="2 s" onClick={() => setLeader('full')}>Projeter l'amorce</Button>
            <Button variant="secondary" size="lg" icon={<ArrowRight />} onClick={() => document.getElementById('couleurs')?.scrollIntoView({ behavior: 'smooth' })}>Parcourir</Button>
          </div>
        </div>
        {hero && (
          <p className="t-mono ds-hero__credit">Photogramme · {hero.title}{hero.year ? ` (${hero.year})` : ''}</p>
        )}
      </section>

      <main className="ds-main">
        {/* ---------- 01 Couleurs ---------- */}
        <section className="ds-sec" id="couleurs">
          <SectionHead reel={1} page={3} title={<>La salle, <em>avant la lumière</em></>}
            kicker="Un noir chaud, deux surfaces à peine plus claires, un ivoire de papier. Le velours rouge ne sert qu'à l'action principale ; la couleur vient des films." />
          <div className="ds-colors">
            <div className="ds-bands">
              {BASE_COLORS.map((c) => (
                <div key={c.hex} className="ds-band" style={{ background: c.hex }}>
                  <span className="t-mono ds-band__hex">{c.hex}</span>
                  <span className="ds-band__name">{c.name}</span>
                  <span className="t-mono ds-band__token">{c.token}</span>
                </div>
              ))}
              <div className="ds-band ds-band--velvet">
                <span className="t-mono ds-band__hex">#B3261E</span>
                <span className="ds-band__name">Velours</span>
                <span className="t-mono ds-band__token">action seule</span>
              </div>
            </div>
            <ul className="ds-inks" role="list">
              {TEXT_COLORS.map((c) => (
                <li key={c.hex} className="ds-ink">
                  <span className="ds-ink__aa" style={{ color: c.hex }}>Aa</span>
                  <span className="ds-ink__meta">
                    <span className="ds-ink__name">{c.name}</span>
                    <span className="t-mono">{c.hex} · {c.ratio}:1</span>
                    <span className="t-caption">{c.use}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="ds-sub">
            <LabeledRule>Accent par film · extrait de l'image, contraste AA garanti</LabeledRule>
            {accents.length ? <Swatches colors={accents} /> : <div className="ds-skel-row">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} w="5.5rem" h="7rem" />)}</div>}
          </div>
        </section>

        {/* ---------- 02 Typographie ---------- */}
        <section className="ds-sec" id="typo">
          <SectionHead reel={2} page={7} title={<>Trois voix, <em>une page</em></>}
            kicker="Instrument Serif pour les titres, Geist pour lire, Geist Mono en petites capitales pour tout ce qui se mesure." />
          <div className="ds-scale">
            {SCALE.map(([name, size, spec, sample]) => (
              <div className="ds-scale__row" key={name}>
                <span className="ds-scale__spec"><span className="t-mono">{name}</span><span className="t-mono ds-dim">{spec}</span></span>
                <span className="ds-scale__sample" style={{ fontSize: size }}>{sample}</span>
              </div>
            ))}
          </div>
          <div className="ds-voices">
            <article className="ds-voice">
              <span className="t-mono">Geist · texte</span>
              <p className="dropcap ds-voice__text" style={filmStyle}>
                Un détective sujet au vertige est engagé pour suivre une femme qui semble possédée par le passé.
                La lettrine prend la couleur du film ; le corps reste en ivoire, sur une mesure de soixante signes,
                pour qu'on lise un synopsis comme on lit une page de revue.
              </p>
            </article>
            <article className="ds-voice">
              <span className="t-mono">Instrument Serif · italique</span>
              <p className="ds-voice__quote"><em>« Le cinéma, c'est l'écriture moderne dont l'encre est la lumière. »</em></p>
              <span className="t-mono ds-dim">Jean Cocteau</span>
            </article>
            <article className="ds-voice">
              <span className="t-mono">Geist Mono · données</span>
              <dl className="ds-monolist">
                <div><dt className="t-mono">Image</dt><dd>HEVC 10 BITS · 3840 × 1600</dd></div>
                <div><dt className="t-mono">Son</dt><dd>ANGLAIS · DTS-HD MA 5.1</dd></div>
                <div><dt className="t-mono">Durée</dt><dd>2:08:14</dd></div>
                <div><dt className="t-mono">Bobine</dt><dd>BOB. 02 — 1958</dd></div>
              </dl>
            </article>
          </div>
        </section>

        {/* ---------- 03 Contrôles ---------- */}
        <section className="ds-sec" id="controles">
          <SectionHead reel={3} page={12} title={<>Sous la main, <em>sans bruit</em></>}
            kicker="Angles vifs, filets fins, icônes au trait le plus fin. Une seule action rouge par écran." />
          <div className="ds-panels">
            <div className="ds-panel ds-panel--wide">
              <h3 className="t-mono ds-panel__title">Boutons</h3>
              <div className="ds-row">
                <Button variant="primary" size="lg" icon={<Play weight="fill" />} meta={detail ? runtime(detail.runtime) : '2 h 08'}>Projeter</Button>
                <Button variant="secondary" size="lg" icon={<ClockCounterClockwise />} meta="42:10">Reprendre</Button>
                <Button variant="secondary" size="lg" icon={<Shuffle />}>Séance surprise</Button>
                <Button variant="quiet">Fiche complète</Button>
              </div>
            </div>
            <div className="ds-panel ds-panel--wide">
              <h3 className="t-mono ds-panel__title">Icônes du lecteur · Phosphor, trait fin</h3>
              <div className="ds-row ds-row--tight">
                <IconButton label="Lecture"><Play /></IconButton>
                <IconButton label="Pause"><Pause /></IconButton>
                <IconButton label="Reculer de 10 s"><ClockCounterClockwise /></IconButton>
                <IconButton label="Avancer de 10 s"><ClockClockwise /></IconButton>
                <IconButton label="Volume"><SpeakerHigh /></IconButton>
                <IconButton label="Sous-titres"><Subtitles /></IconButton>
                <IconButton label="Image dans l'image"><PictureInPicture /></IconButton>
                <IconButton label="AirPlay"><Airplay /></IconButton>
                <IconButton label="Plein écran"><CornersOut /></IconButton>
              </div>
            </div>
            <div className="ds-panel ds-panel--col">
              <h3 className="t-mono ds-panel__title">Choix exclusif</h3>
              <Segmented label="Vue de la bibliothèque" value={view} onChange={setView} options={[
                { value: 'affiches', label: 'Affiches', icon: <SquaresFour /> },
                { value: 'planche', label: 'Planche-contact', icon: <FilmStrip /> },
                { value: 'chrono', label: 'Chronologie', icon: <Calendar /> },
              ]} />
              <Segmented label="Qualité" value={quality} onChange={setQuality} options={[
                { value: 'original', label: 'Original' }, { value: '8M', label: '8 Mb/s' }, { value: '4M', label: '4 Mb/s' },
              ]} />
            </div>
            <div className="ds-panel ds-panel--col">
              <h3 className="t-mono ds-panel__title">Réglages</h3>
              <Toggle label="Grain de pellicule" hint="Texture animée sur toute l'interface" checked={grain} onChange={setGrain} />
              <Rule />
              <Toggle label="Amorce avant le film" hint="Décompte 3-2-1 d'environ 2 s" checked={leaderOn} onChange={setLeaderOn} />
            </div>
            <div className="ds-panel ds-panel--col">
              <h3 className="t-mono ds-panel__title">Curseurs</h3>
              <Slider label="Taille des sous-titres" value={subSize} min={60} max={180} step={10} format={(v) => `${v} %`} onChange={setSubSize} />
              <Slider label="Décalage des sous-titres" value={offset} min={-5} max={5} step={0.1}
                format={(v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1).replace('.', ',')} s`} onChange={setOffset} />
            </div>
            <div className="ds-panel ds-panel--wide">
              <h3 className="t-mono ds-panel__title">Recherche · note · progression</h3>
              <div className="ds-split">
              <Field variant="search" label="Rechercher un film" type="search" placeholder="Un titre, un nom, une année…" />
              <div className="ds-rating">
                <Rating value={rating} onChange={setRating} />
                <span className="t-mono">{rating ? `${rating} / 5` : 'Sans note'}</span>
              </div>
              <div style={filmStyle} className="ds-progress">
                <Progress value={0.42} label="Progression" />
                <span className="t-mono">42:10 sur {detail?.media ? clock(detail.media.duration) : '2:08:14'}</span>
              </div>
              </div>
            </div>
            <div className="ds-panel ds-panel--wide">
              <h3 className="t-mono ds-panel__title">Badges</h3>
              <div className="ds-row ds-row--tight">
                <Badge>4K</Badge><Badge>HDR10</Badge><Badge>Dolby Vision</Badge><Badge>DTS-HD MA 5.1</Badge>
                <span style={filmStyle}><Badge tone="film">VOSTFR</Badge></span>
                <Badge tone="velvet" title="Sous-titres image : incrustés pendant la lecture">Sous-titres incrustés</Badge>
                <Badge tone="velvet">À vérifier</Badge>
                <Badge tone="solid">Vu</Badge>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- 04 Affiches ---------- */}
        <section className="ds-sec" id="affiches">
          <SectionHead reel={4} page={18} title={<>L'affiche <em>avant tout</em></>}
            kicker="Ratio 2:3, angles vifs, aucune ombre. Sans affiche TMDB, l'affiche se compose sur un photogramme du film, avec un passe-partout à sa couleur." />
          <div className="ds-posters">
            {demoPosters.length
              ? demoPosters.map((m, i) => <Poster key={m.id} movie={m} number={i + 1} sizes="(max-width: 700px) 44vw, 15vw" />)
              : Array.from({ length: 6 }, (_, i) => <div key={i} className="ds-posters__skel"><Skeleton ratio="2 / 3" /><Skeleton h="1rem" w="70%" /><Skeleton h="0.6rem" w="40%" /></div>)}
          </div>
          <p className="t-caption ds-note">
            Survol : l'image avance de 4 %, le titre se souligne. Focus clavier ou télécommande : cadre ivoire et léger agrandissement.
            Deuxième affiche : séance entamée. Quatrième : film vu.
          </p>
        </section>

        {/* ---------- 05 Fiche ---------- */}
        <section className="ds-sec" id="fiche" style={filmStyle}>
          <SectionHead reel={5} page={24} title={<>La fiche, <em>comme un programme</em></>}
            kicker="Données mesurées par ffprobe, mises en page à la manière d'un programme de salle. L'accent du film colore les détails." />
          {detail ? (
            <div className="ds-sheet">
              <figure className="ds-sheet__figure">
                {detail.still && <Img image={detail.still} sizes="(max-width: 900px) 100vw, 50vw" className="ds-sheet__img" />}
                <figcaption className="ds-sheet__cap">
                  <ReelCode n={2} label={detail.year ?? '—'} />
                  <span className="t-mono ds-dim">{detail.fileName}</span>
                </figcaption>
              </figure>
              <div className="ds-sheet__body">
                <h3 className="t-h2">{detail.title}</h3>
                <p className="t-caption">{[detail.year, runtime(detail.runtime), detail.media?.video && `${detail.media.video.width} × ${detail.media.video.height}`].filter(Boolean).join(' · ')}</p>
                {detail.media && <TechSheet rows={techSheet(detail.media, detail.subtitles)} />}
                <div className="ds-sheet__palette">
                  <span className="t-mono">Palette de l'image</span>
                  <Swatches
                    active={detail.palette?.accent}
                    colors={Object.entries(detail.palette ?? {})
                      .filter(([k, v]) => v && k !== 'accent')
                      .map(([k, v]) => ({ hex: v as string, name: ({ vibrant: 'Vive', darkVibrant: 'Vive sombre', lightVibrant: 'Vive claire', muted: 'Sourde', darkMuted: 'Sourde sombre', lightMuted: 'Sourde claire' } as Record<string, string>)[k] ?? k }))}
                  />
                  {detail.palette && <p className="t-caption">Accent retenu : <span className="t-mono" style={{ color: 'var(--c-film)' }}>{detail.palette.accent.toUpperCase()}</span>, la couleur la plus saturée qui reste lisible sur le noir de salle.</p>}
                </div>
              </div>
            </div>
          ) : error ? (
            <ErrorState code={`ERR · /API/MOVIES`} action={<Button onClick={() => location.reload()}>Réessayer</Button>}>{error}</ErrorState>
          ) : (
            <div className="ds-sheet"><Skeleton ratio="16 / 9" /><div className="ds-sheet__body">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} h="1.4rem" />)}</div></div>
          )}
        </section>

        {/* ---------- 06 Mouvement ---------- */}
        <section className="ds-sec" id="mouvement">
          <SectionHead reel={6} page={31} title={<>Lent à venir, <em>long à se poser</em></>}
            kicker="Sorties douces de 420 à 700 ms. Titres révélés ligne à ligne, travelling sur les images fixes, cache qui se referme avant la projection. Tout s'efface si le système demande moins de mouvement." />
          <div className="ds-motion">
            <div className="ds-stage">
              {hero?.still && <KenBurns image={hero.still} className="ds-stage__img" sizes="(max-width: 900px) 100vw, 60vw" origin="30% 60%" />}
              <div className="ds-stage__shade" />
              <div className="ds-stage__title">
                <ReelCode n={6} label="Mouvement" />
                <RevealTitle key={replay} as="h3" className="t-h2" lines={['Une ligne,', 'puis la suivante.']} />
              </div>
              <Letterbox state={frame} />
              {leader === 'stage' && <Leader contained onDone={() => setLeader('none')} />}
            </div>
            <div className="ds-motion__side">
              <Segmented label="Cadre" value={frame} onChange={setFrame} options={[
                { value: 'open', label: 'Plein cadre' }, { value: 'scope', label: 'Scope 2,39' }, { value: 'shut', label: 'Noir' },
              ]} />
              <div className="ds-row">
                <Button onClick={() => setReplay((n) => n + 1)}>Rejouer le titre</Button>
                <Button onClick={() => setLeader('stage')}>Amorce 3-2-1</Button>
              </div>
              <figure className="ds-curve">
                <svg viewBox="0 0 200 120" aria-hidden>
                  <path d="M10 110 H190 M10 110 V10" stroke="var(--c-rule)" fill="none" />
                  <path d="M10 110 C 42 10, 70 10, 190 10" stroke="var(--c-text-1)" strokeWidth="1.2" fill="none" />
                  <path d="M10 110 C 75 110, 125 10, 190 10" stroke="var(--c-text-3)" strokeDasharray="3 3" fill="none" />
                </svg>
                <figcaption>
                  <span className="t-mono">Sortie · cubic-bezier(0.16, 1, 0.3, 1)</span>
                  <span className="t-mono ds-dim">Pointillé · rideau, pour le noir</span>
                  <span className="t-mono ds-dim">420 · 560 · 700 ms</span>
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* ---------- 07 États ---------- */}
        <section className="ds-sec" id="etats">
          <SectionHead reel={7} page={36} title={<>Quand rien <em>ne se passe</em></>}
            kicker="Les écrans vides et les pannes ont droit au même soin que le reste : une phrase, une explication, une action." />
          <div className="ds-states">
            <EmptyState reel="BOB. 00 — Bibliothèque" title="La salle est vide." action={<Button variant="secondary">Choisir un dossier</Button>}>
              Aucun film trouvé dans « C:\Films ». Ajoutez un dossier, la Cinémathèque surveille ensuite les nouvelles copies.
            </EmptyState>
            <ErrorState code="ERR 503 · /API/PLAYBACK/START" action={<><Button variant="secondary">Réessayer</Button><Button variant="quiet">Voir le journal</Button></>}>
              ffmpeg n'a pas pu ouvrir le fichier. Il a peut-être été déplacé pendant la séance.
            </ErrorState>
          </div>
          <div className="ds-sub">
            <LabeledRule>Chargement · scintillement de projecteur</LabeledRule>
            <div className="ds-posters ds-posters--skel">
              {Array.from({ length: 6 }, (_, i) => <div key={i} className="ds-posters__skel"><Skeleton ratio="2 / 3" /><Skeleton h="1rem" w="70%" /><Skeleton h="0.6rem" w="40%" /></div>)}
            </div>
            <Button onClick={() => setToast(true)}>Afficher un message</Button>
          </div>
        </section>

        {/* ---------- 08 Télécommande ---------- */}
        <section className="ds-sec" id="canape">
          <SectionHead reel={8} page={42} title={<>Depuis <em>le canapé</em></>}
            kicker="À trois mètres, le focus doit se voir sans chercher : cadre ivoire de 2 px, décalé, et un léger agrandissement. Tabulation ou flèches." />
          <div className="ds-keys">
            {['←', '↑', '↓', '→', 'OK', 'Retour', 'Espace', 'F', 'M', 'S', 'J', 'L', '?'].map((k) => <kbd key={k} className="t-mono ds-key">{k}</kbd>)}
          </div>
          <div className="ds-posters ds-posters--tv">
            {posters.slice(6, 11).map((m, i) => <Poster key={m.id} movie={m} number={i + 7} sizes="(max-width: 700px) 44vw, 18vw" />)}
          </div>
        </section>
      </main>

      <footer className="ds-end">
        <Rule variant="double" />
        <p className="ds-end__fin"><em>Fin</em></p>
        <p className="t-mono ds-end__credits">
          Instrument Serif · Geist · Geist Mono · Phosphor, trait fin — Cinémathèque, système de dessin v0.3
        </p>
      </footer>

      {leader === 'full' && <Leader onDone={() => setLeader('none')} />}
      <Toast open={toast} onClose={() => setToast(false)} message="Position enregistrée. Reprise à 42:10." meta="Vertigo" />
    </div>
  );
}
