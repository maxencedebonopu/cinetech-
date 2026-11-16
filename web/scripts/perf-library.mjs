// Fluidité de la bibliothèque avec une collection gonflée (liste réelle × 20 ≈ 660 films).
import { chromium } from 'playwright';
const base = process.env.WEB_URL ?? 'http://localhost:5173';
const real = await (await fetch(`${base}/api/movies`)).json();
const big = Array.from({ length: 20 }, (_, k) => real.map((m) => ({ ...m, id: m.id + k * 10000, title: k ? `${m.title} ${k + 1}` : m.title }))).flat();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route('**/api/movies', (r) => r.fulfill({ json: big }));
for (const vue of ['', '?vue=planche', '?vue=chrono']) {
  await page.goto(`${base}/bibliotheque${vue}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  if (process.env.NOGRAIN) await page.evaluate(() => { document.documentElement.dataset.grain = 'off'; });
  const r = await page.evaluate(async () => {
    const nodes = document.querySelectorAll('.poster, .contact, .chrono__film').length;
    const times = [];
    let last = performance.now();
    const total = document.documentElement.scrollHeight - innerHeight;
    await new Promise((done) => {
      let y = 0;
      const step = () => {
        const now = performance.now(); times.push(now - last); last = now;
        y += 60; scrollTo(0, y);
        if (y < Math.min(total, 30000)) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    const slow = times.filter((t) => t > 33).length;
    return { nodes, frames: times.length, p95: p95.toFixed(1), slow, height: total };
  });
  console.log(`${vue || '?vue=affiches'} : ${big.length} films, ${r.nodes} éléments dans le DOM, ${r.frames} images de défilement, p95 ${r.p95} ms, ${r.slow} > 33 ms`);
}
await browser.close();
