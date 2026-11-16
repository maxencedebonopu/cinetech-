// Accès distant : un mot de passe simple, une séance par appareil (cookie d'un an).
// - L'ordinateur serveur lui-même (127.0.0.1, sans proxy) n'a jamais besoin du mot de passe.
// - Tout le reste (réseau local, Tailscale, `tailscale serve`) passe par la page de connexion.
// - Sans mot de passe défini, l'accès distant est refusé : on le définit dans Réglages, sur le serveur.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthState } from '@cine/shared';
import { db } from './db.ts';
import { config } from './config.ts';

const COOKIE = 'cine_seance';
const MAX_AGE = 365 * 24 * 3600;
const MIN_LENGTH = 6;

// ---------- Machine locale ----------

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip', 'tailscale-user-login'];

/** Requête venue de l'ordinateur serveur lui-même. `tailscale serve` relaie depuis 127.0.0.1 :
 *  ses en-têtes de proxy et son nom d'hôte en .ts.net le distinguent d'un vrai accès local. */
export function isLocal(req: FastifyRequest) {
  if (!LOOPBACK.test(req.socket.remoteAddress ?? '')) return false;
  if (PROXY_HEADERS.some((h) => h in req.headers)) return false;
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
  return LOCAL_HOSTS.has(host);
}

// ---------- Mot de passe ----------

const sha = (s: string) => createHash('sha256').update(s).digest();

function storedHash(): string | null {
  const r = db.prepare(`SELECT value FROM settings WHERE key = 'authHash'`).get() as { value: string } | undefined;
  try { return r ? JSON.parse(r.value) : null; } catch { return null; }
}
function source(): AuthState['source'] {
  return storedHash() ? 'reglages' : config.password ? 'env' : null;
}
function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString('hex')}:${scryptSync(pw, salt, 32).toString('hex')}`;
}
function checkPassword(pw: string): boolean {
  const h = storedHash();
  if (h) {
    const [, salt, hex] = h.split(':');
    return timingSafeEqual(scryptSync(pw, Buffer.from(salt, 'hex'), 32), Buffer.from(hex, 'hex'));
  }
  if (config.password) return timingSafeEqual(sha(pw), sha(config.password));
  return false;
}
function setPassword(pw: string | null) {
  if (pw) db.prepare(`INSERT INTO settings(key, value) VALUES ('authHash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(hashPassword(pw)));
  else db.prepare(`DELETE FROM settings WHERE key = 'authHash'`).run();
  db.prepare('DELETE FROM auth_sessions').run(); // un nouveau mot de passe ferme toutes les séances
}

// ---------- Séances ----------

const tokenHash = (t: string) => sha(t).toString('hex');

function readCookie(req: FastifyRequest): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}
function sessionOf(req: FastifyRequest): string | null {
  const t = readCookie(req);
  if (!t) return null;
  const h = tokenHash(t);
  const row = db.prepare('SELECT seen FROM auth_sessions WHERE token_hash = ?').get(h) as { seen: number } | undefined;
  if (!row) return null;
  const now = Date.now();
  if (now - row.seen > 3600_000) db.prepare('UPDATE auth_sessions SET seen = ? WHERE token_hash = ?').run(now, h);
  return h;
}
const secure = (req: FastifyRequest) => req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' || 'tailscale-user-login' in req.headers;
function openSession(req: FastifyRequest, reply: FastifyReply) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO auth_sessions(token_hash, created, seen, agent) VALUES (?, ?, ?, ?)').run(tokenHash(token), now, now, String(req.headers['user-agent'] ?? '').slice(0, 200));
  reply.header('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure(req) ? '; Secure' : ''}`);
}
function clearCookie(reply: FastifyReply) {
  reply.header('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
const sessionCount = () => (db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get() as { n: number }).n;

// ---------- Essais ratés : 5 d'affilée, puis attente qui double (1 min, 2 min, 4 min…) ----------

const attempts = new Map<string, { fails: number; until: number }>();
/** Adresse de l'appareil : celle que donne le proxy local (tailscale serve) ; sinon celle de la connexion,
 *  pour qu'un appareil distant ne puisse pas changer d'identité en inventant l'en-tête. */
const clientKey = (req: FastifyRequest) => {
  const socket = req.socket.remoteAddress ?? '?';
  const fwd = LOOPBACK.test(socket) ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
  return fwd || socket;
};

// ---------- Routes et garde ----------

const PUBLIC_API = new Set(['/api/auth', '/api/auth/connexion', '/api/auth/deconnexion']);
/** Seules les données (API, images, banc d'essai) sont gardées ; l'interface elle-même est publique
 *  pour pouvoir afficher la page de connexion. */
const guarded = (url: string) => url.startsWith('/api/') || url.startsWith('/images/') || url.startsWith('/dev/');

export async function authRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (!guarded(url) || PUBLIC_API.has(url) || isLocal(req) || sessionOf(req)) return;
    return reply.code(401).send({ error: source() ? 'Connexion requise' : "Accès distant fermé : aucun mot de passe n'est défini", auth: true });
  });

  app.get('/api/auth', async (req): Promise<AuthState> => {
    const local = isLocal(req);
    const authenticated = local || sessionOf(req) !== null;
    return {
      local,
      configured: source() !== null,
      authenticated,
      source: authenticated ? source() : null,
      sessions: authenticated ? sessionCount() : null,
      minLength: MIN_LENGTH,
    };
  });

  app.post<{ Body: { motDePasse?: string } }>('/api/auth/connexion', async (req, reply) => {
    const key = clientKey(req);
    const a = attempts.get(key) ?? { fails: 0, until: 0 };
    const wait = Math.ceil((a.until - Date.now()) / 1000);
    if (wait > 0) return reply.code(429).send({ error: `Trop d'essais. Réessayer dans ${wait > 90 ? `${Math.ceil(wait / 60)} min` : `${wait} s`}.`, wait });
    if (!source()) return reply.code(403).send({ error: "Aucun mot de passe n'est défini. Ouvrir Réglages sur l'ordinateur serveur." });
    if (!checkPassword(String(req.body?.motDePasse ?? ''))) {
      a.fails++;
      if (a.fails >= 5) a.until = Date.now() + 60_000 * 2 ** Math.min(a.fails - 5, 6);
      attempts.set(key, a);
      return reply.code(401).send({ error: 'Mot de passe incorrect.' });
    }
    attempts.delete(key);
    openSession(req, reply);
    return { ok: true };
  });

  app.post('/api/auth/deconnexion', async (req, reply) => {
    const h = sessionOf(req);
    if (h) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(h);
    clearCookie(reply);
    return { ok: true };
  });

  // Définir ou changer : depuis le serveur, ou à distance avec le mot de passe actuel
  app.put<{ Body: { nouveau?: string; actuel?: string } }>('/api/auth/mot-de-passe', async (req, reply) => {
    const local = isLocal(req);
    const nouveau = String(req.body?.nouveau ?? '');
    if (!local && !checkPassword(String(req.body?.actuel ?? ''))) return reply.code(403).send({ error: 'Mot de passe actuel incorrect.' });
    if (nouveau.length < MIN_LENGTH) return reply.code(400).send({ error: `Au moins ${MIN_LENGTH} caractères.` });
    setPassword(nouveau);
    if (!local) openSession(req, reply); // l'appareil qui change le mot de passe reste connecté
    return { ok: true };
  });

  // Retirer : seulement depuis le serveur (sinon on fermerait la porte derrière soi)
  app.delete('/api/auth/mot-de-passe', async (req, reply) => {
    if (!isLocal(req)) return reply.code(403).send({ error: "Seulement depuis l'ordinateur serveur." });
    setPassword(null);
    return { ok: true };
  });

  app.post('/api/auth/fermer-seances', async (req, reply) => {
    db.prepare('DELETE FROM auth_sessions').run();
    if (!isLocal(req)) openSession(req, reply);
    return { ok: true, sessions: sessionCount() };
  });
}
