// Navigation : bandeau supérieur (bureau, TV) et barre basse (téléphone).
import { useEffect, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { House, FilmStrip, ChartBar, Gear, MagnifyingGlass } from '@phosphor-icons/react';

const LINKS = [
  { to: '/', label: 'Accueil', icon: <House />, end: true },
  { to: '/bibliotheque', label: 'Bibliothèque', icon: <FilmStrip /> },
  { to: '/statistiques', label: 'Statistiques', icon: <ChartBar /> },
  { to: '/reglages', label: 'Réglages', icon: <Gear /> },
];

export function openSearch() { window.dispatchEvent(new CustomEvent('cine:search')); }

export function TopNav() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 48);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`topnav${solid ? ' is-solid' : ''}`}>
      <Link to="/" className="topnav__mark" aria-label="Cinémathèque — accueil">Cinémathèque</Link>
      <nav className="topnav__links" aria-label="Navigation principale">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className="topnav__link">{l.label}</NavLink>
        ))}
      </nav>
      <button className="topnav__search" onClick={openSearch} aria-label="Rechercher (Ctrl K)">
        <MagnifyingGlass aria-hidden />
        <span className="topnav__search-label">Rechercher</span>
        <kbd className="t-mono">Ctrl K</kbd>
      </button>
    </header>
  );
}

export function BottomBar() {
  return (
    <nav className="bottombar" aria-label="Navigation">
      {LINKS.slice(0, 2).map((l) => (
        <NavLink key={l.to} to={l.to} end={l.end} className="bottombar__item">
          <span className="bottombar__icon" aria-hidden>{l.icon}</span>{l.label}
        </NavLink>
      ))}
      <button className="bottombar__item" onClick={openSearch}>
        <span className="bottombar__icon" aria-hidden><MagnifyingGlass /></span>Chercher
      </button>
      {LINKS.slice(2).map((l) => (
        <NavLink key={l.to} to={l.to} className="bottombar__item">
          <span className="bottombar__icon" aria-hidden>{l.icon}</span>{l.label === 'Statistiques' ? 'Stats' : l.label}
        </NavLink>
      ))}
    </nav>
  );
}
