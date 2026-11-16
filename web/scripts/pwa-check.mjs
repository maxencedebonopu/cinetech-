// PWA : manifeste, service worker actif, interface et affiches hors ligne.
//   node scripts/pwa-check.mjs [dossier/prefixe]
import { chromium } from 'playwright';
const [out] = process.argv.slice(2);
const base = process.env.WEB_URL ?? 'http://localhost:8766';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
const manifest = await page.evaluate(async () => {
  const href = document.querySelector('link[rel=manifest]')?.getAttribute('href');
  const m = await (await fetch(href)).json();
  return { name: m.name, display: m.display, icons: m.icons.map((i) => `${i.sizes}${i.purpose ? ' ' + i.purpose : ''}`) };
});
console.log('manifeste', JSON.stringify(manifest));
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.active?.state; });
console.log('service worker', sw);
await page.reload({ waitUntil: 'networkidle' }); // la page est désormais contrôlée : les affiches passent par le cache
await page.goto(`${base}/bibliotheque`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const cached = await page.evaluate(async () => (await (await caches.open('cine-images-v1')).keys()).length);
console.log('images en cache', cached);

await ctx.setOffline(true);
await page.goto(`${base}/bibliotheque`, { waitUntil: 'domcontentloaded' }).catch((e) => console.log('navigation hors ligne échouée', e.message));
await page.waitForTimeout(1500);
console.log('hors ligne : titre', await page.title(), '| texte', (await page.locator('main').innerText().catch(() => '')).slice(0, 120).replace(/\s+/g, ' '));
if (out) await page.screenshot({ path: `${out}-horsligne.png` });
await ctx.setOffline(false);
await browser.close();
