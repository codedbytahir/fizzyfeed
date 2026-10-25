/**
 * Token refresh lifecycle (spec 02 §4, task T07) + token-store sealing helpers.
 *
 * Storage layout inside buffer_tokens — the schema has ONE iv/salt column pair,
 * while crypto.seal() derives a fresh salt + IV per call, so:
 *   access_enc  = raw AES-GCM ciphertext+tag of the access token (AAD = user_id)
 *   iv / salt   = IV + PBKDF2 salt of the ACCESS box (makes access_enc self-contained)
 *   refresh_enc = self-describing JSON envelope { v, iv, salt, ct } (base64url)
 *                 of the refresh box, also sealed with AAD = user_id
 * Both boxes decrypt only under the row owner's AAD — tamper/swap protection
 * comes from crypto.ts (spec 01 §6.1).
 *
 * Reactive path (withAccessToken): run fn → on Buffer 401 refresh ONCE, rotate
 * inside db.batch() (token columns + sync_state watermark atomically) and retry.
 * Proactive path (refreshExpiringTokens): hourly cron sweeps rows expiring
 * within 24h. Tokens are decrypted in-memory only, never logged, never in KV.
 */
import { base64UrlToBytes, bytesToBase64Url, seal, unseal } from "./crypto";
import { BufferApiError, createBufferClient } from "./buffer";
import type { Env } from "../env";
import type { TokenPair } from "../../shared/types";

export class RefreshError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 502 = 502
  ) {
    super(message);
    this.name = "RefreshError";
  }
}

type BlobLike = ArrayBuffer | Uint8Array; // D1 returns ArrayBuffer; tests may pass Uint8Array

export interface StoredTokenRow {
  user_id: string;
  access_enc: BlobLike;
  refresh_enc: BlobLike;
  iv: BlobLike;
  salt: BlobLike;
  expires_at: number;
}

export interface SealedTokenColumns {
  accessEnc: Uint8Array;
  refreshEnc: Uint8Array;
  iv: Uint8Array;
  salt: Uint8Array;
}

const REFRESH_ENVELOPE_VERSION = 1;
const DAY_SEC = 86_400;
const PROACTIVE_HORIZON_SEC = 86_400; // spec 02 §4: refresh when expires_at < now + 24h

interface RefreshEnvelope {
  v: number;
  iv: string;
  salt: string;
  ct: string;
}

function asBytes(v: BlobLike): Uint8Array {
  return v instanceof Uint8Array ? v : new Uint8Array(v);
}

/** Seal a token pair for one buffer_tokens row (see layout note above). */
export async function sealTokenColumns(
  keyB64: string,
  userId: string,
  accessToken: string,
  refreshToken: string
): Promise<SealedTokenColumns> {
  const accessBox = await seal(keyB64, accessToken, userId);
  const refreshBox = await seal(keyB64, refreshToken, userId);
  const envelope: RefreshEnvelope = {
    v: REFRESH_ENVELOPE_VERSION,
    iv: bytesToBase64Url(refreshBox.iv),
    salt: bytesToBase64Url(refreshBox.salt),
    ct: bytesToBase64Url(refreshBox.ct),
  };
  return {
    accessEnc: accessBox.ct,
    iv: accessBox.iv,
    salt: accessBox.salt,
    refreshEnc: new TextEncoder().encode(JSON.stringify(envelope)),
  };
}

function openRefreshEnvelope(bytes: Uint8Array): { iv: Uint8Array; salt: Uint8Array; ct: Uint8Array } {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<RefreshEnvelope>;
  if (
    parsed.v !== REFRESH_ENVELOPE_VERSION ||
    typeof parsed.iv !== "string" ||
    typeof parsed.salt !== "string" ||
    typeof parsed.ct !== "string"
  ) {
    throw new Error("malformed refresh envelope");
  }
  return {
    iv: base64UrlToBytes(parsed.iv),
    salt: base64UrlToBytes(parsed.salt),
    ct: base64UrlToBytes(parsed.ct),
  };
}

/** Decrypt the access token straight from the row columns (AAD = userId). */
export async function unsealAccessToken(
  keyB64: string,
  userId: string,
  row: Pick<StoredTokenRow, "access_enc" | "iv" | "salt">
): Promise<string> {
  return unseal(keyB64, { iv: asBytes(row.iv), salt: asBytes(row.salt), ct: asBytes(row.access_enc) }, userId);
}

/** Decrypt the refresh token from its self-describing envelope (AAD = userId). */
export async function unsealRefreshToken(
  keyB64: string,
  userId: string,
  refreshEnc: BlobLike
): Promise<string> {
  return unseal(keyB64, openRefreshEnvelope(asBytes(refreshEnc)), userId);
}

async function fetchTokenRow(env: Env, userId: string): Promise<StoredTokenRow | null> {
  return env.DB.prepare(
    "SELECT user_id, access_enc, refresh_enc, iv, salt, expires_at FROM buffer_tokens WHERE user_id = ?"
  )
    .bind(userId)
    .first<StoredTokenRow>();
}

function isBuffer401(err: unknown): boolean {
  if (err instanceof BufferApiError) return err.status === 401;
  if (typeof err === "object" && err !== null && "status" in err) {
    return (err as { status?: unknown }).status === 401;
  }
  return false;
}

/**
 * Shared rotation: unseal refresh → Buffer refresh → re-seal → atomic
 * db.batch() of the token columns + sync_state watermark. Returns the new
 * access token for the immediate retry.
 */
async function rotateTokens(env: Env, userId: string, row: StoredTokenRow): Promise<string> {
  const refreshToken = await unsealRefreshToken(env.TOKEN_AES_KEY, userId, row.refresh_enc);
  const client = createBufferClient({
    clientId: env.BUFFER_CLIENT_ID,
    clientSecret: env.BUFFER_CLIENT_SECRET,
    redirectUri: env.BUFFER_REDIRECT_URI,
  });
  let pair: TokenPair;
  try {
    pair = await client.refreshAccessToken(refreshToken);
  } catch (err) {
    if (err instanceof BufferApiError) {
      throw new RefreshError(
        err.status === 401 ? "buffer session expired" : "buffer refresh failed",
        err.status === 401 ? 401 : 502
      );
    }
    throw err;
  }
  const columns = await sealTokenColumns(env.TOKEN_AES_KEY, userId, pair.accessToken, pair.refreshToken);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + pair.expiresIn;
  // Rotation is atomic: new columns + poll watermark land together (spec 02 §4).
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE buffer_tokens SET access_enc = ?, refresh_enc = ?, iv = ?, salt = ?, expires_at = ?, rotated_at = ? WHERE user_id = ?"
    ).bind(columns.accessEnc, columns.refreshEnc, columns.iv, columns.salt, expiresAt, now, userId),
    env.DB.prepare("UPDATE sync_state SET last_polled_at = ? WHERE user_id = ?").bind(now, userId),
  ]);
  return pair.accessToken;
}

export async function withAccessToken<T>(
  env: Env,
  userId: string,
  fn: (accessToken: string) => Promise<T>
): Promise<T> {
  const row = await fetchTokenRow(env, userId);
  if (!row) throw new RefreshError("buffer not connected", 401);
  let accessToken: string;
  try {
    accessToken = await unsealAccessToken(env.TOKEN_AES_KEY, userId, row);
  } catch {
    // unreadable/tampered row → force re-connect instead of surfacing a 500
    throw new RefreshError("buffer token unreadable", 401);
  }
  try {
    return await fn(accessToken);
  } catch (err) {
    if (!isBuffer401(err)) throw err;
    const fresh = await rotateTokens(env, userId, row);
    try {
      return await fn(fresh);
    } catch (retryErr) {
      if (isBuffer401(retryErr)) throw new RefreshError("buffer session expired", 401);
      throw retryErr;
    }
  }
}

/** Hourly cron sweep (spec 01 §4, spec 02 §4): refresh rows expiring within 24h. */
export async function refreshExpiringTokens(env: Env): Promise<number> {
  const horizon = Math.floor(Date.now() / 1000) + PROACTIVE_HORIZON_SEC;
  const expiring = await env.DB.prepare(
    "SELECT user_id FROM buffer_tokens WHERE expires_at < ?"
  )
    .bind(horizon)
    .all<{ user_id: string }>();
  let refreshed = 0;
  for (const row of expiring.results) {
    try {
      const full = await fetchTokenRow(env, row.user_id);
      if (!full) continue;
      await rotateTokens(env, row.user_id, full);
      refreshed += 1;
    } catch (err) {
      // one bad token must not kill the sweep — ids only in logs, never tokens
      console.error(`proactive refresh failed user=${row.user_id} :: ${(err as Error).message}`);
    }
  }
  return refreshed;
}
