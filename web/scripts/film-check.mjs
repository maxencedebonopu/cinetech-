// Vérifie la fiche : fenêtre d'association, note persistée, transition depuis l'accueil.
import { chromium } from 'playwright';
const [out] = process.argv.slice(2);
const base = process.env.WEB_URL ?? 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/film/4`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Associer à une fiche' }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}-dialog.png` });
await page.keyboard.press('Escape');
await page.locator('.rating__star').nth(3).click();
await page.waitForTimeout(500);
const rating = (await (await fetch(`${base}/api/movies/4`)).json()).user.rating;
console.log('note enregistrée :', rating);
await fetch(`${base}/api/movies/4/user`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating: null }) });
// Transition partagée : clic sur une affiche de l'accueil
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
const poster = page.locator('.decade .poster').first();
await poster.scrollIntoViewIfNeeded();
await poster.click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}-transition.png` });
await page.waitForTimeout(1200);
console.log('url après clic :', page.url(), errors.length ? `erreurs : ${errors.join(' | ')}` : 'sans erreur');
await browser.close();
