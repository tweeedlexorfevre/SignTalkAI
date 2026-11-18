// REST API for accounts, devices, contacts and messages. Auth: "Authorization: Bearer <token>".
import { publicUser } from './db.mjs';
import {
  burnPasswordCheck,
  cleanName,
  deviceName,
  hashPassword,
  newPublicId,
  newToken,
  normalizePublicId,
  tokenHash,
  validateRegistration,
  verifyPassword,
} from './auth.mjs';

export class HttpError extends Error {
  constructor(status, code, details) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const MESSAGE_KINDS = new Set(['text', 'sign', 'speech']);
const MAX_BODY = 16 * 1024;
const TOUCH_EVERY_MS = 60_000;

export function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim();
  if (type !== 'application/json') throw new HttpError(415, 'json_required');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'body_too_large');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

/** Fixed-window limiter for login and sign-up attempts, per client address. */
class Limiter {
  constructor(limit, windowMs, now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map();
  }
  take(key) {
    const now = this.now();
    if (this.hits.size > 10_000)
      for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
    const entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }
}

export function clientAddress(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function iceServers(env) {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const urls = String(env.TURN_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length) servers.push({ urls, username: env.TURN_USERNAME ?? '', credential: env.TURN_CREDENTIAL ?? '' });
  return servers;
}

export function createApi({ store, hub, now = Date.now, env = process.env, trustProxy = false, authLimit = 30 }) {
  const limiter = new Limiter(authLimit, 10 * 60_000, now);

  async function authenticate(req) {
    const header = String(req.headers.authorization ?? '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const found = token ? await store.sessionWithUser(tokenHash(token)) : null;
    if (!found) throw new HttpError(401, 'unauthorized');
    const { session, user } = found;
    const t = now();
    // "Last seen" is informational: don't make the request wait for it.
    if (t - session.last_seen_at > TOUCH_EVERY_MS)
      Promise.resolve(store.touchSession(session.id, t)).catch((e) => console.error('touch failed', e.message));
    return { user, session };
  }

  async function findUser(query) {
    const text = String(query ?? '').trim();
    if (!text) return null;
    const publicId = normalizePublicId(text);
    return (
      (publicId && (await store.userByPublicId(publicId))) ||
      (await store.userByUsername(text.replace(/^@/, ''))) ||
      null
    );
  }

  async function peerFor(me, publicId) {
    const peer = await store.userByPublicId(String(publicId));
    if (!peer || peer.id === me.id) throw new HttpError(404, 'user_not_found');
    return peer;
  }

  async function contactJson(me, entry) {
    return {
      user: publicUser(entry.row),
      online: hub.isOnline(entry.row.id),
      addedAt: entry.addedAt,
      lastMessage: entry.last ? await store.messageJson(entry.last) : null,
      unread: entry.unread,
    };
  }

  async function startSession(req, user) {
    const token = newToken();
    const sessionId = await store.createSession({
      userId: user.id,
      tokenHash: tokenHash(token),
      deviceName: deviceName(req.headers['user-agent']),
      now: now(),
    });
    return { token, sessionId, user: publicUser(user) };
  }

  const isUniqueViolation = (error) => error?.code === '23505' || String(error?.message).includes('UNIQUE');

  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true })],
    [
      'GET',
      /^\/api\/ice$/,
      async (req) => {
        await authenticate(req);
        return { iceServers: iceServers(env) };
      },
    ],

    [
      'POST',
      /^\/api\/auth\/register$/,
      async (req) => {
        if (!limiter.take(clientAddress(req, trustProxy))) throw new HttpError(429, 'too_many_attempts');
        const { username, displayName, password, errors } = validateRegistration(await readJson(req));
        if (Object.keys(errors).length) throw new HttpError(400, 'invalid_input', errors);
        if (await store.userByUsername(username))
          throw new HttpError(409, 'username_taken', { username: 'username_taken' });
        const passwordHash = await hashPassword(password);
        let user = null;
        for (let attempt = 0; attempt < 20 && !user; attempt++) {
          const publicId = newPublicId();
          if (await store.publicIdTaken(publicId)) continue;
          try {
            user = await store.createUser({ publicId, username, displayName, passwordHash, now: now() });
          } catch (error) {
            // A concurrent sign-up may have taken the same name in the meantime.
            if (await store.userByUsername(username))
              throw new HttpError(409, 'username_taken', { username: 'username_taken' });
            if (!isUniqueViolation(error)) throw error;
          }
        }
        if (!user) throw new HttpError(503, 'try_again');
        return [201, await startSession(req, user)];
      },
    ],
    [
      'POST',
      /^\/api\/auth\/login$/,
      async (req) => {
        if (!limiter.take(clientAddress(req, trustProxy))) throw new HttpError(429, 'too_many_attempts');
        const body = await readJson(req);
        const login = typeof body.login === 'string' ? body.login.trim().replace(/^@/, '') : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (!login || !password || password.length > 128) throw new HttpError(400, 'invalid_input');
        const row = await store.credentials(login, normalizePublicId(login));
        if (!row) {
          await burnPasswordCheck(password);
          throw new HttpError(401, 'wrong_credentials');
        }
        if (!(await verifyPassword(password, row.password_hash))) throw new HttpError(401, 'wrong_credentials');
        return await startSession(req, row);
      },
    ],
    [
      'POST',
      /^\/api\/auth\/logout$/,
      async (req) => {
        const { user, session } = await authenticate(req);
        await store.revokeSession(user.id, session.id, now());
        hub.dropSession(session.id);
        return { ok: true };
      },
    ],

    [
      'GET',
      /^\/api\/me$/,
      async (req) => {
        const { user, session } = await authenticate(req);
        return { user: publicUser(user), sessionId: session.id };
      },
    ],
    [
      'PATCH',
      /^\/api\/me$/,
      async (req) => {
        const { user } = await authenticate(req);
        const displayName = cleanName((await readJson(req)).displayName);
        if (!displayName) throw new HttpError(400, 'invalid_input', { displayName: 'invalid_display_name' });
        return { user: publicUser(await store.rename(user.id, displayName)) };
      },
    ],

    [
      'GET',
      /^\/api\/devices$/,
      async (req) => {
        const { user, session } = await authenticate(req);
        return {
          devices: (await store.sessionsOf(user.id)).map((s) => ({
            id: s.id,
            name: s.device_name,
            createdAt: s.created_at,
            lastSeenAt: s.last_seen_at,
            current: s.id === session.id,
            online: hub.sessionOnline(s.id),
          })),
        };
      },
    ],
    [
      'DELETE',
      /^\/api\/devices\/(\d+)$/,
      async (req, [, id]) => {
        const { user } = await authenticate(req);
        if (!(await store.revokeSession(user.id, Number(id), now()))) throw new HttpError(404, 'device_not_found');
        hub.dropSession(Number(id));
        return { ok: true };
      },
    ],

    [
      'GET',
      /^\/api\/users\/lookup$/,
      async (req, _m, url) => {
        const { user } = await authenticate(req);
        const found = await findUser(url.searchParams.get('q'));
        if (!found) throw new HttpError(404, 'user_not_found');
        return {
          user: publicUser(found),
          self: found.id === user.id,
          contact: await store.isContact(user.id, found.id),
        };
      },
    ],

    [
      'GET',
      /^\/api\/contacts$/,
      async (req) => {
        const { user } = await authenticate(req);
        const entries = await store.contactsOf(user.id);
        const contacts = await Promise.all(entries.map((entry) => contactJson(user, entry)));
        contacts.sort(
          (a, b) => (b.lastMessage?.createdAt ?? b.addedAt) - (a.lastMessage?.createdAt ?? a.addedAt),
        );
        return { contacts };
      },
    ],
    [
      'POST',
      /^\/api\/contacts$/,
      async (req) => {
        const { user } = await authenticate(req);
        const found = await findUser((await readJson(req)).id);
        if (!found) throw new HttpError(404, 'user_not_found');
        if (found.id === user.id) throw new HttpError(400, 'cannot_add_self');
        await store.addContact(user.id, found.id, now());
        // The other person now sees this user's presence; tell both sides.
        hub.sendToUser(found.id, { type: 'presence', user: user.public_id, online: hub.isOnline(user.id) });
        const entry = (await store.contactsOf(user.id)).find((e) => e.row.id === found.id);
        const contact = await contactJson(user, entry);
        hub.sendToUser(user.id, { type: 'contact:added', contact });
        return [201, { contact }];
      },
    ],
    [
      'DELETE',
      /^\/api\/contacts\/([A-Z0-9-]{9})$/,
      async (req, [, publicId]) => {
        const { user } = await authenticate(req);
        const peer = await peerFor(user, publicId);
        await store.removeContact(user.id, peer.id);
        hub.sendToUser(user.id, { type: 'contact:removed', user: peer.public_id });
        return { ok: true };
      },
    ],

    [
      'GET',
      /^\/api\/chats\/([A-Z0-9-]{9})\/messages$/,
      async (req, [, publicId], url) => {
        const { user } = await authenticate(req);
        const peer = await peerFor(user, publicId);
        const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
        const rows = await store.history(
          user.id,
          peer.id,
          Number.isSafeInteger(before) ? before : Number.MAX_SAFE_INTEGER,
          limit,
        );
        return {
          messages: await Promise.all(rows.map((r) => store.messageJson(r))),
          hasMore: rows.length === limit,
        };
      },
    ],
    [
      'POST',
      /^\/api\/chats\/([A-Z0-9-]{9})\/messages$/,
      async (req, [, publicId]) => {
        const { user } = await authenticate(req);
        const peer = await peerFor(user, publicId);
        const body = await readJson(req);
        const kind = MESSAGE_KINDS.has(body.kind) ? body.kind : 'text';
        const text = typeof body.body === 'string' ? body.body.replace(/\r\n/g, '\n').trim() : '';
        if (!text || text.length > 2000) throw new HttpError(400, 'invalid_message');
        const t = now();
        const row = await store.transaction(async (tx) => {
          // Writing to someone puts each of you in the other's chat list.
          await tx.addContact(user.id, peer.id, t);
          await tx.addContact(peer.id, user.id, t);
          return tx.insertMessage({ senderId: user.id, recipientId: peer.id, kind, body: text, now: t });
        });
        const message = await store.messageJson(row);
        hub.sendToUser(peer.id, { type: 'message:new', message });
        hub.sendToUser(user.id, { type: 'message:new', message });
        return [201, { message }];
      },
    ],
    [
      'POST',
      /^\/api\/chats\/([A-Z0-9-]{9})\/read$/,
      async (req, [, publicId]) => {
        const { user } = await authenticate(req);
        const peer = await peerFor(user, publicId);
        const upTo = Number((await readJson(req)).upTo);
        if (!Number.isSafeInteger(upTo) || upTo < 1) throw new HttpError(400, 'invalid_input');
        const readAt = now();
        const changed = await store.markRead(user.id, peer.id, upTo, readAt);
        if (changed) {
          const event = { type: 'read', reader: user.public_id, peer: peer.public_id, upTo, readAt };
          hub.sendToUser(peer.id, event);
          hub.sendToUser(user.id, event);
        }
        return { ok: true, changed };
      },
    ],
  ];

  return async function api(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/cloud/')) return false;
    try {
      let pathMatched = false;
      for (const [method, pattern, handler] of routes) {
        const match = pattern.exec(url.pathname);
        if (!match) continue;
        pathMatched = true;
        if (method !== req.method) continue;
        const result = await handler(req, match, url);
        const [status, data] = Array.isArray(result) ? result : [200, result];
        sendJson(res, status, data);
        return true;
      }
      throw pathMatched ? new HttpError(405, 'method_not_allowed') : new HttpError(404, 'not_found');
    } catch (error) {
      if (error instanceof HttpError) sendJson(res, error.status, { error: error.code, details: error.details });
      else {
        console.error('api error', error);
        sendJson(res, 500, { error: 'server_error' });
      }
    }
    return true;
  };
}
