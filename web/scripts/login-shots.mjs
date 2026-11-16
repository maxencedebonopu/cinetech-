// Accès distant : page de connexion (vue comme un appareil distant) et section Réglages, en 1440, 390, 1920.
//   node scripts/login-shots.mjs <dossier/prefixe>
// Le serveur visé doit avoir un mot de passe défini ; un appareil distant est simulé par l'en-tête
// x-forwarded-for (comme le pose tailscale serve).
import { chromium } from 'playwright';
const [out] = process.argv.slice(2);
const base = process.env.WEB_URL ?? 'http://127.0.0.1:8769';
const browser = await chromium.launch();
const sizes = [['1440', 1440, 900], ['390', 390, 844], ['1920', 1920, 1080]];

for (const [name, width, height] of sizes) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width === 390 ? 2 : 1, extraHTTPHeaders: { 'x-forwarded-for': '100.64.0.9' } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('ERREUR', e.message));
  await page.goto(`${base}/bibliotheque`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}-connexion-${name}.png` });
  if (name === '1440') {
    await page.fill('#login-pw', 'mauvais');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}-connexion-erreur-${name}.png` });
    await page.fill('#login-pw', process.env.MDP ?? 'bobine42');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    console.log('après connexion :', new URL(page.url()).pathname, '|', await page.locator('h1').first().innerText().catch(() => '—'));
    await page.goto(`${base}/reglages#acces`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.evaluate(() => document.getElementById('acces').scrollIntoView());
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}-reglages-distant-${name}.png` });
  }
  await ctx.close();
}

// Réglages vus depuis le serveur lui-même
for (const [name, width, height] of sizes) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: width === 390 ? 2 : 1 });
  await page.goto(`${base}/reglages`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.evaluate(() => document.getElementById('acces').scrollIntoView());
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}-reglages-local-${name}.png` });
  await page.close();
}
await browser.close();
