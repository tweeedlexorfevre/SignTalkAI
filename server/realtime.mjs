// WebSocket hub: presence, live delivery to every signed-in device, and
// WebRTC call signalling (ring all devices, answer on one, relay SDP/ICE and
// live captions between the two connected devices only).
import { publicUser } from './db.mjs';
import { tokenHash } from './auth.mjs';

const CALL_ID = /^[A-Za-z0-9-]{8,64}$/;
const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 25_000;

export class Hub {
  constructor({ store, now = Date.now, ringTimeoutMs = 45_000 }) {
    this.store = store;
    this.now = now;
    this.ringTimeoutMs = ringTimeoutMs;
    /** userId -> Set<Conn> */
    this.sockets = new Map();
    /** callId -> Call */
    this.calls = new Map();
    /** userId -> callId while ringing or in a call */
    this.userCall = new Map();
    this.heartbeat = setInterval(() => {
      for (const set of this.sockets.values())
        for (const conn of set) {
          if (!conn.alive) {
            conn.ws.terminate();
            continue;
          }
          conn.alive = false;
          try {
            conn.ws.ping();
          } catch {
            /* closing */
          }
        }
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  close() {
    clearInterval(this.heartbeat);
    for (const call of this.calls.values()) clearTimeout(call.timer);
    for (const set of this.sockets.values()) for (const conn of set) conn.ws.terminate();
  }

  // --- connections -----------------------------------------------------------
  attach(ws) {
    // Messages from one device are handled one after another, in arrival order,
    // even though the database calls are asynchronous.
    const conn = { ws, userId: null, user: null, sessionId: null, alive: true, closed: false, queue: Promise.resolve() };
    const authTimer = setTimeout(() => {
      if (!conn.userId) ws.close(4001, 'unauthorized');
    }, AUTH_TIMEOUT_MS);
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data, isBinary) => {
      conn.alive = true;
      if (isBinary) return;
      let msg;
      try {
        msg = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
      conn.queue = conn.queue
        .then(async () => {
          if (conn.closed) return;
          if (!conn.userId) {
            if (msg.type === 'auth') await this.authenticate(conn, msg.token, authTimer);
            return;
          }
          await this.handle(conn, msg);
        })
        .catch((error) => console.error('realtime error', error));
    });
    ws.on('close', () => {
      conn.closed = true;
      clearTimeout(authTimer);
      this.detach(conn).catch((error) => console.error('realtime error', error));
    });
    ws.on('error', () => undefined);
  }

  async authenticate(conn, token, authTimer) {
    const found = typeof token === 'string' && token ? await this.store.sessionWithUser(tokenHash(token)) : null;
    const session = found?.session;
    const user = found?.user;
    if (conn.closed) return;
    if (!user) {
      this.send(conn, { type: 'error', code: 'unauthorized' });
      conn.ws.close(4001, 'unauthorized');
      return;
    }
    const related = await this.store.relatedUsers(user.id);
    const relatedIds = new Map();
    for (const id of related) relatedIds.set(id, await this.store.publicIdOf(id));
    if (conn.closed) return;
    // From here on nothing awaits, so the connection is registered atomically.
    clearTimeout(authTimer);
    conn.userId = user.id;
    conn.user = user;
    conn.sessionId = session.id;
    let set = this.sockets.get(user.id);
    const firstDevice = !set;
    if (!set) this.sockets.set(user.id, (set = new Set()));
    set.add(conn);
    this.send(conn, {
      type: 'ready',
      user: publicUser(user),
      sessionId: session.id,
      online: related.filter((id) => this.isOnline(id)).map((id) => relatedIds.get(id)),
    });
    if (firstDevice) this.broadcastPresence(user, related, true);
    // A device that connects while its user is being called should ring too.
    const callId = this.userCall.get(user.id);
    const call = callId ? this.calls.get(callId) : null;
    if (call && call.state === 'ringing' && call.calleeId === user.id) {
      this.send(conn, { type: 'call:incoming', callId: call.id, from: publicUser(call.caller) });
    }
    await Promise.resolve(this.store.touchSession(session.id, this.now())).catch(() => undefined);
  }

  async detach(conn) {
    if (!conn.userId) return;
    const set = this.sockets.get(conn.userId);
    set?.delete(conn);
    const lastDevice = set && set.size === 0;
    if (lastDevice) this.sockets.delete(conn.userId);
    const callId = this.userCall.get(conn.userId);
    const call = callId ? this.calls.get(callId) : null;
    if (call) {
      if (call.callerConn === conn) this.endCall(call, call.state === 'active' ? 'completed' : 'cancelled', 'disconnected');
      else if (call.calleeConn === conn) this.endCall(call, 'completed', 'disconnected');
      else if (call.state === 'ringing' && call.calleeId === conn.userId && lastDevice) this.endCall(call, 'missed', 'offline');
    }
    if (lastDevice) {
      const related = await this.store.relatedUsers(conn.userId);
      // The user may have come back on another device in the meantime.
      if (!this.isOnline(conn.userId)) this.broadcastPresence(conn.user, related, false);
    }
  }

  /** Signs a device out everywhere it is connected (used when a session is revoked). */
  dropSession(sessionId) {
    for (const set of this.sockets.values())
      for (const conn of [...set])
        if (conn.sessionId === sessionId) {
          this.send(conn, { type: 'session:revoked' });
          conn.ws.close(4003, 'revoked');
        }
  }

  isOnline(userId) {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  sessionOnline(sessionId) {
    for (const set of this.sockets.values()) for (const conn of set) if (conn.sessionId === sessionId) return true;
    return false;
  }

  send(conn, event) {
    if (conn.ws.readyState === 1) conn.ws.send(JSON.stringify(event));
  }

  sendToUser(userId, event) {
    for (const conn of this.sockets.get(userId) ?? []) this.send(conn, event);
  }

  broadcastPresence(user, related, online) {
    for (const id of related) this.sendToUser(id, { type: 'presence', user: user.public_id, online });
  }

  // --- messages from clients ---------------------------------------------------
  async handle(conn, msg) {
    switch (msg.type) {
      case 'ping':
        this.send(conn, { type: 'pong', t: msg.t });
        return;
      case 'typing': {
        const peer = typeof msg.to === 'string' ? await this.store.userByPublicId(msg.to) : null;
        if (peer && peer.id !== conn.userId && (await this.related(conn.userId, peer.id))) {
          this.sendToUser(peer.id, { type: 'typing', from: conn.user.public_id });
        }
        return;
      }
      case 'call:invite':
        await this.invite(conn, msg);
        return;
      case 'call:accept':
        this.accept(conn, msg);
        return;
      case 'call:reject':
      case 'call:end':
        this.hangUp(conn, msg);
        return;
      case 'call:signal':
      case 'call:caption':
        this.relay(conn, msg);
        return;
      default:
        return;
    }
  }

  async related(a, b) {
    return this.store.related(a, b);
  }

  /** Queues a database write for this call so writes land in order (insert, answer, finish). */
  record(call, write) {
    call.db = call.db.then(write).catch((error) => console.error('call record failed', error));
    return call.db;
  }

  async invite(conn, { callId, to }) {
    if (typeof callId !== 'string' || !CALL_ID.test(callId) || this.calls.has(callId)) return;
    const reject = (reason) => this.send(conn, { type: 'call:ended', callId, status: 'failed', reason });
    const callee = typeof to === 'string' ? await this.store.userByPublicId(to) : null;
    if (!callee || callee.id === conn.userId) return reject('not_found');
    if (!(await this.related(conn.userId, callee.id))) return reject('not_contact');
    const caller = (await this.store.userById(conn.userId)) ?? conn.user; // fresh display name
    // State may have changed while the database answered.
    if (conn.closed || this.calls.has(callId)) return;
    if (this.userCall.has(conn.userId)) return reject('self_busy');
    const now = this.now();
    const call = {
      id: callId,
      callerId: conn.userId,
      calleeId: callee.id,
      caller,
      callee,
      callerConn: conn,
      calleeConn: null,
      state: 'ringing',
      createdAt: now,
      answeredAt: null,
      timer: null,
      db: Promise.resolve(),
    };
    this.record(call, () => this.store.insertCall(callId, conn.userId, callee.id, now));
    if (!this.isOnline(callee.id)) return this.finish(call, 'missed', 'offline', false);
    if (this.userCall.has(callee.id)) return this.finish(call, 'busy', 'busy', false);
    this.calls.set(callId, call);
    this.userCall.set(conn.userId, callId);
    this.userCall.set(callee.id, callId);
    call.timer = setTimeout(() => this.endCall(call, 'missed', 'timeout'), this.ringTimeoutMs);
    this.send(conn, { type: 'call:ringing', callId, to: publicUser(callee) });
    this.sendToUser(callee.id, { type: 'call:incoming', callId, from: publicUser(caller) });
  }

  accept(conn, { callId }) {
    const call = this.calls.get(callId);
    if (!call || call.state !== 'ringing' || call.calleeId !== conn.userId) {
      this.send(conn, { type: 'call:ended', callId, status: 'failed', reason: 'gone' });
      return;
    }
    clearTimeout(call.timer);
    call.state = 'active';
    call.calleeConn = conn;
    call.answeredAt = this.now();
    this.record(call, () => this.store.answerCall(call.id, call.answeredAt));
    this.send(call.callerConn, { type: 'call:accepted', callId });
    for (const other of this.sockets.get(call.calleeId) ?? [])
      if (other !== conn) this.send(other, { type: 'call:taken', callId });
  }

  hangUp(conn, { callId }) {
    const call = this.calls.get(callId);
    if (!call) return;
    const isCaller = call.callerConn === conn;
    const isCallee = call.calleeId === conn.userId && (call.state === 'ringing' || call.calleeConn === conn);
    if (!isCaller && !isCallee) return;
    if (call.state === 'active') this.endCall(call, 'completed', isCaller ? 'caller_hung_up' : 'callee_hung_up');
    else this.endCall(call, isCaller ? 'cancelled' : 'declined', isCaller ? 'cancelled' : 'declined');
  }

  relay(conn, msg) {
    const call = this.calls.get(msg.callId);
    if (!call || call.state !== 'active') return;
    const target = call.callerConn === conn ? call.calleeConn : call.calleeConn === conn ? call.callerConn : null;
    if (!target) return;
    if (msg.type === 'call:signal') {
      if (!msg.data || typeof msg.data !== 'object') return;
      this.send(target, { type: 'call:signal', callId: call.id, data: msg.data });
    } else {
      const text = typeof msg.text === 'string' ? msg.text.slice(0, 500) : '';
      const source = ['sign', 'speech', 'text', 'status'].includes(msg.source) ? msg.source : 'text';
      this.send(target, { type: 'call:caption', callId: call.id, text, source, final: msg.final === true });
    }
  }

  endCall(call, status, reason) {
    if (!this.calls.has(call.id)) return;
    void this.finish(call, status, reason, true);
  }

  /** Records the call outcome, logs it in the chat and tells every device of both people. */
  async finish(call, status, reason, registered) {
    clearTimeout(call.timer);
    if (registered) {
      this.calls.delete(call.id);
      if (this.userCall.get(call.callerId) === call.id) this.userCall.delete(call.callerId);
      if (this.userCall.get(call.calleeId) === call.id) this.userCall.delete(call.calleeId);
    }
    const now = this.now();
    const duration = call.answeredAt ? Math.round((now - call.answeredAt) / 1000) : 0;
    const ended = { type: 'call:ended', callId: call.id, status, reason };
    for (const id of [call.callerId, call.calleeId]) this.sendToUser(id, ended);
    let message = null;
    await this.record(call, async () => {
      await this.store.finishCall(call.id, status, now);
      const row = await this.store.insertMessage({
        senderId: call.callerId,
        recipientId: call.calleeId,
        kind: 'call',
        body: JSON.stringify({ status, duration }),
        now,
      });
      message = await this.store.messageJson(row);
    });
    if (message) for (const id of [call.callerId, call.calleeId]) this.sendToUser(id, { type: 'message:new', message });
  }
}
