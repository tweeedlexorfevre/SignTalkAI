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
  // Columns added after the first release of the gestures table.
  const columns = new Set(db.prepare('PRAGMA table_info(gestures)').all().map((c) => c.name));
  if (!columns.has('set_id'))
    db.exec('ALTER TABLE gestures ADD COLUMN set_id TEXT REFERENCES gesture_sets(id) ON DELETE CASCADE');
  if (!columns.has('previews')) db.exec("ALTER TABLE gestures ADD COLUMN previews TEXT NOT NULL DEFAULT '[]'");
  if (!columns.has('scope')) db.exec("ALTER TABLE gestures ADD COLUMN scope TEXT NOT NULL DEFAULT 'personal'");
  const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  if (!userColumns.has('is_admin')) db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  const setColumns = new Set(db.prepare('PRAGMA table_info(gesture_sets)').all().map((c) => c.name));
  if (!setColumns.has('scope')) db.exec("ALTER TABLE gesture_sets ADD COLUMN scope TEXT NOT NULL DEFAULT 'personal'");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS gesture_sets_global_name ON gesture_sets (lower(name)) WHERE scope = 'global'");
  return new Store(db);
}

const userColumns = 'id, public_id, username, display_name, created_at, is_admin';
const gestureColumns = 'id, set_id, name, model_version, takes, previews, created_at, updated_at, scope';

/** Public view of a user row. Never contains the password hash or internal id. */
export function publicUser(row) {
  return row
    ? {
        id: row.public_id,
        username: row.username,
        displayName: row.display_name,
        createdAt: row.created_at,
        isAdmin: !!row.is_admin,
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
      setAdmin: q('UPDATE users SET is_admin = 1 WHERE id = ?'),

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

      setsOf: q("SELECT id, name, created_at, updated_at, scope FROM gesture_sets WHERE owner_id = ? AND scope = 'personal' ORDER BY created_at, id"),
      setById: q("SELECT id, name, created_at, updated_at, scope FROM gesture_sets WHERE owner_id = ? AND id = ? AND scope = 'personal'"),
      insertSet: q('INSERT INTO gesture_sets (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
      renameSet: q('UPDATE gesture_sets SET name = ?, updated_at = ? WHERE owner_id = ? AND id = ?'),
      deleteSetGestures: q("DELETE FROM gestures WHERE owner_id = ? AND set_id = ? AND scope = 'personal'"),
      deleteSet: q('DELETE FROM gesture_sets WHERE owner_id = ? AND id = ?'),
      adoptOrphans: q("UPDATE gestures SET set_id = ? WHERE owner_id = ? AND set_id IS NULL AND scope = 'personal'"),

      gestureNames: q("SELECT id, set_id, name FROM gestures WHERE owner_id = ? AND scope = 'personal'"),
      gesturesOf: q(`SELECT ${gestureColumns} FROM gestures WHERE owner_id = ? AND scope = 'personal' ORDER BY created_at, id`),
      gestureById: q(`SELECT ${gestureColumns} FROM gestures WHERE owner_id = ? AND id = ? AND scope = 'personal'`),
      insertGesture: q(
        'INSERT INTO gestures (id, owner_id, set_id, name, model_version, takes, previews, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ),
      updateGesture: q(
        "UPDATE gestures SET set_id = ?, name = ?, model_version = ?, takes = ?, previews = ?, updated_at = ? WHERE owner_id = ? AND id = ? AND scope = 'personal'",
      ),
      deleteGesture: q("DELETE FROM gestures WHERE owner_id = ? AND id = ? AND scope = 'personal'"),
      clearGestures: q("DELETE FROM gestures WHERE owner_id = ? AND scope = 'personal'"),
      globalSets: q("SELECT id, name, created_at, updated_at, scope FROM gesture_sets WHERE scope = 'global' ORDER BY created_at, id"),
      globalSetById: q("SELECT id, name, created_at, updated_at, scope FROM gesture_sets WHERE id = ? AND scope = 'global'"),
      insertGlobalSet: q("INSERT INTO gesture_sets (id, owner_id, name, scope, created_at, updated_at) VALUES (?, ?, ?, 'global', ?, ?)") ,
      renameGlobalSet: q("UPDATE gesture_sets SET name = ?, updated_at = ? WHERE id = ? AND scope = 'global'"),
      deleteGlobalSet: q("DELETE FROM gesture_sets WHERE id = ? AND scope = 'global'"),
      globalGestureNames: q("SELECT id, set_id, name FROM gestures WHERE scope = 'global'"),
      globalGestures: q(`SELECT ${gestureColumns} FROM gestures WHERE scope = 'global' ORDER BY created_at, id`),
      globalGestureById: q(`SELECT ${gestureColumns} FROM gestures WHERE id = ? AND scope = 'global'`),
      insertGlobalGesture: q("INSERT INTO gestures (id, owner_id, set_id, name, model_version, takes, previews, scope, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'global', ?, ?)") ,
      updateGlobalGesture: q("UPDATE gestures SET set_id = ?, name = ?, model_version = ?, takes = ?, previews = ?, updated_at = ? WHERE id = ? AND scope = 'global'"),
      deleteGlobalGesture: q("DELETE FROM gestures WHERE id = ? AND scope = 'global'"),
      clearGlobalGestures: q("DELETE FROM gestures WHERE set_id = ? AND scope = 'global'"),
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
  setAdmin(userId) { this.s.setAdmin.run(userId); return this.userById(userId); }
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

  // --- gesture sets and personal gestures ---------------------------------
  setsOf(ownerId) {
    return this.s.setsOf.all(ownerId);
  }
  setById(ownerId, id) {
    return this.s.setById.get(ownerId, id);
  }
  insertSet({ id, ownerId, name, now }) {
    this.s.insertSet.run(id, ownerId, name, now, now);
    return this.setById(ownerId, id);
  }
  renameSet(ownerId, id, name, now) {
    this.s.renameSet.run(name, now, ownerId, id);
    return this.setById(ownerId, id);
  }
  deleteSet(ownerId, id) {
    // Foreign keys cascade too; deleting explicitly also covers databases opened without them.
    this.s.deleteSetGestures.run(ownerId, id);
    return this.s.deleteSet.run(ownerId, id).changes > 0;
  }
  adoptOrphans(ownerId, setId) {
    return Number(this.s.adoptOrphans.run(setId, ownerId).changes);
  }

  /** Rows look like the PostgreSQL ones: JSON columns are parsed back into arrays. */
  gestureRow(row) {
    return row ? { ...row, takes: JSON.parse(row.takes), previews: JSON.parse(row.previews ?? '[]') } : undefined;
  }
  gestureNames(ownerId) {
    return this.s.gestureNames.all(ownerId);
  }
  gesturesOf(ownerId) {
    return this.s.gesturesOf.all(ownerId).map((row) => this.gestureRow(row));
  }
  gestureById(ownerId, id) {
    return this.gestureRow(this.s.gestureById.get(ownerId, id));
  }
  insertGesture({ id, ownerId, setId, name, modelVersion, takes, previews, now }) {
    this.s.insertGesture.run(id, ownerId, setId, name, modelVersion, JSON.stringify(takes), JSON.stringify(previews), now, now);
    return this.gestureById(ownerId, id);
  }
  updateGesture(ownerId, id, { setId, name, modelVersion, takes, previews, now }) {
    this.s.updateGesture.run(setId, name, modelVersion, JSON.stringify(takes), JSON.stringify(previews), now, ownerId, id);
    return this.gestureById(ownerId, id);
  }
  deleteGesture(ownerId, id) {
    return this.s.deleteGesture.run(ownerId, id).changes > 0;
  }
  clearGestures(ownerId, setId) {
    return Number((setId ? this.s.deleteSetGestures.run(ownerId, setId) : this.s.clearGestures.run(ownerId)).changes);
  }
  globalSets() { return this.s.globalSets.all(); }
  globalSetById(id) { return this.s.globalSetById.get(id); }
  insertGlobalSet({ id, ownerId, name, now }) { this.s.insertGlobalSet.run(id, ownerId, name, now, now); return this.globalSetById(id); }
  renameGlobalSet(id, name, now) { this.s.renameGlobalSet.run(name, now, id); return this.globalSetById(id); }
  deleteGlobalSet(id) { return this.s.deleteGlobalSet.run(id).changes > 0; }
  globalGestureNames() { return this.s.globalGestureNames.all(); }
  globalGestures() { return this.s.globalGestures.all().map((row) => this.gestureRow(row)); }
  globalGestureById(id) { return this.gestureRow(this.s.globalGestureById.get(id)); }
  insertGlobalGesture({ id, ownerId, setId, name, modelVersion, takes, previews, now }) { this.s.insertGlobalGesture.run(id, ownerId, setId, name, modelVersion, JSON.stringify(takes), JSON.stringify(previews), now, now); return this.globalGestureById(id); }
  updateGlobalGesture(id, { setId, name, modelVersion, takes, previews, now }) { this.s.updateGlobalGesture.run(setId, name, modelVersion, JSON.stringify(takes), JSON.stringify(previews), now, id); return this.globalGestureById(id); }
  deleteGlobalGesture(id) { return this.s.deleteGlobalGesture.run(id).changes > 0; }
  clearGlobalGestures(setId) { return Number(this.s.clearGlobalGestures.run(setId).changes); }
}
