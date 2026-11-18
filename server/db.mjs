// SQLite storage for accounts, devices, contacts, messages and calls (local runs and tests).
// Uses Node's built-in node:sqlite, so nothing native has to compile on the host.
// With DATABASE_URL set the server uses PgStore (db-pg.mjs) instead; callers always
// `await` store methods, so both stores are interchangeable.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return new Store(db);
}

const userColumns = 'id, public_id, username, display_name, created_at';

/** Public view of a user row. Never contains the password hash or internal id. */
export function publicUser(row) {
  return row
    ? {
        id: row.public_id,
        username: row.username,
        displayName: row.display_name,
        createdAt: row.created_at,
      }
    : null;
}

export class Store {
  constructor(db) {
    this.db = db;
    const q = (sql) => db.prepare(sql);
    this.s = {
      insertUser: q(
        'INSERT INTO users (public_id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      ),
      userById: q(`SELECT ${userColumns} FROM users WHERE id = ?`),
      userByPublicId: q(`SELECT ${userColumns} FROM users WHERE public_id = ?`),
      userByUsername: q(`SELECT ${userColumns} FROM users WHERE username = ?`),
      credentials: q(
        `SELECT ${userColumns}, password_hash FROM users WHERE username = ? OR public_id = ?`,
      ),
      publicIdTaken: q('SELECT 1 FROM users WHERE public_id = ?'),
      rename: q('UPDATE users SET display_name = ? WHERE id = ?'),

      insertSession: q(
        'INSERT INTO sessions (user_id, token_hash, device_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
      ),
      sessionByHash: q(
        'SELECT id, user_id, device_name, created_at, last_seen_at FROM sessions WHERE token_hash = ? AND revoked_at IS NULL',
      ),
      touchSession: q('UPDATE sessions SET last_seen_at = ? WHERE id = ?'),
      sessionsOf: q(
        'SELECT id, device_name, created_at, last_seen_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC',
      ),
      revokeSession: q(
        'UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
      ),

      addContact: q(
        'INSERT OR IGNORE INTO contacts (owner_id, contact_id, created_at) VALUES (?, ?, ?)',
      ),
      removeContact: q('DELETE FROM contacts WHERE owner_id = ? AND contact_id = ?'),
      isContact: q('SELECT 1 FROM contacts WHERE owner_id = ? AND contact_id = ?'),
      related: q(
        'SELECT owner_id AS id FROM contacts WHERE contact_id = ? UNION SELECT contact_id AS id FROM contacts WHERE owner_id = ?',
      ),
      contactsOf: q(
        `SELECT u.id, u.public_id, u.username, u.display_name, u.created_at, c.created_at AS added_at
           FROM contacts c JOIN users u ON u.id = c.contact_id
          WHERE c.owner_id = ?`,
      ),
      lastMessage: q(
        `SELECT * FROM messages
          WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
          ORDER BY id DESC LIMIT 1`,
      ),
      unreadFrom: q(
        // Completed calls are not "unread"; missed or declined ones are.
        `SELECT COUNT(*) AS n FROM messages WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL
            AND NOT (kind = 'call' AND body LIKE '%"status":"completed"%')`,
      ),

      insertMessage: q(
        'INSERT INTO messages (sender_id, recipient_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)',
      ),
      messageById: q('SELECT * FROM messages WHERE id = ?'),
      history: q(
        `SELECT * FROM messages
          WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)) AND id < ?
          ORDER BY id DESC LIMIT ?`,
      ),
      markRead: q(
        'UPDATE messages SET read_at = ? WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL AND id <= ?',
      ),

      insertCall: q(
        "INSERT INTO calls (id, caller_id, callee_id, status, created_at) VALUES (?, ?, ?, 'ringing', ?)",
      ),
      answerCall: q("UPDATE calls SET status = 'active', answered_at = ? WHERE id = ?"),
      finishCall: q('UPDATE calls SET status = ?, ended_at = ? WHERE id = ?'),
    };
  }

  close() {
    this.db.close();
  }

  /**
   * Runs fn(tx) between BEGIN and COMMIT (same contract as PgStore.transaction).
   * Every SQLite call is synchronous, so the awaits inside fn never let another request in.
   */
  async transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const value = await fn(this);
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // --- users ---------------------------------------------------------------
  createUser({ publicId, username, displayName, passwordHash, now }) {
    const { lastInsertRowid } = this.s.insertUser.run(
      publicId,
      username,
      displayName,
      passwordHash,
      now,
    );
    return this.s.userById.get(Number(lastInsertRowid));
  }
  userById(id) {
    return this.s.userById.get(id);
  }
  userByPublicId(publicId) {
    return this.s.userByPublicId.get(publicId);
  }
  userByUsername(username) {
    return this.s.userByUsername.get(username);
  }
  credentials(username, publicId) {
    return this.s.credentials.get(username, publicId ?? '');
  }
  publicIdTaken(publicId) {
    return !!this.s.publicIdTaken.get(publicId);
  }
  rename(userId, displayName) {
    this.s.rename.run(displayName, userId);
    return this.userById(userId);
  }
  publicIdOf(id) {
    return this.userById(id)?.public_id ?? null;
  }

  // --- sessions (devices) --------------------------------------------------
  createSession({ userId, tokenHash, deviceName, now }) {
    const { lastInsertRowid } = this.s.insertSession.run(userId, tokenHash, deviceName, now, now);
    return Number(lastInsertRowid);
  }
  sessionByHash(tokenHash) {
    return this.s.sessionByHash.get(tokenHash);
  }
  sessionWithUser(tokenHash) {
    const session = this.sessionByHash(tokenHash);
    const user = session ? this.userById(session.user_id) : null;
    return session && user ? { session, user } : null;
  }
  related(a, b) {
    return this.isContact(a, b) || this.isContact(b, a);
  }
  touchSession(id, now) {
    this.s.touchSession.run(now, id);
  }
  sessionsOf(userId) {
    return this.s.sessionsOf.all(userId);
  }
  revokeSession(userId, sessionId, now) {
    return this.s.revokeSession.run(now, sessionId, userId).changes > 0;
  }

  // --- contacts ------------------------------------------------------------
  addContact(ownerId, contactId, now) {
    return this.s.addContact.run(ownerId, contactId, now).changes > 0;
  }
  removeContact(ownerId, contactId) {
    this.s.removeContact.run(ownerId, contactId);
  }
  isContact(ownerId, contactId) {
    return !!this.s.isContact.get(ownerId, contactId);
  }
  contactsOf(userId) {
    return this.s.contactsOf.all(userId).map((row) => ({
      row,
      addedAt: row.added_at,
      last: this.s.lastMessage.get(userId, row.id, row.id, userId) ?? null,
      unread: Number(this.s.unreadFrom.get(userId, row.id).n),
    }));
  }

  /** Everyone who saved this user or whom this user saved: they see each other's presence. */
  relatedUsers(userId) {
    return this.s.related.all(userId, userId).map((row) => row.id);
  }

  // --- messages ------------------------------------------------------------
  /** API shape of a message row: public IDs instead of internal ones. */
  messageJson(row) {
    return {
      id: row.id,
      from: this.userById(row.sender_id)?.public_id ?? null,
      to: this.userById(row.recipient_id)?.public_id ?? null,
      kind: row.kind,
      body: row.body,
      createdAt: row.created_at,
      readAt: row.read_at ?? null,
    };
  }
  insertMessage({ senderId, recipientId, kind, body, now }) {
    const { lastInsertRowid } = this.s.insertMessage.run(senderId, recipientId, kind, body, now);
    return this.s.messageById.get(Number(lastInsertRowid));
  }
  history(userId, otherId, beforeId, limit) {
    return this.s.history.all(userId, otherId, otherId, userId, beforeId, limit).reverse();
  }
  markRead(readerId, senderId, upToId, now) {
    return this.s.markRead.run(now, readerId, senderId, upToId).changes;
  }

  // --- calls ---------------------------------------------------------------
  insertCall(id, callerId, calleeId, now) {
    this.s.insertCall.run(id, callerId, calleeId, now);
  }
  answerCall(id, now) {
    this.s.answerCall.run(now, id);
  }
  finishCall(id, status, now) {
    this.s.finishCall.run(status, now, id);
  }
}
