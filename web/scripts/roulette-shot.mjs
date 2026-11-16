// Capture de la séance surprise après tirage (1440 et 390 px).
import { chromium } from 'playwright';
const [out] = process.argv.slice(2);
const browser = await chromium.launch();
for (const [w, h, scale] of [[1440, 900, 1], [390, 844, 2]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.goto(process.env.WEB_URL ?? 'http://localhost:5173/', { waitUntil: 'networkidle' });
  const btn = page.getByRole('button', { name: 'Lancer la bobine' });
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.waitForTimeout(1200);
  await page.locator('.surprise').screenshot({ path: `${out}-${w}-spin.png` });
  await page.waitForTimeout(2600);
  await page.waitForLoadState('networkidle');
  await page.locator('.surprise').screenshot({ path: `${out}-${w}-done.png` });
  await page.close();
}
await browser.close();
