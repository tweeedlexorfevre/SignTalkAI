// REST API for accounts, devices, contacts and messages. Auth: "Authorization: Bearer <token>".
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
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
/** Personal gestures: limits shared with the web app (web/src/ml/prototypes.ts). */
/** Per set. Practically unlimited; the list is sent compressed and without previews. */
export const MAX_GESTURES = 5000;
export const MAX_SETS = 100;
/** Sets every account starts with. */
export const DEFAULT_SETS = ['Казахский жестовый язык', 'Русский жестовый язык'];
/** Preview layout: 21 left-hand + 21 right-hand + 7 upper-body points, (x, y) each. */
export const PREVIEW_VALUES = (21 + 21 + 7) * 2;
const MAX_PREVIEW_FRAMES = 24;
export const MAX_TAKES = 5;
const MAX_GESTURE_NAME = 40;
const MIN_EMBEDDING = 8;
const MAX_EMBEDDING = 1024;
const GESTURE_BODY = 512 * 1024;
const TOUCH_EVERY_MS = 60_000;

function gestureName(value, field = 'name') {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!name || [...name].length > MAX_GESTURE_NAME) throw new HttpError(400, 'invalid_input', { [field]: 'invalid_name' });
  return name;
}

function modelVersionOf(value) {
  if (typeof value !== 'string' || !/^[\w.:-]{1,64}$/.test(value)) throw new HttpError(400, 'invalid_input', { modelVersion: 'invalid' });
  return value;
}

/** One take: a finite number vector of a plausible embedding size, rounded to keep rows small. */
function takeOf(value, dim) {
  if (
    !Array.isArray(value) ||
    value.length < MIN_EMBEDDING ||
    value.length > MAX_EMBEDDING ||
    (dim !== undefined && value.length !== dim) ||
    !value.every((x) => typeof x === 'number' && Number.isFinite(x))
  )
    throw new HttpError(400, 'invalid_input', { take: 'invalid_take' });
  return value.map((x) => Math.round(x * 1e6) / 1e6);
}

/**
 * Skeleton preview of one take: { fps, frames }, each frame PREVIEW_POINTS (x, y) pairs
 * (null where a point was not seen). Optional: a take without a preview stores null.
 */
function previewOf(value) {
  if (value === undefined || value === null) return null;
  const ok =
    typeof value === 'object' &&
    typeof value.fps === 'number' &&
    value.fps > 0 &&
    value.fps <= 120 &&
    Array.isArray(value.frames) &&
    value.frames.length >= 1 &&
    value.frames.length <= MAX_PREVIEW_FRAMES &&
    value.frames.every(
      (f) =>
        Array.isArray(f) &&
        f.length === PREVIEW_VALUES &&
        f.every((x) => x === null || (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 10)),
    );
  if (!ok) throw new HttpError(400, 'invalid_input', { preview: 'invalid_preview' });
  return {
    fps: Math.round(value.fps * 100) / 100,
    frames: value.frames.map((f) => f.map((x) => (x === null ? null : Math.round(x * 1000) / 1000))),
  };
}

function takesOf(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_TAKES) throw new HttpError(400, 'invalid_input', { takes: 'invalid_takes' });
  const dim = Array.isArray(value[0]) ? value[0].length : undefined;
  return value.map((take) => takeOf(take, dim));
}

function previewsOf(value, count) {
  const list = Array.isArray(value) ? value.slice(0, count) : [];
  return Array.from({ length: count }, (_, i) => previewOf(list[i]));
}

const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/**
 * API shape of a gesture row. The list form (used to load every gesture and in
 * live updates) leaves the skeleton previews out and gives each take's duration
 * instead; `full` adds the previews, for the gesture being looked at.
 */
function gestureJson(row, { full = true } = {}) {
  const takes = parseJson(row.takes) ?? [];
  const previews = parseJson(row.previews) ?? [];
  const aligned = takes.map((_, i) => previews[i] ?? null);
  return {
    id: row.id,
    setId: row.set_id ?? null,
    name: row.name,
    modelVersion: row.model_version,
    takes: full ? takes : takes.map((t) => t.map((x) => Math.round(x * 1e4) / 1e4)),
    durations: aligned.map((p) => (p && p.fps > 0 ? Math.round((p.frames.length / p.fps) * 1000) : null)),
    ...(full ? { previews: aligned } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const listJson = (row) => gestureJson(row, { full: false });

function setJson(row) {
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

const sameName = (a, b) => a.toLocaleLowerCase('ru') === b.toLocaleLowerCase('ru');

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  // Large answers (a big gesture library) are compressed when the client allows it.
  const accepts = String(res.req?.headers['accept-encoding'] ?? '');
  if (body.length > 4096 && /\bgzip\b/.test(accepts)) {
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    res.end(gzipSync(body));
    return;
  }
  res.writeHead(status, headers);
  res.end(body);
}

async function readJson(req, limit = MAX_BODY) {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim();
  if (type !== 'application/json') throw new HttpError(415, 'json_required');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'body_too_large');
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

  /** The user's sets; the default ones are created on first use, and older gestures moved in. */
  async function ensureSets(userId) {
    let sets = await store.setsOf(userId);
    if (!sets.length) {
      const t = now();
      for (const [i, name] of DEFAULT_SETS.entries()) {
        try {
          await store.insertSet({ id: randomUUID(), ownerId: userId, name, now: t + i });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error; // a parallel request created it
        }
      }
      sets = await store.setsOf(userId);
    }
    await store.adoptOrphans(userId, sets[0].id);
    return sets;
  }

  /** Every device of this user reloads its gesture library. */
  const changed = (user, update = {}) => hub.sendToUser(user.id, { type: 'gestures:changed', ...update });

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

    // --- gesture sets and personal gestures (stored per account, used on every device) ---
    [
      'GET',
      /^\/api\/gesture-sets$/,
      async (req) => {
        const { user } = await authenticate(req);
        return { sets: (await ensureSets(user.id)).map(setJson) };
      },
    ],
    [
      'POST',
      /^\/api\/gesture-sets$/,
      async (req) => {
        const { user } = await authenticate(req);
        const name = gestureName((await readJson(req)).name);
        const sets = await ensureSets(user.id);
        if (sets.length >= MAX_SETS) throw new HttpError(409, 'too_many_sets');
        if (sets.some((x) => sameName(x.name, name))) throw new HttpError(409, 'set_exists', { name: 'taken' });
        const row = await store.insertSet({ id: randomUUID(), ownerId: user.id, name, now: now() });
        changed(user, { set: setJson(row) });
        return [201, { set: setJson(row) }];
      },
    ],
    [
      'PATCH',
      /^\/api\/gesture-sets\/([0-9a-f-]{36})$/,
      async (req, [, id]) => {
        const { user } = await authenticate(req);
        const name = gestureName((await readJson(req)).name);
        const sets = await store.setsOf(user.id);
        if (!sets.some((x) => x.id === id)) throw new HttpError(404, 'set_not_found');
        if (sets.some((x) => x.id !== id && sameName(x.name, name))) throw new HttpError(409, 'set_exists', { name: 'taken' });
        const row = await store.renameSet(user.id, id, name, now());
        changed(user, { set: setJson(row) });
        return { set: setJson(row) };
      },
    ],
    [
      'DELETE',
      /^\/api\/gesture-sets\/([0-9a-f-]{36})$/,
      async (req, [, id]) => {
        const { user } = await authenticate(req);
        const sets = await store.setsOf(user.id);
        if (!sets.some((x) => x.id === id)) throw new HttpError(404, 'set_not_found');
        if (sets.length <= 1) throw new HttpError(409, 'last_set');
        await store.transaction(async (tx) => {
          await tx.clearGestures(user.id, id);
          await tx.deleteSet(user.id, id);
        });
        changed(user, { removedSet: id });
        return { ok: true };
      },
    ],

    [
      'GET',
      /^\/api\/gestures$/,
      async (req) => {
        const { user } = await authenticate(req);
        const sets = await ensureSets(user.id);
        return {
          sets: sets.map(setJson),
          gestures: (await store.gesturesOf(user.id)).map(listJson),
        };
      },
    ],
    [
      'POST',
      /^\/api\/gestures$/,
      async (req) => {
        const { user } = await authenticate(req);
        const body = await readJson(req, GESTURE_BODY);
        const name = gestureName(body.name);
        const modelVersion = modelVersionOf(body.modelVersion);
        const takes = takesOf(body.takes);
        const previews = previewsOf(body.previews, takes.length);
        const sets = await ensureSets(user.id);
        const setId = body.setId === undefined ? sets[0].id : String(body.setId);
        if (!sets.some((x) => x.id === setId)) throw new HttpError(404, 'set_not_found');
        const inSet = (await store.gestureNames(user.id)).filter((g) => g.set_id === setId);
        if (inSet.length >= MAX_GESTURES) throw new HttpError(409, 'too_many_gestures');
        if (inSet.some((g) => sameName(g.name, name))) throw new HttpError(409, 'gesture_exists', { name: 'taken' });
        let row;
        try {
          row = await store.insertGesture({ id: randomUUID(), ownerId: user.id, setId, name, modelVersion, takes, previews, now: now() });
        } catch (error) {
          if (isUniqueViolation(error)) throw new HttpError(409, 'gesture_exists', { name: 'taken' });
          throw error;
        }
        changed(user, { gesture: listJson(row) });
        return [201, { gesture: gestureJson(row) }];
      },
    ],
    [
      'GET',
      /^\/api\/gestures\/([0-9a-f-]{36})$/,
      async (req, [, id]) => {
        const { user } = await authenticate(req);
        const row = await store.gestureById(user.id, id);
        if (!row) throw new HttpError(404, 'gesture_not_found');
        return { gesture: gestureJson(row) };
      },
    ],
    [
      'PATCH',
      /^\/api\/gestures\/([0-9a-f-]{36})$/,
      async (req, [, id]) => {
        const { user } = await authenticate(req);
        const gesture = await store.gestureById(user.id, id);
        if (!gesture) throw new HttpError(404, 'gesture_not_found');
        const current = gestureJson(gesture);
        const body = await readJson(req);
        const name = body.name === undefined ? current.name : gestureName(body.name);
        let setId = current.setId;
        if (body.setId !== undefined) {
          setId = String(body.setId);
          if (!(await store.setById(user.id, setId))) throw new HttpError(404, 'set_not_found');
        }
        const others = (await store.gestureNames(user.id)).filter((g) => g.id !== id && g.set_id === setId);
        if (others.some((g) => sameName(g.name, name))) throw new HttpError(409, 'gesture_exists', { name: 'taken' });
        let row;
        try {
          row = await store.updateGesture(user.id, id, { ...current, setId, name, now: now() });
        } catch (error) {
          if (isUniqueViolation(error)) throw new HttpError(409, 'gesture_exists', { name: 'taken' });
          throw error;
        }
        changed(user, { gesture: listJson(row) });
        return { gesture: gestureJson(row) };
      },
    ],
    [
      'POST',
      /^\/api\/gestures\/([0-9a-f-]{36})\/takes$/,
      async (req, [, id]) => {
        const { user } = await authenticate(req);
        const body = await readJson(req, GESTURE_BODY);
        const modelVersion = modelVersionOf(body.modelVersion);
        const preview = previewOf(body.preview);
        const row = await store.transaction(async (tx) => {
          const gesture = await tx.gestureById(user.id, id);
          if (!gesture) throw new HttpError(404, 'gesture_not_found');
          const current = gestureJson(gesture);
          // Takes from another model version cannot be compared: a new take starts over.
          const same = current.modelVersion === modelVersion;
          const kept = same ? current.takes : [];
          const keptPreviews = same ? current.previews : [];
          if (kept.length >= MAX_TAKES) throw new HttpError(409, 'too_many_takes');
          const take = takeOf(body.take, kept[0]?.length);
          return tx.updateGesture(user.id, id, {
            ...current,
            modelVersion,
            takes: [...kept, take],
            previews: [...keptPreviews, preview],
            now: now(),
          });
        });
        changed(user, { gesture: listJson(row) });
        return [201, { gesture: gestureJson(row) }];
      },
    ],
    [
      'DELETE',
      /^\/api\/gestures\/([0-9a-f-]{36})\/takes(?:\/(\d+))?$/,
      async (req, [, id, index]) => {
        const { user } = await authenticate(req);
        const row = await store.transaction(async (tx) => {
          const gesture = await tx.gestureById(user.id, id);
          if (!gesture) throw new HttpError(404, 'gesture_not_found');
          const current = gestureJson(gesture);
          let takes = [];
          let previews = [];
          if (index !== undefined) {
            const i = Number(index);
            if (i >= current.takes.length) throw new HttpError(404, 'take_not_found');
            takes = current.takes.filter((_, k) => k !== i);
            previews = current.previews.filter((_, k) => k !== i);
          }
          return tx.updateGesture(user.id, id, { ...current, takes, previews, now: now() });
        });
        changed(user, { gesture: listJson(row) });
        return { gesture: gestureJson(row) };
      },
    ],
    [
      'DELETE',
      /^\/api\/gestures\/([0-9a-f-]{36})$/,
      async (req, [, id]) => {
        const { user } = await authenticate(req);
        if (!(await store.deleteGesture(user.id, id))) throw new HttpError(404, 'gesture_not_found');
        changed(user, { removed: id });
        return { ok: true };
      },
    ],
    [
      'DELETE',
      /^\/api\/gestures$/,
      async (req, _m, url) => {
        const { user } = await authenticate(req);
        const setId = url.searchParams.get('setId') || undefined;
        const removed = await store.clearGestures(user.id, setId);
        changed(user, { cleared: setId ?? null });
        return { ok: true, removed };
      },
    ],
  ];

  return async function api(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
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
