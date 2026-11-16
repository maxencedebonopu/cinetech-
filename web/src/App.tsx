import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthState } from '@cine/shared';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Grain, Vignette } from './components/cinema';
import { TopNav, BottomBar } from './components/Nav';
import { EmptyState } from './components/states';
import { DesignPage } from './pages/DesignPage';
import { Home } from './pages/Home';
import { Film } from './pages/Film';
import { Library } from './pages/Library';
import { Player } from './pages/Player';
import { Stats } from './pages/Stats';
import { Settings } from './pages/Settings';
import { Login } from './pages/Login';
import { api } from './lib/api';
import { Search } from './components/Search';
import { useSettings } from './lib/store';
import './styles/app.css';
import './styles/search.css';

/** Adresse inconnue. */
function NotFound() {
  return (
    <main className="page wrap" style={{ paddingTop: 'var(--s-10)' }}>
      <EmptyState reel="BOB. 00 — Entracte" title="Cette bobine n'existe pas." action={<Link className="btn btn--secondary" to="/"><span className="btn__label">Retour à l'accueil</span></Link>}>
        L'adresse ne correspond à aucun écran.
      </EmptyState>
    </main>
  );
}

/** Hors ligne : la collection reste consultable (copie gardée par le service worker), pas la projection. */
function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/** Accès distant : état de connexion ; 'inconnu' hors ligne (la copie gardée reste consultable). */
function useAuth() {
  const [state, setState] = useState<AuthState | 'inconnu' | null>(null);
  const refresh = useCallback(() => { api.auth().then(setState, () => setState('inconnu')); }, []);
  useEffect(() => {
    refresh();
    window.addEventListener('cine:auth', refresh); // séance fermée ou mot de passe changé ailleurs
    return () => window.removeEventListener('cine:auth', refresh);
  }, [refresh]);
  return { state, refresh };
}

export function App() {
  const { state, refresh } = useAuth();
  const shown = useRef(false);
  if (state === null) return null;
  if (state !== 'inconnu' && !state.authenticated) {
    // séance fermée en cours de route : les données déjà chargées sont périmées, on recharge après connexion
    const done = shown.current ? () => window.location.reload() : refresh;
    return <><Login state={state} onDone={done} /><Vignette /><Grain /></>;
  }
  shown.current = true;
  return <Shell />;
}

function Shell() {
  const { pathname } = useLocation();
  const { settings } = useSettings();
  const online = useOnline();
  const chrome = !pathname.startsWith('/design') && !pathname.startsWith('/lecture');
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <>
      {!online && <p className="offline t-mono" role="status">Hors ligne<span className="offline__more"> · la collection reste consultable, la projection attend le réseau</span><span className="offline__short"> · projection indisponible</span></p>}
      {chrome && <TopNav />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/design" element={<DesignPage />} />
        <Route path="/film/:id" element={<Film />} />
        <Route path="/bibliotheque" element={<Library />} />
        <Route path="/lecture/:id" element={<Player />} />
        <Route path="/statistiques" element={<Stats />} />
        <Route path="/reglages" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      {chrome && <BottomBar />}
      <Search />
      <Vignette />
      {settings?.grain !== false && <Grain />}
    </>
  );
}
