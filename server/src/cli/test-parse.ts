// Vérifie le parseur sur tous les fichiers des dossiers de la bibliothèque (lecture seule).
import fs from 'node:fs';
import path from 'node:path';
import { parseName, parseSubtitleName } from '../library/parse.ts';

const dirs = (process.env.LIBRARY_DIRS || 'C:\\DOCUMENTS\\Movies & Shows').split(';');
function walk(d: string): string[] {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
}
for (const dir of dirs) {
  for (const f of walk(dir)) {
    const name = path.basename(f);
    if (/\.(srt|vtt|ass)$/i.test(name)) {
      const p = parseSubtitleName(name);
      console.log(`SUB  ${p.title.padEnd(32)} ${String(p.year ?? '—').padEnd(5)} ${String(p.language ?? '?').padEnd(3)} ${p.forced ? 'forced ' : ''}← ${name}`);
    } else {
      const p = parseName(name);
      console.log(`FILM ${p.title.padEnd(32)} ${String(p.year ?? '—').padEnd(5)} ${(p.edition ?? '').padEnd(16)} ← ${name}`);
    }
  }
}
