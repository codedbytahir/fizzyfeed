/**
 * Signed cookie sessions (spec 01 §5, spec 02 §3).
 *   fizzy_session = base64url(userId).base64url(expiry).hmac   (30d sliding)
 *   fb_oauth      = base64url(json{state,verifier}).expiry.hmac (5 min, single-use)
 * Both HttpOnly; Secure; SameSite=Lax; Path=/.
 */
import { hmacSign, hmacVerify, base64UrlToBytes, bytesToBase64Url } from "./crypto";
import { OAUTH_COOKIE, SESSION_COOKIE, type HonoEnv } from "../env";
import type { Context } from "hono";

const SESSION_TTL_SEC = 30 * 24 * 3600;
const OAUTH_TTL_SEC = 300;

function cookieHeader(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function clearHeader(name: string): string {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// ── session ─────────────────────────────────────────────────────────────────

export async function setSessionCookie(
  c: Context<HonoEnv>,
  userId: string,
  ttlSec = SESSION_TTL_SEC
): Promise<void> {
  const expiry = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${bytesToBase64Url(new TextEncoder().encode(userId))}.${expiry}`;
  const sig = await hmacSign(c.env.SESSION_SECRET, payload);
  c.header("Set-Cookie", cookieHeader(SESSION_COOKIE, `${payload}.${sig}`, ttlSec));
}

export function clearSessionCookie(c: Context<HonoEnv>): void {
  c.header("Set-Cookie", clearHeader(SESSION_COOKIE));
}

export async function readSessionUserId(c: Context<HonoEnv>): Promise<string | null> {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [idB64, expStr, sig] = parts as [string, string, string];
  if (!(await hmacVerify(c.env.SESSION_SECRET, `${idB64}.${expStr}`, sig))) return null;
  const expiry = Number(expStr);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return null;
  return new TextDecoder().decode(base64UrlToBytes(idB64));
}

/** 30d sliding renewal — call from middleware when a session is still valid. */
export async function slideSession(c: Context<HonoEnv>, userId: string): Promise<void> {
  await setSessionCookie(c, userId);
}

// ── oauth state (spec 02 §3) ────────────────────────────────────────────────

export interface OAuthStatePayload {
  state: string;
  verifier: string;
}

export async function setOAuthCookie(
  c: Context<HonoEnv>,
  payload: OAuthStatePayload
): Promise<void> {
  const expiry = Math.floor(Date.now() / 1000) + OAUTH_TTL_SEC;
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const enc = `${body}.${expiry}`;
  const sig = await hmacSign(c.env.SESSION_SECRET, enc);
  c.header("Set-Cookie", cookieHeader(OAUTH_COOKIE, `${enc}.${sig}`, OAUTH_TTL_SEC));
}

export async function readOAuthCookie(c: Context<HonoEnv>): Promise<OAuthStatePayload | null> {
  const raw = getCookie(c, OAUTH_COOKIE);
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [body, expStr, sig] = parts as [string, string, string];
  if (!(await hmacVerify(c.env.SESSION_SECRET, `${body}.${expStr}`, sig))) return null;
  const expiry = Number(expStr);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return null;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(body));
    const parsed = JSON.parse(json) as OAuthStatePayload;
    if (typeof parsed.state !== "string" || typeof parsed.verifier !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearOAuthCookie(c: Context<HonoEnv>): void {
  c.header("Set-Cookie", clearHeader(OAUTH_COOKIE));
}

// ── cookie parsing ──────────────────────────────────────────────────────────

export function getCookie(c: Context<HonoEnv>, name: string): string | null {
  const header = c.req.header("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return part.slice(idx + 1).trim();
  }
  return null;
}
