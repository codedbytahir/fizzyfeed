/**
 * Auth routes (spec 02, task T06): Buffer OAuth2 + PKCE connect, logout, me,
 * revoke. Mounted at /api/auth (see index.ts) so the final URLs are
 * /api/auth/buffer/login, /buffer/callback, /logout, /me, /revoke.
 *
 * Cookie discipline: fb_oauth (state + PKCE verifier, HMAC-signed, 5 min,
 * single-use) and fizzy_session (30d). Tokens are sealed at rest with AAD =
 * user_id; nothing here ever logs token material (spec 01 §5).
 */
import { Hono } from "hono";
import type { Context } from "hono";
import {
  BufferApiError,
  buildAuthorizeUrl,
  createBufferClient,
  exchangeCodeForTokens,
} from "../lib/buffer";
import { bytesToBase64Url, randomToken, timingSafeEqual } from "../lib/crypto";
import { jsonError } from "../lib/http";
import { RefreshError, sealTokenColumns, withAccessToken } from "../lib/refresh";
import {
  clearOAuthCookie,
  clearSessionCookie,
  readOAuthCookie,
  readSessionUserId,
  setOAuthCookie,
  setSessionCookie,
} from "../lib/session";
import type { Env, HonoEnv } from "../env";
import type { BufferChannel, BufferProfile, MeResponse, TokenPair } from "../../shared/types";

const auth = new Hono<HonoEnv>();

// spec 02 §2: login requests read-only scopes only; the write scope is a
// separate upgrade consent at recap time (spec 06) — never bundled here.
const LOGIN_SCOPES = "read";
// upgrade consent requests the write scope alone (spec 02 §2 — separate consent,
// never bundled into login)
const UPGRADE_SCOPES = "write";

function bufferClientFrom(env: Env) {
  return createBufferClient({
    clientId: env.BUFFER_CLIENT_ID,
    clientSecret: env.BUFFER_CLIENT_SECRET,
    redirectUri: env.BUFFER_REDIRECT_URI,
  });
}

/**
 * The callback 302 must both clear fb_oauth (single-use, spec 02 §3) and set
 * fizzy_session. The session helpers each own the single Set-Cookie slot
 * (replace semantics), so capture the pending clear value and re-append it.
 */
async function setCallbackCookies(c: Context<HonoEnv>, userId: string): Promise<void> {
  const pendingClear = c.res.headers.get("Set-Cookie");
  await setSessionCookie(c, userId);
  if (pendingClear) c.header("Set-Cookie", pendingClear, { append: true });
}

// GET /api/auth/buffer/login → 302 Buffer authorize (PKCE S256)
auth.get("/buffer/login", async (c) => {
  const state = randomToken(32);
  const verifier = randomToken(48); // 64 base64url chars — PKCE verifier
  const challenge = bytesToBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  );
  await setOAuthCookie(c, { state, verifier });
  const authorizeUrl = buildAuthorizeUrl({
    clientId: c.env.BUFFER_CLIENT_ID,
    redirectUri: c.env.BUFFER_REDIRECT_URI,
    scope: LOGIN_SCOPES,
    state,
    codeChallenge: challenge,
  });
  return c.redirect(authorizeUrl, 302);
});

// GET /api/auth/buffer/upgrade → write-scope consent (spec 02 §2, spec 06 §2.3):
// a SEPARATE consent — the user approves the write scope alone on Buffer's
// screen; edited recap text is preserved client-side via the returnTo path.
auth.get("/buffer/upgrade", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return c.redirect("/api/auth/buffer/login", 302);
  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = bytesToBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  );
  // returnTo must be a local path — no open redirects
  const raw = c.req.query("returnTo") ?? "/app/recap";
  const returnTo = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/app/recap";
  await setOAuthCookie(c, { state, verifier, returnTo });
  const authorizeUrl = buildAuthorizeUrl({
    clientId: c.env.BUFFER_CLIENT_ID,
    redirectUri: c.env.BUFFER_REDIRECT_URI,
    scope: UPGRADE_SCOPES,
    state,
    codeChallenge: challenge,
  });
  return c.redirect(authorizeUrl, 302);
});

// GET /api/auth/buffer/callback → 302 /app | 400/502 JSON error shape
auth.get("/buffer/callback", async (c) => {
  const oauth = await readOAuthCookie(c);
  if (!oauth) return jsonError(c, 400, "invalid_state", "oauth state missing or expired");
  // single-use (spec 02 §3): consume the state cookie before anything else —
  // a replayed callback no longer carries it and fails the check below.
  clearOAuthCookie(c);

  const queryState = c.req.query("state") ?? "";
  if (!queryState || !timingSafeEqual(queryState, oauth.state)) {
    return jsonError(c, 400, "invalid_state", "state mismatch");
  }
  const code = c.req.query("code") ?? "";
  if (!code) return jsonError(c, 400, "missing_code", "authorization code missing");

  // redirect_uri always comes from env, never from the query (spec 02 §3).
  let pair: TokenPair;
  try {
    pair = await exchangeCodeForTokens({
      clientId: c.env.BUFFER_CLIENT_ID,
      clientSecret: c.env.BUFFER_CLIENT_SECRET,
      redirectUri: c.env.BUFFER_REDIRECT_URI,
      code,
      codeVerifier: oauth.verifier,
    });
  } catch (err) {
    if (err instanceof BufferApiError) {
      return jsonError(c, 502, "upstream_error", "buffer token exchange failed");
    }
    throw err;
  }

  const client = bufferClientFrom(c.env);
  let profile: BufferProfile;
  try {
    profile = await client.getProfile(pair.accessToken);
  } catch (err) {
    if (err instanceof BufferApiError) {
      return jsonError(c, 502, "upstream_error", "buffer profile fetch failed");
    }
    throw err;
  }

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users (id, buffer_id, display_name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(buffer_id) DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at"
    ).bind(crypto.randomUUID(), profile.id, profile.name, profile.avatar ?? null, now, now),
  ]);
  // re-select: on repeat connects the upsert keeps the original user id
  const userRow = await c.env.DB.prepare("SELECT id FROM users WHERE buffer_id = ?")
    .bind(profile.id)
    .first<{ id: string }>();
  if (!userRow) return jsonError(c, 500, "internal", "user upsert failed");
  const userId = userRow.id;

  const columns = await sealTokenColumns(c.env.TOKEN_AES_KEY, userId, pair.accessToken, pair.refreshToken);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO buffer_tokens (user_id, access_enc, refresh_enc, iv, salt, expires_at, scopes, rotated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET access_enc = excluded.access_enc, refresh_enc = excluded.refresh_enc, iv = excluded.iv, salt = excluded.salt, expires_at = excluded.expires_at, scopes = excluded.scopes, rotated_at = excluded.rotated_at"
    ).bind(userId, columns.accessEnc, columns.refreshEnc, columns.iv, columns.salt, now + pair.expiresIn, pair.scope, now),
    c.env.DB.prepare(
      "INSERT INTO sync_state (user_id, backfill_done, last_polled_at) VALUES (?, 0, 0) ON CONFLICT(user_id) DO NOTHING"
    ).bind(userId),
  ]);

  await setCallbackCookies(c, userId);
  // logs carry ids only — never tokens (spec 01 §5)
  console.log(`buffer connect ok user=${userId}`);

  // kick the 12-month backfill without ever blocking/sinking the login (T09 owns sync)
  void c.executionCtx.waitUntil((async () => {
    try {
      const { startBackfill } = await import("../lib/sync");
      await startBackfill(c.env, userId);
    } catch (e) {
      console.error("backfill kick failed", (e as Error).message);
    }
  })());

  // upgrade consent returns to the flow that requested it (spec 06 §2.3);
  // plain logins land on the deck. Path-only values, re-sanitized.
  const returnTo =
    oauth.returnTo && oauth.returnTo.startsWith("/") && !oauth.returnTo.startsWith("//")
      ? oauth.returnTo
      : "/app";
  return c.redirect(`${c.env.APP_ORIGIN}${returnTo}`, 302);
});

// POST /api/auth/logout → 204 (tokens retained so re-login is instant, spec 02 §4)
auth.post("/logout", (c) => {
  clearSessionCookie(c);
  return c.body(null, 204);
});

// POST /api/auth/revoke → 204 (delete tokens + sync state + greatest-hits PAT)
auth.post("/revoke", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in to continue");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM buffer_tokens WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM sync_state WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM metrics_tokens WHERE user_id = ?").bind(userId),
  ]);
  // critic r1: purge the greatest-hits cache too — spec 07 revoke semantics
  await c.env.CACHE.delete(`gh:${userId}`);
  clearSessionCookie(c);
  console.log(`buffer disconnect ok user=${userId}`);
  return c.body(null, 204);
});

// GET /api/auth/me → MeResponse | 401
auth.get("/me", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in to continue");

  const userRow = await c.env.DB.prepare("SELECT id, display_name, avatar_url FROM users WHERE id = ?")
    .bind(userId)
    .first<{ id: string; display_name: string; avatar_url: string | null }>();
  if (!userRow) return jsonError(c, 401, "no_session", "sign in to continue");

  const syncRow = await c.env.DB.prepare("SELECT backfill_done FROM sync_state WHERE user_id = ?")
    .bind(userId)
    .first<{ backfill_done: number }>();

  let channels: BufferChannel[];
  try {
    channels = await withAccessToken(c.env, userId, (token) => bufferClientFrom(c.env).listChannels(token));
  } catch (err) {
    if (err instanceof RefreshError) {
      return jsonError(
        c,
        err.status,
        err.status === 401 ? "session_expired" : "upstream_error",
        err.message
      );
    }
    throw err;
  }

  const me: MeResponse = {
    id: userRow.id,
    displayName: userRow.display_name,
    avatarUrl: userRow.avatar_url ?? undefined,
    channels,
    connected: true,
    backfillDone: !!syncRow?.backfill_done,
  };
  return c.json(me);
});

export default auth;
