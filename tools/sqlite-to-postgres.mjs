// Prints SQL that copies a local SignTalk SQLite database into the Postgres schema
// (server/schema.pg.sql). Keeps the original ids and resets the id sequences.
//
//   node tools/sqlite-to-postgres.mjs data/signtalk.db > migrate.sql
import { DatabaseSync } from 'node:sqlite';

const path = process.argv[2] ?? 'data/signtalk.db';
const db = new DatabaseSync(path, { readOnly: true });

const lit = (v) =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'number' || typeof v === 'bigint'
      ? String(v)
      : `'${String(v).replaceAll("'", "''")}'`;

const tables = [
  ['users', ['id', 'public_id', 'username', 'display_name', 'password_hash', 'created_at']],
  ['sessions', ['id', 'user_id', 'token_hash', 'device_name', 'created_at', 'last_seen_at', 'revoked_at']],
  ['contacts', ['owner_id', 'contact_id', 'created_at']],
  ['messages', ['id', 'sender_id', 'recipient_id', 'kind', 'body', 'created_at', 'read_at']],
  ['calls', ['id', 'caller_id', 'callee_id', 'status', 'created_at', 'answered_at', 'ended_at']],
];

const out = ['BEGIN;'];
for (const [table, cols] of tables) {
  const rows = db.prepare(`SELECT ${cols.join(', ')} FROM ${table} ORDER BY 1`).all();
  if (!rows.length) continue;
  out.push(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES\n` +
      rows.map((r) => `  (${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n') +
      '\nON CONFLICT DO NOTHING;',
  );
}
for (const table of ['users', 'sessions', 'messages'])
  out.push(
    `SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1));`,
  );
out.push('COMMIT;');
console.log(out.join('\n\n'));
