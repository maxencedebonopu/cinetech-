// Parcours du lecteur dans Edge (codecs H.264/AAC/HEVC disponibles, contrairement au Chromium de Playwright).
// node scripts/player-shots.mjs <idFilm> <préfixe de sortie>
import { chromium } from 'playwright';
const [id = '28', out] = process.argv.slice(2);
const base = process.env.WEB_URL ?? 'http://localhost:5173';
const only = process.env.SIZES?.split(',');
const sizes = [[1440, 900, 1], [390, 844, 2], [1920, 1080, 1]].filter(([w]) => !only || only.includes(String(w)));
const browser = await chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] });
for (const [w, h, scale] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale, hasTouch: w < 600, isMobile: w < 600 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const t0 = Date.now();
  await page.goto(`${base}/film/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Projeter|Reprendre/ }).first().click();
  await page.waitForTimeout(350); await page.screenshot({ path: `${out}-${w}-1-rideau.png` });
  await page.waitForTimeout(1200); await page.screenshot({ path: `${out}-${w}-2-amorce.png` });
  await page.waitForFunction(() => document.querySelector('.player.is-live') && !document.querySelector('video').paused, null, { timeout: 30000 }).catch(() => {});
  const live = Date.now() - t0;
  const wake = async () => { if (w < 600) await page.touchscreen.tap(w / 2, h / 3); else await page.mouse.move(w / 2 + Math.random() * 20, h / 2); };
  await wake(); await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}-${w}-3-commandes.png` });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${out}-${w}-4-image.png` });
  // Saut à 30 % (relance du flux), attente d'une réplique sous-titrée
  await page.keyboard.press('3');
  await page.waitForFunction(() => document.querySelector('.psubs'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}-${w}-4b-dialogue.png` });
  // Survol de la barre : vignette
  const bar = await page.locator('.seek').boundingBox();
  if (bar && w >= 600) {
    await page.mouse.move(bar.x + bar.width * 0.40, bar.y + bar.height / 2); await page.waitForTimeout(200);
    await page.mouse.move(bar.x + bar.width * 0.42, bar.y + bar.height / 2); await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}-${w}-5-survol.png` });
  }
  await wake(); await page.waitForTimeout(300);
  await page.locator('[aria-label="Sous-titres"]').click(); await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}-${w}-6-soustitres.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.keyboard.press('Shift+Slash'); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}-${w}-7-aide.png` });
  await page.keyboard.press('Escape');
  const st = await page.evaluate(() => { const v = document.querySelector('video'); return { t: v.currentTime.toFixed(1), paused: v.paused, size: `${v.videoWidth}x${v.videoHeight}`, err: v.error?.message ?? null, subs: document.querySelector('.psubs')?.textContent?.slice(0, 60) ?? null }; });
  console.log(`${w}px : image en ${(live / 1000).toFixed(1)} s après le clic (séquence comprise) ·`, JSON.stringify(st), errors.length ? `erreurs : ${errors.join(' | ')}` : '');
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  await page.close();
}
await browser.close();
