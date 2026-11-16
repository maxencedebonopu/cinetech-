// Comparaison : le banc d'essai de la phase 2 dans le même Edge sans interface.
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.goto((process.env.API ?? 'http://localhost:8766') + '/dev/player', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(() => window.runTest('Angst', 0));
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000);
  const r = await page.evaluate(() => window.lastResult);
  if (r !== 'running') { console.log(JSON.stringify(r)); break; }
}
await browser.close();
