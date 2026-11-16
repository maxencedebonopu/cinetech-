// Téléviseur et télécommande : mode TV (interface agrandie, sans grain) et navigation spatiale
// aux flèches entre les éléments focalisables. Le lecteur garde ses propres touches.
//
// Mode TV : détecté par le navigateur (Tizen, webOS, Android TV, Fire TV…) ou forcé avec ?tv=1
// (mémorisé sur l'appareil ; ?tv=0 pour revenir).

const TV_UA = /SMART-?TV|SmartTV|Tizen|Web0S|webOS|NetCast|HbbTV|BRAVIA|Android TV|GoogleTV|AFT[A-Z]|CrKey|Roku|VIDAA|PhilipsTV|Viera/i;
const KEY = 'cine:tv';

const BACK_KEYS = new Set(['Escape', 'Backspace', 'BrowserBack', 'GoBack', 'XF86Back']);
/** Touche « retour » : Échap, retour arrière, et les touches retour des télécommandes (Tizen 10009, webOS 461). */
export function isBackKey(e: KeyboardEvent) {
  return BACK_KEYS.has(e.key) || e.keyCode === 10009 || e.keyCode === 461;
}

export function isTv() { return document.documentElement.classList.contains('tv'); }

export function initTv() {
  const q = new URLSearchParams(location.search).get('tv');
  let forced: string | null = null;
  try {
    if (q === '1' || q === '0') localStorage.setItem(KEY, q);
    forced = localStorage.getItem(KEY);
  } catch { /* stockage indisponible */ }
  const tv = forced ? forced === '1' : TV_UA.test(navigator.userAgent);
  document.documentElement.classList.toggle('tv', tv);
  window.addEventListener('keydown', onKey);
  // la souris (ou le pointeur d'une télécommande LG) reprend la main : on montre le curseur
  window.addEventListener('pointermove', () => document.documentElement.classList.remove('kbd'), { passive: true });
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';
type Dir = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

function scope(): ParentNode {
  return document.querySelector('dialog[open]') ?? document.querySelector('.search') ?? document;
}

function visible(el: HTMLElement) {
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
}

/** Candidat le plus proche dans la direction : distance dans l'axe + 2 × décalage perpendiculaire. */
function next(from: DOMRect, dir: Dir, list: HTMLElement[]) {
  const cx = from.left + from.width / 2, cy = from.top + from.height / 2;
  let best: HTMLElement | null = null, bestScore = Infinity;
  for (const el of list) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    let main: number, cross: number;
    switch (dir) {
      case 'ArrowRight': if (r.left < from.right - 4 && x <= cx + 4) continue; main = Math.max(0, r.left - from.right); cross = overlap(from.top, from.bottom, r.top, r.bottom) ? 0 : Math.abs(y - cy); break;
      case 'ArrowLeft': if (r.right > from.left + 4 && x >= cx - 4) continue; main = Math.max(0, from.left - r.right); cross = overlap(from.top, from.bottom, r.top, r.bottom) ? 0 : Math.abs(y - cy); break;
      case 'ArrowDown': if (r.top < from.bottom - 4 && y <= cy + 4) continue; main = Math.max(0, r.top - from.bottom); cross = overlap(from.left, from.right, r.left, r.right) ? Math.abs(x - cx) * 0.25 : Math.abs(x - cx); break;
      default: if (r.bottom > from.top + 4 && y >= cy - 4) continue; main = Math.max(0, from.top - r.bottom); cross = overlap(from.left, from.right, r.left, r.right) ? Math.abs(x - cx) * 0.25 : Math.abs(x - cx); break;
    }
    const score = main + cross * 2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}
const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.min(a2, b2) - Math.max(a1, b1) > 4;

function onKey(e: KeyboardEvent) {
  if (!isTv() || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('.player')) return; // le lecteur a ses touches
  const active = document.activeElement as HTMLElement | null;
  const typing = active?.matches('input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable="true"]');

  if (isBackKey(e)) {
    if (typing && e.key === 'Backspace') return;
    if (document.querySelector('dialog[open], .search')) return; // ils se ferment eux-mêmes
    if (e.key === 'Escape') return;
    e.preventDefault();
    if (history.length > 1 && location.pathname !== '/') history.back();
    return;
  }
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  if (typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return; // curseur dans le champ
  if (active?.matches('input[type=range]') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;

  const list = [...scope().querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el !== active && visible(el));
  e.preventDefault();
  document.documentElement.classList.add('kbd');
  const from = active && active !== document.body && visible(active) ? active.getBoundingClientRect() : null;
  const target = from
    ? next(from, e.key as Dir, list)
    : list.find((el) => el.closest('main')) ?? list[0];
  if (!target) return;
  target.focus({ preventScroll: true });
  // comme sur un téléviseur : l'élément choisi vient au milieu de l'écran (jamais sous les barres collantes)
  const smooth = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const r = target.getBoundingClientRect();
  const fixed = target.closest('.topnav, .lib-bar, .search, dialog, .set-index');
  if (!fixed && (r.top < innerHeight * 0.3 || r.bottom > innerHeight * 0.85)) {
    window.scrollBy({ top: r.top + r.height / 2 - innerHeight * 0.55, behavior: smooth });
  }
  // rangées qui défilent à l'horizontale : seul leur défilement propre bouge (pas la page)
  for (let el = target.parentElement; el && el !== document.body; el = el.parentElement) {
    const ox = getComputedStyle(el).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 2) {
      const c = el.getBoundingClientRect();
      if (r.left < c.left + 16) el.scrollBy({ left: r.left - c.left - 32, behavior: smooth });
      else if (r.right > c.right - 16) el.scrollBy({ left: r.right - c.right + 32, behavior: smooth });
      break;
    }
  }
}

/** Force (ou retire) le mode TV sur cet appareil, depuis les Réglages. */
export function setTv(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* stockage indisponible */ }
  document.documentElement.classList.toggle('tv', on);
}
