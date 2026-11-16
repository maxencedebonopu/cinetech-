// Réglages : pages complètes 1440 / 390 / 1920, dossier introuvable, bascule avec message.
//   node scripts/settings-shots.mjs <dossier/prefixe>
import { chromium } from 'playwright';
const [out] = process.argv.slice(2);
const base = process.env.WEB_URL ?? 'http://localhost:8766';
const browser = await chromium.launch();
for (const [w, h, scale] of [[1440, 900, 1], [390, 844, 2], [1920, 1080, 1]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  page.on('pageerror', (e) => console.log('ERREUR', e.message));
  await page.goto(`${base}/reglages`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}-${w}-page.png`, fullPage: true });
  if (w !== 1920) {
    await page.locator('.set-add input').fill('Z:\\Films introuvables');
    await page.locator('.set-add button[type=submit]').click();
    await page.waitForSelector('.set-error');
    await page.locator('#bibliotheque').screenshot({ path: `${out}-${w}-dossier.png` });
    console.log(w, 'erreur dossier :', await page.locator('.set-error').textContent());
  }
  if (w === 1440) {
    await page.locator('#projection').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}-${w}-sommaire.png` });
    console.log('sommaire actif :', await page.locator('.set-index a.is-on').textContent());
  }
  console.log(w, 'débordement :', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  await page.close();
}
await browser.close();
