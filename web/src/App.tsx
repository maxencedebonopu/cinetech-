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
import { Search } from './components/Search';
import './styles/app.css';
import './styles/search.css';

/** Écran pas encore construit : renvoie vers l'accueil. */
function Soon({ title }: { title: string }) {
  return (
    <main className="page wrap" style={{ paddingTop: 'var(--s-10)' }}>
      <EmptyState reel="BOB. 00 — Entracte" title={title} action={<Link className="btn btn--secondary" to="/"><span className="btn__label">Retour à l'accueil</span></Link>}>
        Cet écran arrive dans la suite de la phase 4.
      </EmptyState>
    </main>
  );
}

export function App() {
  const { pathname } = useLocation();
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
        <Route path="/statistiques" element={<Soon title="Les statistiques arrivent." />} />
        <Route path="/reglages" element={<Soon title="Les réglages arrivent." />} />
        <Route path="*" element={<Soon title="Cette bobine n'existe pas." />} />
      </Routes>
      {chrome && <BottomBar />}
      <Search />
      <Vignette />
      <Grain />
    </>
  );
}
