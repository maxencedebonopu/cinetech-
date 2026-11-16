// Réglages : « La cabine ». Bibliothèque, métadonnées, projection, salle, sous-titres orphelins, système.
// Tout s'enregistre aussitôt ; rien n'est demandé deux fois.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CaretDown, FolderSimple, X, ArrowClockwise, Check } from '@phosphor-icons/react';
import type { Health, LibraryStatus, OrphanSubtitle, Settings as SettingsData, TmdbKeyInfo, MovieSummary } from '@cine/shared';
import { api, ApiError } from '../lib/api';
import { useMovies, useSettings, saveSettings, refreshMovies } from '../lib/store';
import { pad, langName } from '../lib/format';
import { isTv, setTv } from '../lib/spatial';
import { ReelCode } from '../components/editorial';
import { Button, Segmented, Toggle } from '../components/controls';
import { ErrorState, Skeleton, Toast } from '../components/states';
import '../styles/settings.css';

const SECTIONS = [
  ['bibliotheque', 'Bibliothèque'],
  ['metadonnees', 'Métadonnées'],
  ['projection', 'Projection'],
  ['salle', 'Salle'],
  ['orphelins', 'Sous-titres orphelins'],
  ['systeme', 'Système'],
] as const;

const LANGS = ['fr', 'en', 'ja', 'es', 'it', 'de', 'ko', 'zh', 'pt'];
const TMDB_LANGS = [['fr-FR', 'Français'], ['en-US', 'Anglais'], ['es-ES', 'Espagnol'], ['it-IT', 'Italien'], ['de-DE', 'Allemand'], ['ja-JP', 'Japonais']];
const rel = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
function ago(iso: string | null) {
  if (!iso) return 'jamais';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return rel.format(-min, 'minute');
  if (min < 1440) return rel.format(-Math.round(min / 60), 'hour');
  return rel.format(-Math.round(min / 1440), 'day');
}
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- Morceaux ----------
function Section({ id, n, title, intro, children }: { id: string; n: number; title: ReactNode; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="set-sec" aria-labelledby={`${id}-t`}>
      <header className="set-sec__head">
        <ReelCode n={n} />
        <h2 id={`${id}-t`} className="set-sec__title">{title}</h2>
        {intro && <p className="set-sec__intro">{intro}</p>}
      </header>
      <div className="set-sec__body">{children}</div>
    </section>
  );
}

/** Ligne de réglage : intitulé et explication à gauche, contrôle à droite. */
function Row({ label, hint, children, wide = false }: { label: ReactNode; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`set-row${wide ? ' set-row--wide' : ''}`}>
      <div className="set-row__text">
        <span className="set-row__label">{label}</span>
        {hint && <span className="set-row__hint">{hint}</span>}
      </div>
      <div className="set-row__control">{children}</div>
    </div>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <span className="lselect set-select">
      <span className="lselect__box">
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
        <CaretDown className="lselect__caret" aria-hidden />
      </span>
    </span>
  );
}

// ---------- 01 Bibliothèque ----------
function LibrarySection({ settings, save }: { settings: SettingsData; save: (p: Partial<SettingsData>, msg: string) => void }) {
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true, timer = 0;
    const tick = () => api.status().then((s) => {
      if (!alive) return;
      setStatus((prev) => { if (prev?.scanning && !s.scanning) refreshMovies(); return s; });
      timer = window.setTimeout(tick, s.scanning ? 1000 : 8000);
    }).catch(() => { timer = window.setTimeout(tick, 8000); });
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const p = draft.trim().replace(/^"|"$/g, '');
    if (!p) return;
    if (settings.libraryDirs.some((d) => d.toLowerCase() === p.toLowerCase())) { setError('Ce dossier est déjà dans la liste.'); return; }
    setBusy(true); setError(null);
    try {
      const { ok } = await api.checkDir(p);
      if (!ok) { setError('Dossier introuvable sur le serveur. Copier le chemin depuis l\'Explorateur (barre d\'adresse).'); return; }
      save({ libraryDirs: [...settings.libraryDirs, p] }, 'Dossier ajouté, scan en cours.');
      setDraft('');
      setStatus((s) => (s ? { ...s, scanning: true, phase: 'fichiers' } : s));
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const rescan = () => { api.scan().then(setStatus).catch(() => {}); setStatus((s) => (s ? { ...s, scanning: true, phase: 'fichiers', done: 0, total: 0 } : s)); };

  return (
    <Section id="bibliotheque" n={1} title={<>La <em>bibliothèque</em></>}
      intro="Les dossiers sont surveillés : un film copié apparaît quelques secondes après la fin de la copie.">
      <div className="set-status" aria-live="polite">
        {status ? (
          status.scanning ? (
            <>
              <span className="set-status__dot is-live" aria-hidden />
              <span className="t-mono">Scan en cours · {status.phase}{status.total ? ` · ${status.done} / ${status.total}` : ''}</span>
              {status.total > 0 && <span className="set-status__bar" aria-hidden><i style={{ transform: `scaleX(${status.done / status.total})` }} /></span>}
            </>
          ) : (
            <>
              <span className="set-status__dot" aria-hidden />
              <span className="t-mono">{status.movies} films · dernier scan {ago(status.lastScanAt)}</span>
              <Button className="btn--sm" icon={<ArrowClockwise />} onClick={rescan}>Rescanner</Button>
            </>
          )
        ) : <span className="t-mono">…</span>}
      </div>

      <ul className="dirs" role="list">
        {settings.libraryDirs.map((d) => (
          <li key={d} className="dirs__row">
            <FolderSimple className="dirs__icon" aria-hidden />
            <span className="dirs__path">{d}</span>
            <button className="dirs__remove" aria-label={`Retirer ${d}`}
              onClick={() => save({ libraryDirs: settings.libraryDirs.filter((x) => x !== d) }, 'Dossier retiré. Ses films sont masqués, leurs fiches et l\'historique sont gardés.')}>
              <X aria-hidden /><span className="t-mono">Retirer</span>
            </button>
          </li>
        ))}
        {settings.libraryDirs.length === 0 && <li className="dirs__empty">Aucun dossier : la bibliothèque est vide.</li>}
      </ul>

      <form className="set-add" onSubmit={add}>
        <label className={`set-add__field${error ? ' is-error' : ''}`}>
          <span className="t-mono">Ajouter un dossier</span>
          <input aria-invalid={!!error} value={draft} onChange={(e) => { setDraft(e.target.value); setError(null); }} placeholder="D:\Films" spellCheck={false} autoComplete="off" />
        </label>
        <Button type="submit" variant="secondary" disabled={!draft.trim() || busy}>{busy ? 'Vérification…' : 'Ajouter'}</Button>
        {error && <p className="set-error" role="alert">{error}</p>}
        <p className="set-note">Chemin tel que le voit le PC qui fait tourner le serveur.</p>
      </form>
    </Section>
  );
}

// ---------- 02 Métadonnées ----------
function MetadataSection({ settings, save, movies, notify }: {
  settings: SettingsData; save: (p: Partial<SettingsData>, msg: string) => void; movies: MovieSummary[] | null; notify: (m: string) => void;
}) {
  const [info, setInfo] = useState<TmdbKeyInfo | null>(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.tmdbKey().then(setInfo).catch(() => {}); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { setInfo(await api.setTmdbKey(key)); setKey(''); notify('Clé acceptée par TMDB. Les fiches se complètent.'); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Échec de l\'enregistrement.'); }
    finally { setBusy(false); }
  };
  const remove = async () => { setInfo(await api.removeTmdbKey()); notify('Clé retirée de la base.'); };

  const review = (movies ?? []).filter((m) => m.matchStatus === 'review' || m.matchStatus === 'unmatched');
  const pending = (movies ?? []).filter((m) => m.matchStatus === 'pending').length;

  return (
    <Section id="metadonnees" n={2} title={<>Les <em>métadonnées</em></>}
      intro="Titres, résumés, générique, affiches et fonds viennent de TMDB. Les images sont gardées sur ce PC.">
      <Row label="Clé TMDB" wide hint={<>Gratuite : themoviedb.org → Paramètres → API. Clé v3 (32 caractères) ou jeton v4 (commence par eyJ). Elle reste sur ce PC et n'est jamais réaffichée.</>}>
        <div className="tmdb">
          <p className={`tmdb__state t-mono${info?.enabled ? ' is-on' : ''}`}>
            {info == null ? '…' : info.enabled
              ? <><Check aria-hidden /> Active · se termine par {info.hint} · {info.source === 'env' ? 'fichier .env' : 'saisie ici'}</>
              : 'Absente : les films gardent le titre de leur fichier.'}
          </p>
          <form className="tmdb__form" onSubmit={submit}>
            <input type="password" className={error ? 'is-error' : ''} aria-invalid={!!error} value={key} onChange={(e) => { setKey(e.target.value); setError(null); }} aria-label="Clé TMDB"
              placeholder={info?.enabled ? 'Remplacer la clé' : 'Coller la clé'} autoComplete="off" spellCheck={false} />
            <Button type="submit" variant={info?.enabled ? 'secondary' : 'primary'} disabled={key.trim().length < 20 || busy}>{busy ? 'Vérification…' : 'Vérifier et enregistrer'}</Button>
          </form>
          {error && <p className="set-error" role="alert">{error}</p>}
          {info?.source === 'reglages' && <button className="link tmdb__remove" onClick={remove}>Retirer la clé</button>}
        </div>
      </Row>
      <Row label="Langue des fiches" hint="Titres et résumés ; les films déjà identifiés changent au prochain enrichissement.">
        <Select label="Langue des fiches" value={settings.tmdbLanguage} onChange={(v) => save({ tmdbLanguage: v }, 'Langue des fiches enregistrée.')}>
          {TMDB_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Row>
      <Row label="À vérifier" wide hint={pending ? `${pending} film${pending > 1 ? 's' : ''} attendent encore leur fiche.` : 'Correspondances incertaines ou introuvables : à associer à la main.'}>
        {review.length ? (
          <ul className="review" role="list">
            {review.slice(0, 8).map((m) => (
              <li key={m.id}>
                <Link to={`/film/${m.id}?corriger`} className="review__row">
                  <span className="review__title">{m.title}</span>
                  <span className="t-mono review__meta">{m.year ?? '—'} · {m.matchStatus === 'review' ? 'incertain' : 'introuvable'}</span>
                  <span className="t-mono review__go">Corriger</span>
                </Link>
              </li>
            ))}
            {review.length > 8 && <li className="t-mono review__more">et {review.length - 8} autres</li>}
          </ul>
        ) : <p className="set-note">{info?.enabled ? 'Rien à vérifier.' : 'Disponible une fois la clé enregistrée.'}</p>}
      </Row>
    </Section>
  );
}

// ---------- 05 Sous-titres orphelins ----------
function OrphansSection({ movies, notify }: { movies: MovieSummary[] | null; notify: (m: string) => void }) {
  const [list, setList] = useState<OrphanSubtitle[] | null>(null);
  const [choice, setChoice] = useState<Record<number, string>>({});
  useEffect(() => { api.orphans().then(setList).catch(() => setList([])); }, []);
  const sorted = useMemo(() => [...(movies ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'fr')), [movies]);
  // proposition : le film dont le titre ressemble le plus à celui deviné depuis le fichier
  const guess = (o: OrphanSubtitle) => {
    if (!o.guessTitle) return '';
    const g = norm(o.guessTitle);
    // même titre ET année compatible : The Thing (2011) ne doit pas tomber sur The Thing (1982)
    const yearOk = (x: MovieSummary) => !o.guessYear || !x.year || Math.abs(x.year - o.guessYear) <= 1;
    const m = sorted.find((x) => yearOk(x) && (norm(x.title) === g || norm(x.originalTitle ?? '') === g))
      ?? sorted.find((x) => yearOk(x) && o.guessYear != null && x.year != null && (norm(x.title).includes(g) || g.includes(norm(x.title))));
    return m ? String(m.id) : '';
  };
  const assign = async (o: OrphanSubtitle) => {
    const id = Number(choice[o.id] ?? guess(o));
    if (!id) return;
    await api.assignSubtitle(o.id, id);
    setList((l) => l?.filter((x) => x.id !== o.id) ?? null);
    notify(`${o.fileName} rattaché à ${sorted.find((m) => m.id === id)?.title ?? 'ce film'}.`);
  };

  return (
    <Section id="orphelins" n={5} title={<>Sous-titres <em>orphelins</em></>}
      intro="Fichiers .srt, .ass ou .vtt trouvés sans film correspondant. Les rattacher les rend disponibles dans le lecteur.">
      {list == null ? <Skeleton h="6rem" /> : list.length === 0 ? (
        <p className="set-note set-note--plain">Aucun orphelin : chaque sous-titre a trouvé son film.</p>
      ) : (
        <ul className="orphans" role="list">
          {list.map((o) => {
            const value = choice[o.id] ?? guess(o);
            return (
              <li key={o.id} className="orphans__row">
                <div className="orphans__file">
                  <span className="orphans__name">{o.fileName}</span>
                  <span className="t-mono orphans__meta">{langName(o.language)}{o.guessTitle ? ` · lu « ${o.guessTitle}${o.guessYear ? ` (${o.guessYear})` : ''} »` : ''}</span>
                </div>
                <Select label={`Film pour ${o.fileName}`} value={value} onChange={(v) => setChoice((c) => ({ ...c, [o.id]: v }))}>
                  <option value="">Choisir le film…</option>
                  {sorted.map((m) => <option key={m.id} value={m.id}>{m.title}{m.year ? ` (${m.year})` : ''}</option>)}
                </Select>
                <Button className="btn--sm" variant="secondary" disabled={!value} onClick={() => assign(o)}>Rattacher</Button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ---------- Page ----------
export function Settings() {
  const { settings, error } = useSettings();
  const { movies } = useMovies();
  const [toast, setToast] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [active, setActive] = useState<string>(SECTIONS[0][0]);
  const [tv, setTvState] = useState(isTv);
  const main = useRef<HTMLElement>(null);
  useEffect(() => { api.health().then(setHealth).catch(() => {}); }, []);

  // sommaire : section visible
  useEffect(() => {
    if (!settings) return;
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id);
    }, { rootMargin: '-30% 0px -60% 0px' });
    main.current?.querySelectorAll('.set-sec').forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [settings]);

  const save = (patch: Partial<SettingsData>, msg: string) => {
    saveSettings(patch).then(() => setToast(msg)).catch((e: Error) => setToast(`Non enregistré : ${e.message}`));
  };

  if (error && !settings) {
    return <main className="page wrap set-state"><ErrorState code="ERR · /API/SETTINGS">Le serveur ne répond pas ({error}).</ErrorState></main>;
  }

  return (
    <main className="page settings" ref={main}>
      <header className="wrap set-top">
        <ReelCode n="00" label="Réglages" />
        <h1 className="t-h1 set-top__title">La <em>cabine</em></h1>
        <p className="t-mono set-top__sub">Chaque réglage s'enregistre aussitôt, pour tous les appareils.</p>
      </header>

      <div className="wrap set-layout">
        <nav className="set-index" aria-label="Sections des réglages">
          <ol role="list">
            {SECTIONS.map(([id, label], i) => (
              <li key={id}>
                <a href={`#${id}`} className={active === id ? 'is-on' : ''} aria-current={active === id ? 'true' : undefined}
                  onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActive(id); }}>
                  <span className="t-mono">{pad(i + 1)}</span>{label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {!settings ? (
          <div className="set-skel" aria-busy="true"><Skeleton h="10rem" /><Skeleton h="14rem" /></div>
        ) : (
          <div className="set-content">
            <LibrarySection settings={settings} save={save} />
            <MetadataSection settings={settings} save={save} movies={movies} notify={setToast} />

            <Section id="projection" n={3} title={<>La <em>projection</em></>} intro="Choix appliqués au lancement de chaque film ; ils se changent ensuite dans le lecteur.">
              <Row label="Langue audio" hint="Version originale : la piste marquée par défaut dans le fichier.">
                <Select label="Langue audio" value={settings.preferredAudioLanguage} onChange={(v) => save({ preferredAudioLanguage: v }, 'Langue audio enregistrée.')}>
                  <option value="original">Version originale</option>
                  {LANGS.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
                </Select>
              </Row>
              <Row label="Sous-titres" hint="Si l'audio est déjà dans cette langue, seuls les sous-titres forcés s'affichent.">
                <Select label="Sous-titres" value={settings.preferredSubtitleLanguage} onChange={(v) => save({ preferredSubtitleLanguage: v }, 'Sous-titres enregistrés.')}>
                  {LANGS.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
                  <option value="none">Aucun</option>
                </Select>
              </Row>
              <Row label="Qualité à distance" hint="Hors de ce PC (Tailscale, 4G) : débit maximal envoyé. À la maison, toujours l'original.">
                <Segmented<SettingsData['remoteQuality']> label="Qualité à distance" value={settings.remoteQuality}
                  onChange={(v) => save({ remoteQuality: v }, 'Qualité à distance enregistrée.')}
                  options={[{ value: 'original', label: 'Originale' }, { value: '8M', label: '8 Mb/s' }, { value: '4M', label: '4 Mb/s' }]} />
              </Row>
              <div className="set-row set-row--toggle">
                <Toggle label="Amorce 3-2-1" hint="Le compte à rebours avant chaque film. Toujours passable avec Échap."
                  checked={settings.leader} onChange={(v) => save({ leader: v }, v ? 'Amorce activée.' : 'Amorce désactivée.')} />
              </div>
              <Row label="Style des sous-titres" hint="Taille, hauteur, police, fond : propres à chaque appareil.">
                <span className="set-note">Bouton Sous-titres du lecteur</span>
              </Row>
            </Section>

            <Section id="salle" n={4} title={<>La <em>salle</em></>}>
              <div className="set-row set-row--toggle">
                <Toggle label="Grain de pellicule" hint="Texture animée sur toute l'interface. À couper sur un appareil lent."
                  checked={settings.grain} onChange={(v) => save({ grain: v }, v ? 'Grain activé.' : 'Grain coupé.')} />
              </div>
              <div className="set-row set-row--toggle">
                <Toggle label="Mode téléviseur sur cet appareil" hint="Interface agrandie, navigation aux flèches de la télécommande, sans grain. Activé tout seul sur les téléviseurs reconnus."
                  checked={tv} onChange={(v) => { setTv(v); setTvState(v); setToast(v ? 'Mode téléviseur activé sur cet appareil.' : 'Mode téléviseur retiré.'); }} />
              </div>
              <Row label="Mouvements" hint="Suivent le réglage « réduire les animations » de l'appareil.">
                <span className="set-note">Automatique</span>
              </Row>
            </Section>

            <OrphansSection movies={movies} notify={setToast} />

            <Section id="systeme" n={6} title={<>Le <em>système</em></>} intro="Lecture seule : ce que le serveur a trouvé au démarrage.">
              <dl className="sys">
                <div><dt className="t-mono">ffmpeg</dt><dd>{health ? health.ffmpeg ?? 'introuvable' : '…'}</dd></div>
                <div><dt className="t-mono">Encodage matériel</dt><dd>{health ? (health.hwaccel.length ? health.hwaccel.join(', ') : 'aucun, processeur') : '…'}</dd></div>
                <div><dt className="t-mono">TMDB</dt><dd>{health ? (health.tmdb ? 'active' : 'sans clé') : '…'}</dd></div>
                <div><dt className="t-mono">Version</dt><dd>{health?.version ?? '…'}</dd></div>
                <div><dt className="t-mono">Adresse</dt><dd>{location.origin}</dd></div>
              </dl>
              <p className="set-note">Mise à jour : relancer start.bat, qui récupère la dernière version depuis GitHub.</p>
            </Section>
          </div>
        )}
      </div>
      <Toast open={!!toast} message={toast ?? ''} onClose={() => setToast(null)} />
    </main>
  );
}
