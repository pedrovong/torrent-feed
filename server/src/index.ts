import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { API_TOKEN, HOST, PORT, TOKEN_GENERATED, VERSION, WEB_DIR, DATA_DIR } from './config.js';
import './db.js';
import { startScheduler } from './ingest.js';
import { ApiError, registerRoutes } from './routes.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true });

// ---- auth (bearer token) + rate-limit on failures ---------------------------
const failures = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILURES = 10;
const WINDOW_MS = 60_000;

function tokenMatches(given: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(API_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.register(
  async (api) => {
    api.addHook('onRequest', async (req) => {
      if (req.url.startsWith('/api/health')) return;
      const now = Date.now();
      const f = failures.get(req.ip);
      if (f && f.resetAt > now && f.count >= MAX_FAILURES) throw new ApiError(429, 'rate_limited', 'Too many failed attempts, try again later');

      const header = req.headers.authorization ?? '';
      const given = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (given && tokenMatches(given)) return;

      const cur = f && f.resetAt > now ? f : { count: 0, resetAt: now + WINDOW_MS };
      cur.count++;
      failures.set(req.ip, cur);
      throw new ApiError(401, 'unauthorized', 'Missing or invalid API token');
    });

    api.get('/health', async () => ({ ok: true, version: VERSION }));
    registerRoutes(api);
  },
  { prefix: '/api' },
);

app.setErrorHandler((err: any, _req, reply) => {
  if (err instanceof ApiError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
  if (err instanceof ZodError) {
    const msg = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return reply.code(400).send({ error: { code: 'bad_request', message: msg } });
  }
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: { code: err.code ?? 'bad_request', message: err.message } });
  app.log.error(err);
  return reply.code(500).send({ error: { code: 'internal', message: 'Internal server error' } });
});

// ---- built web app (SPA) ----------------------------------------------------
if (fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
  await app.register(fastifyStatic, { root: WEB_DIR, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
    return reply.sendFile('index.html');
  });
} else {
  app.log.warn(`Web build not found at ${WEB_DIR}; serving API only`);
}

const stopScheduler = startScheduler();
const shutdown = async () => {
  stopScheduler();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: PORT, host: HOST });
app.log.info(`Torrent Feed server v${VERSION} listening on ${HOST}:${PORT}, data in ${DATA_DIR}`);
if (TOKEN_GENERATED) app.log.warn(`No API_TOKEN set. Generated one and saved it to ${path.join(DATA_DIR, 'api-token')}: ${API_TOKEN}`);
