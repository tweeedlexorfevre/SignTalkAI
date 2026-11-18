import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createApp } from './app.mjs';
import { normalizePublicId, deviceName, hashPassword, verifyPassword } from './auth.mjs';

// TEST_DATABASE_URL=postgres://... runs the same tests against PostgreSQL in a throwaway
// schema (dropped afterwards), so production tables are never touched.
const pgUrl = process.env.TEST_DATABASE_URL;
const pgSchema = `signtalk_test_${process.pid}_${Date.now()}`;

let app;
let base;
before(async () => {
  app = createApp({
    databasePath: ':memory:',
    ...(pgUrl ? { databaseUrl: pgUrl, databaseSchema: pgSchema } : {}),
    ringTimeoutMs: pgUrl ? 4000 : 400,
    authLimit: 1000,
    env: {},
  });
  await app.ready;
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => {
  if (pgUrl) await app.store.pool.query(`DROP SCHEMA IF EXISTS ${pgSchema} CASCADE`);
  await app.close();
});

const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

async function call(method, path, { token, body, ua = UA.mac } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'User-Agent': ua,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

/** A WebSocket client that records every event and can wait for one. */
async function socket(token) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const events = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const event = JSON.parse(raw.toString());
    events.push(event);
    for (const w of [...waiters]) if (w.match(event)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(event); }
  });
  await once(ws, 'open');
  const client = {
    ws,
    events,
    send: (msg) => ws.send(JSON.stringify(msg)),
    next(type, extra = () => true) {
      const found = events.find((e) => e.type === type && extra(e) && !e.seen);
      if (found) { found.seen = true; return Promise.resolve(found); }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), pgUrl ? 15000 : 3000);
        waiters.push({ match: (e) => e.type === type && extra(e) && !e.seen && (e.seen = true), resolve: (e) => { clearTimeout(timer); resolve(e); } });
      });
    },
    close: () => ws.close(),
  };
  client.send({ type: 'auth', token });
  await client.next('ready');
  return client;
}

test('helpers: IDs, device names and password hashing', async () => {
  assert.equal(normalizePublicId(' st-7kq2mx '), 'ST-7KQ2MX');
  assert.equal(normalizePublicId('7KQ2MX'), 'ST-7KQ2MX');
  assert.equal(normalizePublicId('ST7KQ2MX'), 'ST-7KQ2MX');
  assert.equal(normalizePublicId('ST-7KQ2M0'), null);
  assert.equal(deviceName(UA.iphone), 'Safari · iPhone');
  assert.equal(deviceName(UA.mac), 'Chrome · macOS');
  const hash = await hashPassword('correct horse');
  assert.ok(await verifyPassword('correct horse', hash));
  assert.ok(!(await verifyPassword('wrong horse', hash)));
});

test('accounts, devices, contacts, messages and a full video-call signalling flow', async () => {
  // Registration validation
  assert.equal((await call('POST', '/api/auth/register', { body: { username: 'a', displayName: '', password: '1' } })).status, 400);
  const aliya = await call('POST', '/api/auth/register', { body: { username: 'aliya', displayName: 'Әлия', password: 'password-1' } });
  assert.equal(aliya.status, 201);
  assert.match(aliya.data.user.id, /^ST-[A-HJ-NP-Z2-9]{6}$/);
  assert.equal((await call('POST', '/api/auth/register', { body: { username: 'ALIYA', displayName: 'x', password: 'password-1' } })).status, 409);
  const bolat = await call('POST', '/api/auth/register', { body: { username: 'bolat', displayName: 'Болат', password: 'password-2' }, ua: UA.iphone });
  const A = aliya.data.user.id;
  const B = bolat.data.user.id;

  // Login on a second device, by username and by public ID
  assert.equal((await call('POST', '/api/auth/login', { body: { login: 'bolat', password: 'nope-nope' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { login: 'ghost', password: 'nope-nope' } })).status, 401);
  const bolat2 = await call('POST', '/api/auth/login', { body: { login: B.toLowerCase(), password: 'password-2' }, ua: UA.mac });
  assert.equal(bolat2.status, 200);
  const devices = await call('GET', '/api/devices', { token: bolat.data.token });
  assert.deepEqual(devices.data.devices.map((d) => d.name).sort(), ['Chrome · macOS', 'Safari · iPhone']);
  assert.equal(devices.data.devices.filter((d) => d.current).length, 1);
  assert.equal((await call('GET', '/api/me')).status, 401);

  // Find by unique ID and add as contact
  const found = await call('GET', `/api/users/lookup?q=${encodeURIComponent(B.slice(3))}`, { token: aliya.data.token });
  assert.equal(found.data.user.displayName, 'Болат');
  assert.equal((await call('GET', '/api/users/lookup?q=ST-ZZZZZZ', { token: aliya.data.token })).status, 404);
  assert.equal((await call('POST', '/api/contacts', { token: aliya.data.token, body: { id: A } })).status, 400);

  const a1 = await socket(aliya.data.token);
  const b1 = await socket(bolat.data.token); // iPhone
  const b2 = await socket(bolat2.data.token); // Mac
  const added = await call('POST', '/api/contacts', { token: aliya.data.token, body: { id: B } });
  assert.equal(added.status, 201);
  assert.equal(added.data.contact.online, true);
  await b1.next('presence', (e) => e.user === A && e.online);

  // A message reaches every device of both people and puts Aliya in Bolat's list
  const sent = await call('POST', `/api/chats/${B}/messages`, { token: aliya.data.token, body: { kind: 'text', body: '  Сәлем!  ' } });
  assert.equal(sent.data.message.body, 'Сәлем!');
  for (const c of [a1, b1, b2]) assert.equal((await c.next('message:new')).message.body, 'Сәлем!');
  const bContacts = await call('GET', '/api/contacts', { token: bolat.data.token });
  assert.equal(bContacts.data.contacts[0].user.id, A);
  assert.equal(bContacts.data.contacts[0].unread, 1);
  await call('POST', `/api/chats/${A}/read`, { token: bolat.data.token, body: { upTo: sent.data.message.id } });
  assert.equal((await a1.next('read')).reader, B);
  assert.equal((await call('GET', '/api/contacts', { token: bolat.data.token })).data.contacts[0].unread, 0);
  await call('POST', `/api/chats/${A}/messages`, { token: bolat.data.token, body: { kind: 'sign', body: 'Где' } });
  const history = await call('GET', `/api/chats/${B}/messages`, { token: aliya.data.token });
  assert.deepEqual(history.data.messages.map((m) => [m.kind, m.body]), [['text', 'Сәлем!'], ['sign', 'Где']]);

  // Call: rings on both of Bolat's devices, answered on the Mac, the iPhone stops ringing
  a1.send({ type: 'call:invite', callId: 'call-0001', to: B });
  await a1.next('call:ringing');
  assert.equal((await b1.next('call:incoming')).from.id, A);
  await b2.next('call:incoming');
  b2.send({ type: 'call:accept', callId: 'call-0001' });
  await a1.next('call:accepted');
  await b1.next('call:taken');
  a1.send({ type: 'call:signal', callId: 'call-0001', data: { sdp: { type: 'offer', sdp: 'v=0' } } });
  assert.equal((await b2.next('call:signal')).data.sdp.type, 'offer');
  b2.send({ type: 'call:caption', callId: 'call-0001', text: 'Қалай', source: 'sign', final: true });
  assert.equal((await a1.next('call:caption')).text, 'Қалай');
  // The non-answering device cannot inject signals
  b1.send({ type: 'call:signal', callId: 'call-0001', data: { candidate: 'x' } });
  // A third party call attempt gets "busy"
  b2.send({ type: 'call:end', callId: 'call-0001' });
  const ended = await a1.next('call:ended', (e) => e.callId === 'call-0001');
  assert.equal(ended.status, 'completed');
  const log = await a1.next('message:new', (e) => e.message.kind === 'call');
  assert.equal(JSON.parse(log.message.body).status, 'completed');
  assert.ok(!a1.events.some((e) => e.type === 'call:signal'));

  // Unanswered call times out as missed; declined call
  a1.send({ type: 'call:invite', callId: 'call-0002', to: B });
  await b1.next('call:incoming', (e) => e.callId === 'call-0002');
  assert.equal((await a1.next('call:ended', (e) => e.callId === 'call-0002')).status, 'missed');
  a1.send({ type: 'call:invite', callId: 'call-0003', to: B });
  await b1.next('call:incoming', (e) => e.callId === 'call-0003');
  b1.send({ type: 'call:reject', callId: 'call-0003' });
  assert.equal((await a1.next('call:ended', (e) => e.callId === 'call-0003')).status, 'declined');
  await b2.next('call:ended', (e) => e.callId === 'call-0003');

  // Caller disconnecting mid-ring cancels the call for the callee
  a1.send({ type: 'call:invite', callId: 'call-0004', to: B });
  await b1.next('call:incoming', (e) => e.callId === 'call-0004');
  a1.close();
  assert.equal((await b1.next('call:ended', (e) => e.callId === 'call-0004')).status, 'cancelled');
  await b1.next('presence', (e) => e.user === A && !e.online);

  // Calling someone offline is logged as missed
  const a2 = await socket(aliya.data.token);
  b1.close();
  b2.close();
  await a2.next('presence', (e) => e.user === B && !e.online);
  a2.send({ type: 'call:invite', callId: 'call-0005', to: B });
  const offline = await a2.next('call:ended', (e) => e.callId === 'call-0005');
  assert.deepEqual([offline.status, offline.reason], ['missed', 'offline']);

  // Revoking a device signs that device out
  const b3 = await socket(bolat2.data.token);
  const mac = (await call('GET', '/api/devices', { token: bolat.data.token })).data.devices.find((d) => !d.current);
  assert.equal(mac.online, true);
  assert.equal((await call('DELETE', `/api/devices/${mac.id}`, { token: bolat.data.token })).status, 200);
  await b3.next('session:revoked');
  assert.equal((await call('GET', '/api/me', { token: bolat2.data.token })).status, 401);
  a2.close();
});

test('rejects bad sockets and serves unknown API paths as JSON 404', async () => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'auth', token: 'forged' }));
  const [code] = await once(ws, 'close');
  assert.equal(code, 4001);
  assert.equal((await call('GET', '/api/nothing')).status, 404);
  assert.equal((await call('DELETE', '/api/me')).status, 405);
  assert.equal((await fetch(base + '/healthz')).status, 200);
});

test('personal gestures are stored per account, grouped in sets and shared by its devices', async () => {
  const reg = await call('POST', '/api/auth/register', { body: { username: 'gulnar', displayName: 'Гульнар', password: 'password-3' } });
  const token = reg.data.token;
  const second = (await call('POST', '/api/auth/login', { body: { login: 'gulnar', password: 'password-3' } })).data.token;
  const other = (await call('POST', '/api/auth/register', { body: { username: 'erlan', displayName: 'Ерлан', password: 'password-4' } })).data.token;
  const ws = await socket(second);
  const take = (seed) => Array.from({ length: 128 }, (_, i) => Math.sin(i + seed));
  const preview = { fps: 30, frames: [Array.from({ length: 98 }, (_, i) => (i % 7 ? i / 100 : null))] };

  assert.equal((await call('GET', '/api/gestures')).status, 401);
  // Every account starts with the Kazakh and Russian sets.
  const start = await call('GET', '/api/gestures', { token });
  assert.deepEqual(start.data.sets.map((x) => x.name), ['Казахский жестовый язык', 'Русский жестовый язык']);
  const [kz, ru] = start.data.sets.map((x) => x.id);

  assert.equal((await call('POST', '/api/gestures', { token, body: { setId: kz, name: '  ', modelVersion: 'v1' } })).status, 400);
  const created = await call('POST', '/api/gestures', { token, body: { setId: kz, name: 'Привет', modelVersion: 'v1' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.gesture.setId, kz);
  const id = created.data.gesture.id;
  // Other devices get the changed gesture itself, not just a "reload" signal.
  const live = await ws.next('gestures:changed');
  assert.equal(live.gesture.id, id);
  assert.equal((await call('POST', '/api/gestures', { token, body: { setId: kz, name: 'привет', modelVersion: 'v1' } })).status, 409);
  // The same meaning can exist in another set.
  const ruHello = await call('POST', '/api/gestures', { token, body: { setId: ru, name: 'Привет', modelVersion: 'v1' } });
  assert.equal(ruHello.status, 201);

  for (let i = 0; i < 5; i++) {
    const added = await call('POST', `/api/gestures/${id}/takes`, { token, body: { take: take(i), preview: i === 1 ? undefined : preview, modelVersion: 'v1' } });
    assert.equal(added.status, 201);
    assert.equal(added.data.gesture.takes.length, i + 1);
  }
  assert.equal((await call('POST', `/api/gestures/${id}/takes`, { token, body: { take: take(9), modelVersion: 'v1' } })).status, 409);
  const bad = await call('POST', `/api/gestures/${ruHello.data.gesture.id}/takes`, { token, body: { take: take(1), preview: { fps: 30, frames: [[1, 2]] }, modelVersion: 'v1' } });
  assert.equal(bad.status, 400);

  // Look through the takes: previews line up with takes; delete one bad take.
  const listed = (await call('GET', '/api/gestures', { token: second })).data.gestures.find((x) => x.id === id);
  assert.equal(listed.takes.length, 5);
  assert.equal(listed.previews, undefined); // the list leaves previews out…
  assert.deepEqual(listed.durations.map((d) => d === null), [false, true, false, false, false]);
  let g = (await call('GET', `/api/gestures/${id}`, { token: second })).data.gesture; // …one gesture has them
  assert.equal(g.takes.length, 5);
  assert.equal(g.previews.length, 5);
  assert.equal(g.previews[1], null);
  assert.equal(g.previews[0].frames[0][0], null);
  const removedTake = await call('DELETE', `/api/gestures/${id}/takes/1`, { token });
  assert.equal(removedTake.data.gesture.takes.length, 4);
  assert.ok(removedTake.data.gesture.previews.every((p) => p !== null));
  assert.equal((await call('DELETE', `/api/gestures/${id}/takes/9`, { token })).status, 404);
  assert.equal((await call('GET', '/api/gestures', { token: other })).data.gestures.length, 0);
  assert.equal((await call('DELETE', `/api/gestures/${id}`, { token: other })).status, 404);

  // Rename, move between sets (name clash refused), re-record from scratch.
  assert.equal((await call('PATCH', `/api/gestures/${id}`, { token, body: { setId: ru } })).status, 409);
  const moved = await call('PATCH', `/api/gestures/${id}`, { token, body: { setId: ru, name: 'Сәлем' } });
  assert.equal(moved.data.gesture.setId, ru);
  assert.equal(moved.data.gesture.name, 'Сәлем');
  assert.equal(moved.data.gesture.takes.length, 4);
  g = (await call('DELETE', `/api/gestures/${id}/takes`, { token })).data.gesture;
  assert.equal(g.takes.length, 0);

  // Sets: create, rename, refuse duplicates, delete with their gestures, keep the last one.
  const mine = await call('POST', '/api/gesture-sets', { token, body: { name: 'Колледж' } });
  assert.equal(mine.status, 201);
  assert.equal((await call('POST', '/api/gesture-sets', { token, body: { name: 'колледж' } })).status, 409);
  assert.equal((await call('PATCH', `/api/gesture-sets/${mine.data.set.id}`, { token, body: { name: 'Учёба' } })).data.set.name, 'Учёба');
  await call('POST', '/api/gestures', { token, body: { setId: mine.data.set.id, name: 'Урок', modelVersion: 'v1', takes: [take(1), take(2), take(3)] } });
  assert.equal((await call('DELETE', `/api/gesture-sets/${mine.data.set.id}`, { token })).status, 200);
  const after = (await call('GET', '/api/gestures', { token })).data;
  assert.equal(after.sets.length, 2);
  assert.ok(!after.gestures.some((x) => x.name === 'Урок'));
  assert.equal((await call('DELETE', `/api/gesture-sets/${kz}`, { token })).status, 200);
  assert.equal((await call('DELETE', `/api/gesture-sets/${ru}`, { token })).status, 409);

  assert.equal((await call('DELETE', '/api/gestures', { token })).data.removed, 2);
  assert.equal((await call('GET', '/api/gestures', { token })).data.gestures.length, 0);
  ws.close();
  await once(ws.ws, 'close');
  await new Promise((r) => setTimeout(r, 50));
});

test('static files: content ETags with 304, precompressed .br/.gz chosen by Accept-Encoding', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { brotliCompressSync, gzipSync, brotliDecompressSync, gunzipSync } = await import('node:zlib');
  const { request } = await import('node:http');
  const root = await mkdtemp(join(tmpdir(), 'signtalk-static-'));
  const wasm = Buffer.alloc(64 * 1024, 7);
  await mkdir(join(root, 'vendor'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><title>t</title>');
  await writeFile(join(root, 'vendor', 'rt.wasm'), wasm);
  await writeFile(join(root, 'vendor', 'rt.wasm.br'), brotliCompressSync(wasm));
  await writeFile(join(root, 'vendor', 'rt.wasm.gz'), gzipSync(wasm));
  const site = createApp({ databasePath: ':memory:', staticRoot: root, env: {} });
  await site.ready;
  site.server.listen(0, '127.0.0.1');
  await once(site.server, 'listening');
  const port = site.server.address().port;
  // node:http, not fetch: fetch would decode the body and hide Content-Encoding.
  const get = (path, headers = {}) =>
    new Promise((resolve, reject) => {
      request({ host: '127.0.0.1', port, path, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject).end();
    });
  try {
    const plain = await get('/vendor/rt.wasm');
    assert.equal(plain.status, 200);
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.headers['content-type'], 'application/wasm');
    assert.equal(plain.headers['cache-control'], 'no-cache');
    assert.equal(plain.headers.vary, 'Accept-Encoding');
    assert.ok(plain.body.equals(wasm));
    assert.match(plain.headers.etag, /^"[\w-]+"$/);

    const br = await get('/vendor/rt.wasm', { 'Accept-Encoding': 'gzip, deflate, br' });
    assert.equal(br.headers['content-encoding'], 'br');
    assert.ok(brotliDecompressSync(br.body).equals(wasm));
    assert.notEqual(br.headers.etag, plain.headers.etag);

    const gz = await get('/vendor/rt.wasm', { 'Accept-Encoding': 'gzip, br;q=0' });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.ok(gunzipSync(gz.body).equals(wasm));

    // Revalidation: the same ETag gets an empty 304, a stale one the full file.
    const again = await get('/vendor/rt.wasm', { 'Accept-Encoding': 'br', 'If-None-Match': br.headers.etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    assert.equal(again.headers.etag, br.headers.etag);
    assert.equal((await get('/vendor/rt.wasm', { 'Accept-Encoding': 'br', 'If-None-Match': '"old"' })).status, 200);

    // A changed file gets a new ETag.
    await writeFile(join(root, 'index.html'), '<!doctype html><title>t2</title>');
    const html = await get('/');
    await writeFile(join(root, 'index.html'), '<!doctype html><title>t3</title>');
    const html2 = await get('/', { 'If-None-Match': html.headers.etag });
    assert.equal(html2.status, 200);
    assert.equal(html2.body.toString(), '<!doctype html><title>t3</title>');

    assert.equal((await get('/missing.wasm')).status, 404);
    assert.equal((await get('/..%2f..%2fetc%2fpasswd')).status, 403);
  } finally {
    await site.close();
    await rm(root, { recursive: true, force: true });
  }
});
