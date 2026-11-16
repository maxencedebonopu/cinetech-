// Recherche : ouverture au clavier, plusieurs requêtes, captures 1440 / 390 / 1920.
import { chromium } from 'playwright';
const [out] = process.argv.slice(2);
const base = process.env.WEB_URL ?? 'http://localhost:8765';
const browser = await chromium.launch();
const queries = [['vide', ''], ['titre', 'ver'], ['faute', 'chunking'], ['annee', '1999'], ['rien', 'zzzz']];
for (const [w, h, scale] of [[1440, 900, 1], [390, 844, 2], [1920, 1080, 1]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(500);
  for (const [name, q] of queries) {
    await page.locator('.search__field input').fill(q);
    if (name === 'titre') await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}-${w}-${name}.png` });
    const n = await page.locator('.search__row').count();
    if (w === 1440) console.log(`« ${q} » → ${n} ligne(s) :`, (await page.locator('.search__title').allTextContents()).slice(0, 4).join(' | '));
  }
  // Entrée : ouvre la fiche du premier résultat
  await page.locator('.search__field input').fill('psy');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  if (w === 1440) console.log('Entrée →', new URL(page.url()).pathname);
  await page.close();
}
await browser.close();
