// Statistiques : pages complètes 1440 / 390 / 1920, une année, et l'info-bulle du registre.
//   node scripts/stats-shots.mjs <dossier/prefixe>
import { chromium } from 'playwright';
const [out] = process.argv.slice(2);
const base = process.env.WEB_URL ?? 'http://localhost:8766';
const browser = await chromium.launch();
for (const [w, h, scale] of [[1440, 900, 1], [390, 844, 2], [1920, 1080, 1]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  page.on('pageerror', (e) => console.log('ERREUR', e.message));
  for (const [name, q] of [['tout', ''], ['annee', '?annee=2025'], ['vide', '?annee=2019']]) {
    if (name !== 'tout' && w === 1920) continue;
    await page.goto(`${base}/statistiques${q}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}-${w}-${name}.png`, fullPage: name !== 'vide' });
  }
  if (w === 1440) {
    await page.goto(`${base}/statistiques`, { waitUntil: 'networkidle' });
    const cells = page.locator('.cal__cell[data-l="4"]');
    await cells.last().scrollIntoViewIfNeeded();
    await cells.last().hover();
    await page.waitForTimeout(200);
    await page.locator('.cal').screenshot({ path: `${out}-${w}-bulle.png` });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    console.log('largeur document', sw);
  }
  if (w === 390) console.log('défilement horizontal 390 :', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  await page.close();
}
await browser.close();
