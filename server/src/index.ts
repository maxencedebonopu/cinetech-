import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config, paths } from './config.ts';
import { apiRoutes } from './api/routes.ts';
import { scan, watch, stopWatching } from './library/library.ts';
import { ffmpegPath } from './tools/ffmpeg.ts';
import { db } from './db.ts';

const app = Fastify({ logger: { level: 'warn' } });

// Images mises en cache (immuables : le nom change si l'image change)
await app.register(fastifyStatic, {
  root: paths.images,
  prefix: '/images/',
  decorateReply: false,
  immutable: true,
  maxAge: '365d',
});

await app.register(apiRoutes);

// Interface buildée (phase 3+) ; repli SPA vers index.html
if (fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist, prefix: '/', wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/images/')) return reply.code(404).send({ error: 'Introuvable' });
    return reply.sendFile('index.html');
  });
} else {
  app.get('/', async () => ({ name: 'Cinémathèque', status: "API prête — l'interface arrive en phase 3", api: '/api/movies' }));
}

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`\n  Cinémathèque — http://localhost:${config.port}\n`);
if (!ffmpegPath) console.warn('  ⚠ ffmpeg introuvable : installez-le (voir README).');

watch();
void scan();

async function shutdown() {
  await stopWatching();
  await app.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
