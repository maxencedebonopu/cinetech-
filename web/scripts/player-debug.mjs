// Diagnostic du lecteur : réponses réseau, état de la vidéo, erreurs.
import { chromium } from 'playwright';
const [id = '28'] = process.argv.slice(2);
const base = process.env.WEB_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'msedge', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('response', async (r) => {
  const u = r.url();
  if (u.includes('/api/playback/start')) console.log('start →', r.status(), (await r.text()).slice(0, 300));
  else if (u.includes('/api/hls/') || u.includes('/file')) console.log('flux', r.status(), u.split('/').slice(-2).join('/'));
});
await page.goto(`${base}/film/${id}`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Projeter|Reprendre/ }).first().click();
for (let i = 0; i < 8; i++) {
  if (i === 3 && process.env.FORCEPLAY) console.log('play()', await page.evaluate(() => document.querySelector('video').play().then(() => 'ok', (e) => e.message)));
  await page.waitForTimeout(1500);
  console.log(await page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? `t=${v.currentTime.toFixed(1)} ready=${v.readyState} net=${v.networkState} paused=${v.paused} err=${v.error?.message ?? '-'} src=${v.currentSrc.slice(0, 40)} live=${!!document.querySelector('.player.is-live')} intro=${!!document.querySelector('.pintro')}` : 'pas de vidéo';
  }));
}
await browser.close();
