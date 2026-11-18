// PostgreSQL storage (Supabase or any Postgres) with the same interface as the
// SQLite Store in db.mjs, except that every method returns a Promise.
// Used when DATABASE_URL is set.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const SCHEMA = readFileSync(new URL('./schema.pg.sql', import.meta.url), 'utf8');

const INT8 = 20;
// bigint columns (ids, millisecond timestamps, COUNT) come back as JS numbers, like SQLite.
const types = {
  getTypeParser: (oid, format) => (oid === INT8 ? Number : pg.types.getTypeParser(oid, format)),
};

const userColumns = 'id, public_id, username, display_name, created_at';
const COMPLETED_CALL = '%"status":"completed"%';

/**
 * Opens a connection pool and applies the schema.
 * `schema` (optional) puts every table in that Postgres schema instead of "public" (used by tests).
 */
export function openPostgres(connectionString, { schema, max = 5 } = {}) {
  const url = new URL(connectionString);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const sslDisabled = url.searchParams.get('sslmode') === 'disable';
  // Supabase uses its own CA; the connection is still encrypted. sslmode in the URL
  // would override this object, so it is removed and handled here.
  url.searchParams.delete('sslmode');
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: local || sslDisabled ? false : { rejectUnauthorized: false },
    max,
    types,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    query_timeout: 15_000,
    keepAlive: true,
  });
  pool.on('error', (error) => console.error('postgres pool error', error.message));
  if (schema) {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw Error('Invalid schema name');
    pool.on('connect', (client) => {
      client.query(`SET search_path TO ${schema}`).catch(() => undefined);
    });
  }
  const store = new PgStore(pool, pool, new Map());
  store.ready = (async () => {
    if (schema) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}; SET search_path TO ${schema};`);
    await pool.query(SCHEMA);
  })();
  return store;
}

export class PgStore {
  /** `db` is the pool, or a single client inside a transaction. */
  constructor(pool, db, publicIds) {
    this.pool = pool;
    this.db = db;
    /** internal id -> public_id. Public IDs never change, so this is safe to cache. */
    this.publicIds = publicIds;
  }

  async one(sql, params) {
    return (await this.db.query(sql, params)).rows[0];
  }
  async all(sql, params) {
    return (await this.db.query(sql, params)).rows;
  }
  async run(sql, params) {
    return (await this.db.query(sql, params)).rowCount ?? 0;
  }
  remember(row) {
    if (row?.id && row.public_id) this.publicIds.set(row.id, row.public_id);
    return row;
  }

  async close() {
    await this.pool.end();
  }

  /** Runs fn(tx) inside BEGIN/COMMIT on one connection; tx has the same methods as the store. */
  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await fn(new PgStore(this.pool, client, this.publicIds));
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  // --- users ---------------------------------------------------------------
  async createUser({ publicId, username, displayName, passwordHash, now }) {
    return this.remember(
      await this.one(
        `INSERT INTO users (public_id, username, display_name, password_hash, created_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${userColumns}`,
        [publicId, username, displayName, passwordHash, now],
      ),
    );
  }
  async userById(id) {
    return this.remember(await this.one(`SELECT ${userColumns} FROM users WHERE id = $1`, [id]));
  }
  async userByPublicId(publicId) {
    return this.remember(await this.one(`SELECT ${userColumns} FROM users WHERE public_id = $1`, [publicId]));
  }
  async userByUsername(username) {
    return this.remember(
      await this.one(`SELECT ${userColumns} FROM users WHERE lower(username) = lower($1)`, [username]),
    );
  }
  async credentials(username, publicId) {
    return this.one(
      `SELECT ${userColumns}, password_hash FROM users WHERE lower(username) = lower($1) OR public_id = $2`,
      [username, publicId ?? ''],
    );
  }
  async publicIdTaken(publicId) {
    return !!(await this.one('SELECT 1 FROM users WHERE public_id = $1', [publicId]));
  }
  async rename(userId, displayName) {
    return this.remember(
      await this.one(`UPDATE users SET display_name = $1 WHERE id = $2 RETURNING ${userColumns}`, [
        displayName,
        userId,
      ]),
    );
  }
  async publicIdOf(id) {
    if (!this.publicIds.has(id)) await this.userById(id);
    return this.publicIds.get(id) ?? null;
  }

  // --- sessions (devices) --------------------------------------------------
  async createSession({ userId, tokenHash, deviceName, now }) {
    const row = await this.one(
      `INSERT INTO sessions (user_id, token_hash, device_name, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $4) RETURNING id`,
      [userId, tokenHash, deviceName, now],
    );
    return row.id;
  }
  async sessionByHash(tokenHash) {
    return this.one(
      'SELECT id, user_id, device_name, created_at, last_seen_at FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL',
      [tokenHash],
    );
  }
  /** Session and its user in one round trip (null when the token is unknown or revoked). */
  async sessionWithUser(tokenHash) {
    const r = await this.one(
      `SELECT s.id AS s_id, s.user_id, s.device_name, s.created_at AS s_created_at, s.last_seen_at,
              u.id, u.public_id, u.username, u.display_name, u.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
      [tokenHash],
    );
    if (!r) return null;
    return {
      session: { id: r.s_id, user_id: r.user_id, device_name: r.device_name, created_at: r.s_created_at, last_seen_at: r.last_seen_at },
      user: this.remember({ id: r.id, public_id: r.public_id, username: r.username, display_name: r.display_name, created_at: r.created_at }),
    };
  }
  async touchSession(id, now) {
    await this.run('UPDATE sessions SET last_seen_at = $1 WHERE id = $2', [now, id]);
  }
  async sessionsOf(userId) {
    return this.all(
      'SELECT id, device_name, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY last_seen_at DESC',
      [userId],
    );
  }
  async revokeSession(userId, sessionId, now) {
    return (
      (await this.run(
        'UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL',
        [now, sessionId, userId],
      )) > 0
    );
  }

  // --- contacts ------------------------------------------------------------
  async addContact(ownerId, contactId, now) {
    return (
      (await this.run(
        'INSERT INTO contacts (owner_id, contact_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [ownerId, contactId, now],
      )) > 0
    );
  }
  async removeContact(ownerId, contactId) {
    await this.run('DELETE FROM contacts WHERE owner_id = $1 AND contact_id = $2', [ownerId, contactId]);
  }
  /** True when either person saved the other (one round trip). */
  async related(a, b) {
    return !!(await this.one(
      'SELECT 1 FROM contacts WHERE (owner_id = $1 AND contact_id = $2) OR (owner_id = $2 AND contact_id = $1) LIMIT 1',
      [a, b],
    ));
  }
  async isContact(ownerId, contactId) {
    return !!(await this.one('SELECT 1 FROM contacts WHERE owner_id = $1 AND contact_id = $2', [ownerId, contactId]));
  }
  /** Same shape as the SQLite store, in one round trip: contact row, last message and unread count. */
  async contactsOf(userId) {
    const rows = await this.all(
      `SELECT u.id, u.public_id, u.username, u.display_name, u.created_at, c.created_at AS added_at,
              lm.id AS m_id, lm.sender_id AS m_sender_id, lm.recipient_id AS m_recipient_id, lm.kind AS m_kind,
              lm.body AS m_body, lm.created_at AS m_created_at, lm.read_at AS m_read_at,
              (SELECT COUNT(*) FROM messages m
                WHERE m.recipient_id = $1 AND m.sender_id = u.id AND m.read_at IS NULL
                  AND NOT (m.kind = 'call' AND m.body LIKE $2)) AS unread
         FROM contacts c
         JOIN users u ON u.id = c.contact_id
         LEFT JOIN LATERAL (
           SELECT * FROM messages
            WHERE (sender_id = $1 AND recipient_id = u.id) OR (sender_id = u.id AND recipient_id = $1)
            ORDER BY id DESC LIMIT 1
         ) lm ON true
        WHERE c.owner_id = $1`,
      [userId, COMPLETED_CALL],
    );
    return rows.map((r) => ({
      row: this.remember({
        id: r.id,
        public_id: r.public_id,
        username: r.username,
        display_name: r.display_name,
        created_at: r.created_at,
      }),
      addedAt: r.added_at,
      last:
        r.m_id == null
          ? null
          : {
              id: r.m_id,
              sender_id: r.m_sender_id,
              recipient_id: r.m_recipient_id,
              kind: r.m_kind,
              body: r.m_body,
              created_at: r.m_created_at,
              read_at: r.m_read_at,
            },
      unread: Number(r.unread),
    }));
  }

  /** Everyone who saved this user or whom this user saved: they see each other's presence. */
  async relatedUsers(userId) {
    // Also returns public IDs, so the caller can name them without more round trips.
    const rows = await this.all(
      `SELECT u.id, u.public_id FROM users u
        WHERE u.id IN (SELECT owner_id FROM contacts WHERE contact_id = $1
                       UNION SELECT contact_id FROM contacts WHERE owner_id = $1)`,
      [userId],
    );
    return rows.map((row) => this.remember(row).id);
  }

  // --- messages ------------------------------------------------------------
  /** API shape of a message row: public IDs instead of internal ones. */
  async messageJson(row) {
    return {
      id: row.id,
      from: await this.publicIdOf(row.sender_id),
      to: await this.publicIdOf(row.recipient_id),
      kind: row.kind,
      body: row.body,
      createdAt: row.created_at,
      readAt: row.read_at ?? null,
    };
  }
  async insertMessage({ senderId, recipientId, kind, body, now }) {
    return this.one(
      'INSERT INTO messages (sender_id, recipient_id, kind, body, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [senderId, recipientId, kind, body, now],
    );
  }
  async history(userId, otherId, beforeId, limit) {
    const rows = await this.all(
      `SELECT * FROM messages
        WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)) AND id < $3
        ORDER BY id DESC LIMIT $4`,
      [userId, otherId, beforeId, limit],
    );
    return rows.reverse();
  }
  async markRead(readerId, senderId, upToId, now) {
    return this.run(
      'UPDATE messages SET read_at = $1 WHERE recipient_id = $2 AND sender_id = $3 AND read_at IS NULL AND id <= $4',
      [now, readerId, senderId, upToId],
    );
  }

  // --- calls ---------------------------------------------------------------
  async insertCall(id, callerId, calleeId, now) {
    await this.run(
      "INSERT INTO calls (id, caller_id, callee_id, status, created_at) VALUES ($1, $2, $3, 'ringing', $4)",
      [id, callerId, calleeId, now],
    );
  }
  async answerCall(id, now) {
    await this.run("UPDATE calls SET status = 'active', answered_at = $1 WHERE id = $2", [now, id]);
  }
  async finishCall(id, status, now) {
    await this.run('UPDATE calls SET status = $1, ended_at = $2 WHERE id = $3', [status, now, id]);
  }
}
