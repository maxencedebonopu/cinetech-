import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config, paths, ROOT } from './config.ts';
import { apiRoutes } from './api/routes.ts';
import { authRoutes } from './auth.ts';
import { playbackRoutes } from './api/playback.ts';
import { scan, watch, stopWatching } from './library/library.ts';
import { wipeTranscodeDir, stopAll } from './playback/sessions.ts';
import { generateMissingTrickplay } from './playback/trickplay.ts';
import { generateMissingStills } from './library/stills.ts';
import { ffmpegPath, detectHwEncoders, detectOpenclTonemap, killOrphanFfmpeg } from './tools/ffmpeg.ts';
import { db } from './db.ts';

const app = Fastify({ logger: { level: 'warn' } });

// Mot de passe de l'accès distant : posé directement sur l'instance racine (pas de register),
// avant tout le reste, pour que sa garde couvre toutes les routes.
await authRoutes(app);

// Images mises en cache (immuables : le nom change si l'image change)
await app.register(fastifyStatic, {
  root: paths.images,
  prefix: '/images/',
  decorateReply: false,
  immutable: true,
  maxAge: '365d',
});

await app.register(apiRoutes);
await app.register(playbackRoutes);

// Banc d'essai de lecture (développement)
const devDir = path.join(ROOT, 'server', 'dev');
app.get('/dev/player', async (_req, reply) => reply.type('text/html').send(fs.readFileSync(path.join(devDir, 'player.html'))));
app.get('/dev/hls.js', async (_req, reply) => reply.type('text/javascript').send(fs.readFileSync(path.join(ROOT, 'node_modules', 'hls.js', 'dist', 'hls.min.js'))));

// Interface buildée (phase 3+) ; repli SPA vers index.html
if (fs.existsSync(config.webDist)) {
  // wildcard : les fichiers d'un nouveau build sont servis sans redémarrer le serveur
  await app.register(fastifyStatic, {
    root: config.webDist, prefix: '/', wildcard: true, cacheControl: false,
    // fichiers à empreinte : gardés un an ; index.html, sw.js, manifeste : toujours revalidés
    setHeaders: (res, file) => {
      if (/[\\/]assets[\\/]/.test(file)) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      else res.setHeader('cache-control', 'no-cache');
      if (file.endsWith('sw.js')) res.setHeader('service-worker-allowed', '/');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/images/')) return reply.code(404).send({ error: 'Introuvable' });
    return reply.sendFile('index.html');
  });
} else {
  app.get('/', async () => ({ name: 'Cinémathèque', status: "API prête — l'interface arrive en phase 3", api: '/api/movies' }));
}

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`\n  Cinémathèque — http://localhost:${config.port}\n`);
// Lancé par start.bat (raccourci du Bureau) : ouvre le navigateur une fois le serveur prêt
if (process.env.CINE_OUVRIR === '1' && process.platform === 'win32') {
  exec(`start "" "http://localhost:${config.port}"`);
}
if (!ffmpegPath) console.warn('  ⚠ ffmpeg introuvable : installez-le (voir README).');

const orphans = killOrphanFfmpeg();
if (orphans) console.log(`  ${orphans} process ffmpeg orphelin(s) arrêté(s)`);
wipeTranscodeDir();
// Détection des encodeurs dès le démarrage : la première séance n'attend pas
void detectHwEncoders().then((hw) => console.log(`  Encodage matériel : ${hw.join(', ') || 'aucun (libx264)'}`));
void detectOpenclTonemap().then((ok) => console.log(`  Conversion HDR → SDR : ${ok ? 'GPU (OpenCL)' : 'CPU'}`));
watch();
const log = (m: string) => console.log('  ' + m);
void scan().then(() => generateMissingStills(log)).then(() => generateMissingTrickplay(log));

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  stopAll();
  await stopWatching();
  await app.close();
  db.close();
  await new Promise((r) => setTimeout(r, 400)); // laisse Windows libérer les fichiers des process ffmpeg
  try { wipeTranscodeDir(); } catch { /* nettoyé au prochain démarrage */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
