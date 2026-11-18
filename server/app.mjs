// SignTalk server: the built web app, the messenger API, the WebSocket hub for
// chat and video-call signalling. One process,
// one port, so it runs as a single Render web service.
//
//   node server/app.mjs            (PORT, HOST, DATABASE_URL or DATABASE_PATH from the environment)
//
// Storage: DATABASE_URL (PostgreSQL, e.g. Supabase) when set, otherwise a local SQLite file.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { openDatabase } from './db.mjs';
import { openPostgres } from './db-pg.mjs';
import { Hub } from './realtime.mjs';
import { createApi, sendJson } from './api.mjs';
import { createStaticHandler } from './static.mjs';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
};

export function createApp({
  databasePath = ':memory:',
  databaseUrl,
  databaseSchema,
  staticRoot = fileURLToPath(new URL('../web/dist/', import.meta.url)),
  env = process.env,
  port = 5331,
  now = Date.now,
  ringTimeoutMs,
  authLimit,
} = {}) {
  const store = databaseUrl ? openPostgres(databaseUrl, { schema: databaseSchema }) : openDatabase(databasePath);
  const hub = new Hub({ store, now, ...(ringTimeoutMs ? { ringTimeoutMs } : {}) });
  const trustProxy = env.TRUST_PROXY === '1' || !!env.RENDER;
  const api = createApi({ store, hub, now, env, trustProxy, ...(authLimit ? { authLimit } : {}) });
  const serveStatic = createStaticHandler(staticRoot, SECURITY_HEADERS);

  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path === '/healthz') return sendJson(res, 200, { ok: true });
      if (await api(req, res)) return;
      await serveStatic(req, res);
    } catch (error) {
      console.error('request failed', error);
      if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
      else res.destroy();
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      hub.attach(ws);
    });
  });

  return {
    server,
    store,
    hub,
    /** Resolves once the database is reachable and the schema is in place. */
    ready: Promise.resolve(store.ready),
    close() {
      hub.close();
      wss.close();
      server.closeAllConnections?.();
      return new Promise((done) => {
        server.close(() => {
          Promise.resolve(store.close()).finally(done);
        });
      });
    },
  };
}

/** Starts the server from environment variables: PORT, HOST, DATABASE_URL / DATABASE_PATH. */
export async function startServer() {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const port = Number(process.env.PORT ?? process.argv[2] ?? 5331);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid port');
  const host = process.env.HOST ?? (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
  const databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
  const databasePath =
    process.env.DATABASE_PATH ?? fileURLToPath(new URL('../data/signtalk.db', import.meta.url));
  const app = createApp({ databaseUrl, databasePath, port });
  // Never print the password: only the database host.
  const database = databaseUrl ? `PostgreSQL @ ${new URL(databaseUrl).hostname}` : databasePath;
  try {
    await app.ready;
  } catch (error) {
    console.error(`Cannot open the database (${database}): ${error.message}`);
    process.exit(1);
  }
  app.server.on('error', (e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
  app.server.listen(port, host, () => {
    console.log(
      `SignTalk: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/ — Ctrl+C to stop (database: ${database})`,
    );
  });
  const shutdown = () => {
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return app;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) void startServer();
