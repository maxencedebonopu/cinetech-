// Ouverture directe de /lecture/:id (rechargement, lien) sans passer par la fiche.
import { chromium } from 'playwright';
const [id = '11'] = process.argv.slice(2);
const base = process.env.WEB_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await page.goto(`${base}/lecture/${id}`, { waitUntil: 'networkidle' });
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1500);
  console.log(await page.evaluate(() => { const v = document.querySelector('video'); return `ready=${v?.readyState} paused=${v?.paused} intro=${document.querySelector('.pintro') ? (document.querySelector('.leader') ? 'amorce' : 'autre') : 'non'} live=${!!document.querySelector('.is-live')} err=${document.querySelector('.player.is-error') ? 'oui' : 'non'}`; }));
}
await browser.close();
