/**
 * Worker bindings + env (spec 01 §4). Non-secret vars come from wrangler.jsonc;
 * secrets via `wrangler secret put` (local: .dev.vars, gitignored).
 */
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  AI: Ai;
  ASSETS: Fetcher;

  // non-secret vars
  BUFFER_CLIENT_ID: string;
  BUFFER_REDIRECT_URI: string;
  APP_ORIGIN: string;

  // secrets
  BUFFER_CLIENT_SECRET: string;
  SESSION_SECRET: string; // ≥ 32 bytes base64 — HMAC key for session/oauth cookies
  TOKEN_AES_KEY: string; // 32 bytes base64 — AES-256-GCM key material for token store
}

export type HonoEnv = { Bindings: Env };

export const SESSION_COOKIE = "fizzy_session";
export const OAUTH_COOKIE = "fb_oauth";
