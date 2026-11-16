// Icônes de l'application (PWA, écran d'accueil iOS, raccourci Windows) depuis le motif de bobine du favicon.
//   node scripts/icons.mjs
import sharp from 'sharp';
const reel = (scale) => {
  const t = (v) => 32 + (v - 32) * scale;
  const r = (v) => v * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0D0B09"/>
<circle cx="32" cy="32" r="${r(21)}" fill="none" stroke="#EDE6D6" stroke-width="${r(2)}"/><circle cx="32" cy="32" r="${r(4)}" fill="#B3261E"/>
<g fill="#EDE6D6">${[[32, 19], [32, 45], [19, 32], [45, 32]].map(([x, y]) => `<circle cx="${t(x)}" cy="${t(y)}" r="${r(4.5)}"/>`).join('')}</g></svg>`;
};
const out = [
  ['icons/icon-192.png', 192, 1], ['icons/icon-512.png', 512, 1],
  ['icons/maskable-512.png', 512, 0.72], // zone sûre Android : cercle de 40 % du côté
  ['icons/apple-touch-icon.png', 180, 0.86],
];
for (const [file, size, scale] of out) {
  await sharp(Buffer.from(reel(scale)), { density: 72 * (size / 64) }).resize(size, size).png().toFile(`public/${file}`);
  console.log(file);
}

// Raccourci Windows : .ico multi-tailles (entrées PNG, lues par Windows depuis Vista)
const sizes = [16, 24, 32, 48, 64, 256];
const pngs = await Promise.all(sizes.map((s) => sharp(Buffer.from(reel(0.92)), { density: 72 * (s / 64) }).resize(s, s).png().toBuffer()));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s === 256 ? 0 : s, e); head.writeUInt8(s === 256 ? 0 : s, e + 1);
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(pngs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
await import('node:fs').then((fs) => fs.writeFileSync('../scripts/cinematheque.ico', Buffer.concat([head, ...pngs])));
console.log('../scripts/cinematheque.ico');
