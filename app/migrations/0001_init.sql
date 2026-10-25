-- fizzyfeed — 0001_init.sql (spec 01 §3, verbatim)
-- D1 is the only durable state. KV is cache-only. Tokens are AES-GCM ciphertext.

CREATE TABLE users (
  id TEXT PRIMARY KEY,                      -- uuid (crypto.randomUUID)
  buffer_id TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,              -- unix seconds
  updated_at INTEGER NOT NULL
);

CREATE TABLE buffer_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_enc BLOB NOT NULL,                 -- AES-GCM ciphertext (JSON envelope)
  refresh_enc BLOB NOT NULL,
  iv BLOB NOT NULL, salt BLOB NOT NULL,     -- per-row random
  expires_at INTEGER NOT NULL,              -- access token expiry (unix seconds)
  scopes TEXT NOT NULL,
  rotated_at INTEGER NOT NULL
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,                      -- buffer post id
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_service TEXT NOT NULL,            -- 'twitter','instagram',...
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,              -- published time (unix seconds)
  year INTEGER NOT NULL, month INTEGER NOT NULL, dow INTEGER NOT NULL, hour INTEGER NOT NULL
);
CREATE INDEX idx_posts_user_time ON posts(user_id, created_at);
CREATE UNIQUE INDEX idx_posts_unique ON posts(id, user_id);

CREATE TABLE sync_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  backfill_done INTEGER NOT NULL DEFAULT 0, -- 12-month initial fetch complete
  last_polled_at INTEGER NOT NULL DEFAULT 0,
  poll_cursor TEXT                          -- JSON metadata (backfill request budget counter, page cursor)
);

CREATE TABLE metrics_tokens (               -- Greatest Hits opt-in (spec 07)
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pat_enc BLOB NOT NULL, iv BLOB NOT NULL, salt BLOB NOT NULL,
  created_at INTEGER NOT NULL, revoked_at INTEGER
);

CREATE TABLE ai_cache (                     -- persona output (KV holds card PNGs only)
  user_id TEXT NOT NULL, kind TEXT NOT NULL, -- 'persona' | 'recap'
  year INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, year)
);
