// Mode TV : navigation à la télécommande (flèches, OK, retour) en 1920×1080, captures du focus.
//   node scripts/tv-check.mjs <dossier/prefixe>
import { chromium } from 'playwright';
const [out] = process.argv.slice(2);
const base = process.env.WEB_URL ?? 'http://localhost:8766';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('ERREUR', e.message));
const label = () => page.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return '(rien)';
  return `${a.tagName.toLowerCase()}.${String(a.className).split(' ')[0]} « ${(a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)} »`;
});
const press = async (key, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(key); await page.waitForTimeout(260); } };

await page.goto(`${base}/?tv=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
console.log('mode TV :', await page.evaluate(() => document.documentElement.classList.contains('tv')), '| taille du texte', await page.evaluate(() => getComputedStyle(document.documentElement).fontSize));

// Accueil : premier appui → premier élément de la page, puis descente et parcours d'une rangée
await press('ArrowDown'); console.log('accueil ↓1', await label());
await page.screenshot({ path: `${out}-accueil-1.png` });
await press('ArrowDown', 2); console.log('accueil ↓3', await label());
await press('ArrowRight', 2); console.log('accueil →2', await label());
await page.screenshot({ path: `${out}-accueil-2.png` });
await press('ArrowUp', 6); console.log('accueil ↑6', await label());

// Bibliothèque : grille d'affiches
await page.goto(`${base}/bibliotheque`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await press('ArrowDown', 4); console.log('biblio ↓4', await label());
await press('ArrowRight', 3); console.log('biblio →3', await label());
await press('ArrowDown', 2); console.log('biblio ↓2', await label());
await page.screenshot({ path: `${out}-biblio.png` });
const before = page.url();
await press('Enter'); await page.waitForTimeout(900);
console.log('OK →', new URL(page.url()).pathname);
await press('ArrowDown'); console.log('fiche ↓1', await label());
await page.screenshot({ path: `${out}-fiche.png` });
await page.keyboard.press('Backspace'); await page.waitForTimeout(900);
console.log('retour →', new URL(page.url()).pathname, page.url() === before ? '(page précédente)' : '');

// Réglages : bascules et listes
await page.goto(`${base}/reglages`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await press('ArrowDown', 5); console.log('réglages ↓5', await label());
await page.screenshot({ path: `${out}-reglages.png` });

// Recherche : Ctrl K puis flèches dans la liste
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.keyboard.press('Control+k'); await page.waitForTimeout(500);
await page.keyboard.type('psy'); await page.waitForTimeout(400);
await press('ArrowDown'); console.log('recherche ↓', await page.locator('.search__row.is-sel .search__title').textContent().catch(() => '—'));
await page.screenshot({ path: `${out}-recherche.png` });
await browser.close();
