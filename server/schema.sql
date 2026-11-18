-- SignTalk messenger schema (SQLite). Applied on every start; every statement is idempotent.
PRAGMA foreign_keys = ON;

-- Accounts. public_id is the unique ID people share to find each other (e.g. ST-7KQ2MX).
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id     TEXT    NOT NULL UNIQUE,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL
);

-- One row per signed-in device. Only a SHA-256 of the bearer token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT    NOT NULL UNIQUE,
  device_name  TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Address book: owner_id saved contact_id.
CREATE TABLE IF NOT EXISTS contacts (
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, contact_id),
  CHECK (owner_id <> contact_id)
);

-- Direct messages. kind: text (typed), sign (recognised sign), speech (speech-to-text), call (call log, body is JSON).
CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL CHECK (kind IN ('text', 'sign', 'speech', 'call')),
  body         TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  read_at      INTEGER
);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(sender_id, recipient_id, id);
CREATE INDEX IF NOT EXISTS messages_unread ON messages(recipient_id, read_at);

-- Video calls, one row per call attempt.
CREATE TABLE IF NOT EXISTS calls (
  id          TEXT    PRIMARY KEY,
  caller_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT    NOT NULL CHECK (status IN ('ringing', 'active', 'completed', 'missed', 'declined', 'cancelled', 'busy', 'failed')),
  created_at  INTEGER NOT NULL,
  answered_at INTEGER,
  ended_at    INTEGER
);
CREATE INDEX IF NOT EXISTS calls_caller ON calls(caller_id);
CREATE INDEX IF NOT EXISTS calls_callee ON calls(callee_id);
