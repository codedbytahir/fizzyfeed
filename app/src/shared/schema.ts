/**
 * D1 row types mirroring migrations/0001_init.sql (spec 01 §3).
 * Keep this file in lockstep with the migration — the critic checks both.
 */

export interface UserRow {
  id: string;
  buffer_id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: number;
  updated_at: number;
}

/** AES-GCM envelope stored as BLOB — JSON-serialized { v, ct } bytes. */
export interface CipherEnvelope {
  v: 1;
  ct: ArrayBuffer; // ciphertext bytes (includes 16-byte GCM auth tag)
}

export interface BufferTokenRow {
  user_id: string;
  access_enc: ArrayBuffer;
  refresh_enc: ArrayBuffer;
  iv: ArrayBuffer; // 12 bytes
  salt: ArrayBuffer; // 16 bytes
  expires_at: number; // unix seconds
  scopes: string;
  rotated_at: number;
}

export interface PostRow {
  id: string;
  user_id: string;
  channel_id: string;
  channel_service: string;
  text: string;
  created_at: number;
  year: number;
  month: number; // 0–11
  dow: number; // 0–6
  hour: number; // 0–23
}

export interface SyncStateRow {
  user_id: string;
  backfill_done: number; // 0 | 1
  last_polled_at: number;
  poll_cursor: string | null; // JSON: { backfillReqsToday, backfillDay, page }
}

export interface MetricsTokenRow {
  user_id: string;
  pat_enc: ArrayBuffer;
  iv: ArrayBuffer;
  salt: ArrayBuffer;
  created_at: number;
  revoked_at: number | null;
}

export interface AiCacheRow {
  user_id: string;
  kind: "persona" | "recap";
  year: number;
  payload_json: string;
  created_at: number;
}

export interface ShareLinkRow {
  user_id: string;
  share_id: string;
  enabled: number; // 0 | 1 (CHECK constraint in 0002_share_links.sql)
  rev: number; // bumped on every toggle/rotate — public PNG cache keys include it
  created_at: number; // unix seconds
}
