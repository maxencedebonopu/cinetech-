import { useEffect } from 'react';
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

export function App() {
  const { pathname } = useLocation();
  const { settings } = useSettings();
  const chrome = !pathname.startsWith('/design') && !pathname.startsWith('/lecture');
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <>
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
