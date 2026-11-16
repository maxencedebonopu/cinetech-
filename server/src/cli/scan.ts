// Scan en ligne de commande : npm run scan
import { scan, getStatus } from '../library/library.ts';
import { db } from '../db.ts';

const t = Date.now();
const timer = setInterval(() => {
  const s = getStatus();
  if (s.total) process.stdout.write(`\r  ${s.phase} ${s.done}/${s.total}      `);
}, 500);
await scan();
clearInterval(timer);
console.log(`\nTerminé en ${((Date.now() - t) / 1000).toFixed(1)} s`, getStatus());
db.close();
