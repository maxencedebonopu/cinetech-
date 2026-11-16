// Prépare un lancement depuis le dépôt git : mise à jour, dépendances, configuration, interface.
// Appelé par start.bat. Chaque étape est sautée quand elle n'a rien à faire.
//   node scripts/prepare.mjs [--sans-maj]
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const run = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
const out = (cmd) => { try { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
const step = (msg) => console.log(`  · ${msg}`);
const hash = (...files) => {
  const h = createHash('sha1');
  for (const f of files) if (fs.existsSync(f)) h.update(fs.readFileSync(f));
  return h.digest('hex');
};

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`  Node.js 22 ou plus est nécessaire (installé : ${process.versions.node}).`);
  console.error('  winget install OpenJS.NodeJS.LTS');
  process.exit(1);
}

// 1. Mise à jour depuis git (avance rapide seulement, jamais si des fichiers sont modifiés)
if (!args.has('--sans-maj') && fs.existsSync(path.join(ROOT, '.git'))) {
  const dirty = out('git status --porcelain --untracked-files=no');
  if (dirty) step('Mise à jour sautée : des fichiers suivis sont modifiés localement.');
  else {
    out('git fetch --quiet');
    const upstream = out('git rev-parse @{u}');
    if (!upstream) step('Mise à jour sautée : pas de branche distante suivie (ou hors ligne).');
    else if (out('git merge-base --is-ancestor @{u} HEAD && echo oui') === 'oui') step('Déjà à jour.');
    else {
      try { run('git pull --ff-only --quiet'); step(`Mis à jour : ${out('git log -1 --format=%s')}`); }
      catch { step('Mise à jour impossible en avance rapide, version locale conservée.'); }
    }
  }
}

// 2. Dépendances : réinstallées quand package-lock.json change
const lock = path.join(ROOT, 'package-lock.json');
const lockStamp = path.join(ROOT, 'node_modules', '.cine-lock');
const lockHash = hash(lock);
if (!fs.existsSync(lockStamp) || fs.readFileSync(lockStamp, 'utf8') !== lockHash) {
  step('Installation des dépendances (quelques minutes la première fois)…');
  run('npm ci --no-audit --no-fund --loglevel=error');
  fs.writeFileSync(lockStamp, lockHash);
}

// 3. Configuration : .env créé depuis l'exemple
const env = path.join(ROOT, '.env');
if (!fs.existsSync(env)) {
  fs.copyFileSync(path.join(ROOT, '.env.example'), env);
  step('.env créé depuis .env.example : renseigner LIBRARY_DIRS et TMDB_KEY.');
}

// 4. Interface : reconstruite quand web/ ou shared/ change
const dist = path.join(ROOT, 'web', 'dist');
const buildStamp = path.join(dist, '.cine-build');
const sources = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'scripts') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else sources.push(p);
  }
};
walk(path.join(ROOT, 'web'));
walk(path.join(ROOT, 'shared'));
sources.sort();
const srcHash = hash(...sources, lock);
if (!fs.existsSync(buildStamp) || fs.readFileSync(buildStamp, 'utf8') !== srcHash) {
  step('Construction de l\'interface…');
  run('npm run build --silent');
  fs.writeFileSync(buildStamp, srcHash);
}
step('Prêt.');
