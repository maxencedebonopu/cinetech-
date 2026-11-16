// Captures d'écran pour la boucle d'autocritique : 1440, 390 et 1920 px.
// node scripts/shots.mjs [chemin=/design] [dossier=shots] [préfixe=iter]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [route = '/design', outDir = 'shots', prefix = 'iter'] = process.argv.slice(2);
const base = process.env.WEB_URL ?? 'http://localhost:5173';
const only = process.env.SIZES?.split(',');
const sizes = [
  { name: '1440', width: 1440, height: 900, scale: 1 },
  { name: '390', width: 390, height: 844, scale: 2, mobile: true },
  { name: '1920', width: 1920, height: 1080, scale: 1 },
].filter((s) => !only || only.includes(s.name));

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
for (const s of sizes) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.scale, isMobile: !!s.mobile, hasTouch: !!s.mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + route, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2600); // titres révélés + cache
  await page.screenshot({ path: path.join(outDir, `${prefix}-${s.name}-hero.png`) });
  // Défilement pour déclencher le chargement paresseux des images
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += s.height * 0.8) { await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForTimeout(120); }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(900);
  const sections = await page.$$(process.env.SEL ?? 'section[id]');
  for (const [i, el] of sections.entries()) {
    const id = (await el.getAttribute('id')) ?? `s${i + 1}`;
    const box = await el.boundingBox();
    if (!box || box.height < 4) continue; // zones vides (messages passagers…)
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await el.screenshot({ path: path.join(outDir, `${prefix}-${s.name}-${id}.png`) });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`${s.name}px : ${sections.length} sections, débordement horizontal ${overflow}px${errors.length ? `, erreurs : ${errors.join(' | ')}` : ''}`);
  await ctx.close();
}
await browser.close();
