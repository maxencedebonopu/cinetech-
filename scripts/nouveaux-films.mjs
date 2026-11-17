// Nouveaux films : tout préparer pour le site, puis faire le bilan.
//   node scripts/nouveaux-films.mjs                    sous-titres zippés, scan, attente des fiches, bilan
//   node scripts/nouveaux-films.mjs --bilan             bilan seulement
//   node scripts/nouveaux-films.mjs --corriger <id> <Q…>  fiche Wikidata choisie à la main
//   node scripts/nouveaux-films.mjs --chercher "<titre>"  candidats Wikidata (pour --corriger)
// Le serveur doit tourner (il surveille déjà le dossier ; ce script complète et vérifie).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, '.env');
const port = process.env.PORT || (fs.existsSync(envFile) && /^\s*PORT\s*=\s*(\d+)/m.exec(fs.readFileSync(envFile, 'utf8'))?.[1]) || '8765';
const BASE = `http://127.0.0.1:${port}`;
const STAMP = path.join(ROOT, 'data', '.dernier-bilan');
const SUB = /\.(srt|ass|ssa|vtt)$/i;
// tar de Windows (lit les .zip) ; celui de Git Bash prend « C: » pour un hôte distant
const TAR = [path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')].find((p) => fs.existsSync(p)) ?? 'tar';
const args = process.argv.slice(2);
const say = (m = '') => console.log(m ? `  ${m}` : '');

async function api(p, init) {
  const res = await fetch(BASE + p, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `${res.status} ${p}`);
  return body;
}
const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

try { await api('/api/health'); }
catch {
  say('Le serveur ne répond pas : lancer « Cinémathèque » (raccourci du Bureau) ou start.bat, puis relancer.');
  process.exit(2);
}

// ---------- Correction manuelle ----------
if (args[0] === '--chercher') {
  const q = args.slice(1).join(' ');
  const u = `https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'query', list: 'search', srsearch: `${q} haswbstatement:P57`, srlimit: '8', format: 'json', srprop: 'snippet' })}`;
  const r = await (await fetch(u, { headers: { 'user-agent': 'Cinematheque/0.1 (serveur multimedia personnel) Node.js' } })).json();
  for (const s of r.query?.search ?? []) say(`${s.title.padEnd(12)} ${s.snippet.replace(/<[^>]+>/g, '')}`);
}
if (args[0] === '--corriger') {
  const [, id, qid] = args;
  const m = await post(`/api/movies/${id}/wiki`, { qid });
  say(`Corrigé : ${m.title} (${m.year ?? '?'}) · affiche ${m.poster ? 'oui' : 'non'} · synopsis ${m.overview ? 'oui' : 'non'}`);
}
if (!['--chercher', '--corriger'].includes(args[0])) await main();

async function main() {

// ---------- 1. Sous-titres livrés en .zip : extraits dans Subtitles\ ----------
if (!args.includes('--bilan')) {
  const { libraryDirs } = await api('/api/settings');
  let extracted = 0;
  for (const dir of libraryDirs.filter((d) => fs.existsSync(d))) {
    const zips = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.zip$/i.test(e.name)) zips.push(p); } };
    walk(dir);
    const target = path.join(dir, 'Subtitles');
    for (const zip of zips) {
      let names;
      try { names = execFileSync(TAR, ['-tf', zip], { encoding: 'utf8' }).split(/\r?\n/).filter((n) => SUB.test(n)); } catch { continue; }
      const todo = names.filter((n) => !fs.existsSync(path.join(target, path.basename(n))));
      if (!todo.length) continue;
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cine-zip-'));
      try {
        execFileSync(TAR, ['-xf', zip, '-C', tmp, ...todo]);
        fs.mkdirSync(target, { recursive: true });
        for (const n of todo) { fs.copyFileSync(path.join(tmp, n), path.join(target, path.basename(n))); extracted++; say(`Sous-titre extrait : ${path.basename(n)}  (de ${path.basename(zip)})`); }
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
  }
  if (!extracted) say('Aucun sous-titre zippé à extraire.');

  // ---------- 2. Scan, puis attente des fiches ----------
  await post('/api/library/scan');
  let last = '';
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await api('/api/library/status');
    const line = s.scanning ? `${s.phase} ${s.done}/${s.total}` : 'terminé';
    if (line !== last) { say(`Scan : ${line}`); last = line; }
    if (!s.scanning) break;
  }
}

// ---------- 3. Bilan ----------
const since = fs.existsSync(STAMP) ? fs.readFileSync(STAMP, 'utf8').trim() : null;
const movies = await api('/api/movies');
// addedAt vient de SQLite (« 2026-11-16 10:42:32 », UTC)
const addedMs = (a) => Date.parse(a.includes('T') ? a : `${a.replace(' ', 'T')}Z`);
const fresh = since ? movies.filter((m) => addedMs(m.addedAt) > Date.parse(since)) : [];
const problems = [];
for (const m of movies) {
  const d = await api(`/api/movies/${m.id}`);
  const issues = [];
  if (m.matchStatus === 'unmatched') issues.push('fiche introuvable');
  else if (m.matchStatus === 'review') issues.push('fiche à vérifier');
  else if (m.matchStatus === 'pending') issues.push('fiche en attente');
  if (!m.poster) issues.push('sans affiche');
  if (!d.overview) issues.push('sans synopsis');
  if (m.year && d.year && Math.abs(m.year - d.year) > 1) issues.push(`année ${d.year} ≠ fichier`);
  if (!m.subtitleLanguages.includes('fr') && d.originalLanguage !== 'fr') issues.push('pas de sous-titres français');
  if (issues.length) problems.push({ m, issues });
}
const orphans = await api('/api/subtitles/orphans');

say();
say(`${movies.length} films dans la bibliothèque${since ? ` · ${fresh.length} nouveau${fresh.length > 1 ? 'x' : ''} depuis le dernier bilan` : ''}`);
for (const m of fresh) say(`  + ${m.title} (${m.year ?? '?'})  #${m.id}`);
say();
if (problems.length) {
  say('À regarder :');
  for (const { m, issues } of problems) say(`  #${String(m.id).padEnd(4)} ${m.title} (${m.year ?? '?'}) : ${issues.join(', ')}`);
} else say('Tout est en ordre : affiches, synopsis et sous-titres français.');
if (orphans.length) {
  say();
  say(`Sous-titres sans film (${orphans.length}) :`);
  for (const o of orphans) say(`  ${o.fileName}`);
}
fs.writeFileSync(STAMP, new Date().toISOString());
}
