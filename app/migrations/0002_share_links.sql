-- fizzyfeed — 0002_share_links.sql (feature 6: opt-in public share pages)
-- One share link per user, opt-in. share_id survives disable (toggling back
-- on restores the same URL — rotate is the real rotation). rev is bumped on
-- every toggle/rotate so the public PNG KV caches self-invalidate.

CREATE TABLE share_links (
  user_id TEXT PRIMARY KEY,                 -- users.id
  share_id TEXT NOT NULL UNIQUE,            -- randomToken(32): the /u/{shareId} slug
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),  -- 0 = private, 1 = public
  rev INTEGER NOT NULL DEFAULT 0,           -- bumped on toggle/rotate; public PNG cache keys include it
  created_at INTEGER NOT NULL               -- unix seconds
);
