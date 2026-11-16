// Raccourcis Windows : « Cinémathèque » sur le Bureau, et lancement à l'ouverture de session.
// Appelé par raccourcis.bat. Les raccourcis pointent vers start.bat dans ce dossier, fenêtre réduite.
//   node scripts/raccourcis.mjs                 Bureau + démarrage automatique
//   node scripts/raccourcis.mjs --sans-demarrage  Bureau seulement
//   node scripts/raccourcis.mjs --retirer         retire les deux raccourcis
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') { console.error('  Raccourcis : Windows seulement.'); process.exit(1); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const NAME = 'Cinémathèque.lnk';

// PowerShell en commande directe (-Command) : non concerné par la stratégie d'exécution des scripts.
const ps = (script) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const folder = (name) => ps(`[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetFolderPath('${name}')`);

const desktop = path.join(folder('Desktop'), NAME);
const startup = path.join(folder('Startup'), NAME);

function shortcut(file, argsLine, description) {
  ps(`$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${q(file)});
$s.TargetPath = ${q(path.join(ROOT, 'start.bat'))};
$s.Arguments = ${q(argsLine)};
$s.WorkingDirectory = ${q(ROOT)};
$s.IconLocation = ${q(path.join(ROOT, 'scripts', 'cinematheque.ico'))};
$s.WindowStyle = 7;
$s.Description = ${q(description)};
$s.Save()`);
}
const remove = (file, label) => { if (fs.existsSync(file)) { fs.rmSync(file); console.log(`  · Retiré : ${label}`); } };

if (args.has('--retirer')) {
  remove(desktop, 'raccourci du Bureau');
  remove(startup, 'démarrage automatique');
  process.exit(0);
}

shortcut(desktop, '', 'Lance la Cinémathèque et ouvre le navigateur');
console.log(`  · Bureau : ${desktop}`);
if (args.has('--sans-demarrage')) remove(startup, 'démarrage automatique');
else {
  // à l'ouverture de session : serveur seulement, sans ouvrir le navigateur
  shortcut(startup, '--sans-navigateur', 'Démarre le serveur de la Cinémathèque à l\'ouverture de session');
  console.log(`  · Démarrage automatique : ${startup}`);
}
