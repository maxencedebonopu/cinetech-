import { Routes, Route, Link } from 'react-router-dom';
import { Grain, Vignette } from './components/cinema';
import { DesignPage } from './pages/DesignPage';
import { EmptyState } from './components/states';

export function App() {
  return (
    <>
      <Routes>
        <Route path="/design" element={<DesignPage />} />
        <Route
          path="*"
          element={
            <main style={{ padding: 'var(--s-9) var(--gutter)' }}>
              <EmptyState reel="BOB. 00 — Entracte" title="Les écrans arrivent en phase 4." action={<Link className="link" to="/design">Voir le nuancier</Link>}>
                Le système de dessin est prêt : couleurs, typographie, composants et mouvement.
              </EmptyState>
            </main>
          }
        />
      </Routes>
      <Vignette />
      <Grain />
    </>
  );
}
