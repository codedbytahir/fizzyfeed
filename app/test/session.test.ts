/**
 * T05 — signed-cookie session tests (spec 01 §5, spec 02 §3).
 * Driven end-to-end through a real Hono app: cookies travel via real
 * Set-Cookie → Cookie headers exactly as they would in the Worker. The env
 * stub supplies only SESSION_SECRET (random per run — no secret literals,
 * per agent-check §4). Note: this repo's worker tsconfig has no @types/node,
 * so keys are built with btoa instead of Buffer.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  clearOAuthCookie,
  clearSessionCookie,
  readOAuthCookie,
  readSessionUserId,
  setOAuthCookie,
  setSessionCookie,
  type OAuthStatePayload,
} from "../src/worker/lib/session";
import { bytesToBase64Url, hmacSign, randomToken } from "../src/worker/lib/crypto";
import { OAUTH_COOKIE, SESSION_COOKIE, type Env, type HonoEnv } from "../src/worker/env";

const USER_ID = "user_test_123";
const STATE = randomToken(16);
const VERIFIER = randomToken(32);

/** base64 of `bytes` random bytes — same shape as the real SESSION_SECRET. */
function keyB64(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin);
}

const SESSION_SECRET = keyB64(32);

/** Stub env: the session/oauth helpers only read SESSION_SECRET. */
const env = { SESSION_SECRET } satisfies Partial<Env> as Env;

function buildApp(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();

  app.get("/session/set", async (c) => {
    const ttlRaw = c.req.query("ttl");
    const ttl = ttlRaw === undefined ? undefined : Number(ttlRaw);
    await setSessionCookie(c, USER_ID, ttl);
    return c.body(null, 200);
  });
  app.get("/session/read", async (c) => c.json({ userId: await readSessionUserId(c) }));
  app.get("/session/clear", (c) => {
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  app.get("/oauth/set", async (c) => {
    await setOAuthCookie(c, {
      state: c.req.query("state") ?? STATE,
      verifier: c.req.query("verifier") ?? VERIFIER,
    });
    return c.body(null, 200);
  });
  app.get("/oauth/read", async (c) => c.json({ payload: await readOAuthCookie(c) }));
  app.get("/oauth/clear", (c) => {
    clearOAuthCookie(c);
    return c.body(null, 204);
  });

  return app;
}

const app = buildApp();

function setCookieValue(res: Response, name: string): string {
  const header = res.headers.get("Set-Cookie");
  if (header === null) throw new Error(`no Set-Cookie header (status ${res.status})`);
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  throw new Error(`Set-Cookie has no ${name}= pair: ${header}`);
}

async function readSessionWith(cookiePair: string): Promise<string | null> {
  const res = await app.request("/session/read", { headers: { Cookie: cookiePair } }, env);
  const body = (await res.json()) as { userId: string | null };
  return body.userId;
}

async function readOAuthWith(cookiePair: string): Promise<OAuthStatePayload | null> {
  const res = await app.request("/oauth/read", { headers: { Cookie: cookiePair } }, env);
  const body = (await res.json()) as { payload: OAuthStatePayload | null };
  return body.payload;
}

/** A different string at `index`, staying inside the base64url alphabet. */
function flipCharAt(s: string, index: number): string {
  const ch = s[index];
  if (ch === undefined) throw new Error(`index ${index} out of range`);
  return s.slice(0, index) + (ch === "A" ? "B" : "A") + s.slice(index + 1);
}

/** Validly-signed oauth cookie value with an arbitrary payload/expiry. */
async function signedOAuthValue(json: string, ttlSec: number): Promise<string> {
  const body = bytesToBase64Url(new TextEncoder().encode(json));
  const expiry = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = await hmacSign(SESSION_SECRET, `${body}.${expiry}`);
  return `${body}.${expiry}.${sig}`;
}

describe("session cookie", () => {
  it("set → read returns the same userId", async () => {
    const res = await app.request("/session/set", undefined, env);
    expect(res.status).toBe(200);
    const value = setCookieValue(res, SESSION_COOKIE);
    expect(value.split(".")).toHaveLength(3); // userId.expiry.sig
    await expect(readSessionWith(`${SESSION_COOKIE}=${value}`)).resolves.toBe(USER_ID);
  });

  it("carries the spec 01 §5 flags (HttpOnly, Secure, SameSite=Lax, Path=/, 30d)", async () => {
    const res = await app.request("/session/set", undefined, env);
    const header = res.headers.get("Set-Cookie") ?? "";
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${30 * 24 * 3600}`);
  });

  it("an expired cookie (ttlSec = -10) reads as null", async () => {
    const res = await app.request("/session/set?ttl=-10", undefined, env);
    const value = setCookieValue(res, SESSION_COOKIE);
    await expect(readSessionWith(`${SESSION_COOKIE}=${value}`)).resolves.toBeNull();
  });

  it("a tampered signature segment reads as null", async () => {
    const res = await app.request("/session/set", undefined, env);
    const value = setCookieValue(res, SESSION_COOKIE);
    const tampered = flipCharAt(value, value.length - 1); // sig is the 3rd segment
    expect(tampered).not.toBe(value);
    await expect(readSessionWith(`${SESSION_COOKIE}=${tampered}`)).resolves.toBeNull();
  });

  it("a tampered payload segment reads as null", async () => {
    const res = await app.request("/session/set", undefined, env);
    const value = setCookieValue(res, SESSION_COOKIE);
    const tampered = flipCharAt(value, 0); // first char of the userId segment
    expect(tampered).not.toBe(value);
    await expect(readSessionWith(`${SESSION_COOKIE}=${tampered}`)).resolves.toBeNull();
  });

  it("a garbage cookie value reads as null", async () => {
    await expect(readSessionWith(`${SESSION_COOKIE}=abc`)).resolves.toBeNull();
  });

  it("a missing cookie reads as null", async () => {
    const res = await app.request("/session/read", undefined, env);
    const body = (await res.json()) as { userId: string | null };
    expect(body.userId).toBeNull();
  });
});

describe("oauth state cookie", () => {
  it("set → read round-trips { state, verifier } with the 5-minute window", async () => {
    const res = await app.request(`/oauth/set?state=${STATE}&verifier=${VERIFIER}`, undefined, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=300"); // spec 02 §3
    const value = setCookieValue(res, OAUTH_COOKIE);
    expect(value.split(".")).toHaveLength(3);
    await expect(readOAuthWith(`${OAUTH_COOKIE}=${value}`)).resolves.toEqual({
      state: STATE,
      verifier: VERIFIER,
    });
  });

  it("a wrong signature reads as null", async () => {
    const res = await app.request("/oauth/set", undefined, env);
    const value = setCookieValue(res, OAUTH_COOKIE);
    const tampered = flipCharAt(value, value.length - 1);
    await expect(readOAuthWith(`${OAUTH_COOKIE}=${tampered}`)).resolves.toBeNull();
  });

  it("an expired cookie reads as null (signature itself still valid)", async () => {
    const value = await signedOAuthValue(JSON.stringify({ state: STATE, verifier: VERIFIER }), -10);
    await expect(readOAuthWith(`${OAUTH_COOKIE}=${value}`)).resolves.toBeNull();
  });

  it("a tampered JSON body reads as null", async () => {
    const res = await app.request("/oauth/set", undefined, env);
    const value = setCookieValue(res, OAUTH_COOKIE);
    const tampered = flipCharAt(value, 0); // first char of the payload segment
    expect(tampered).not.toBe(value);
    await expect(readOAuthWith(`${OAUTH_COOKIE}=${tampered}`)).resolves.toBeNull();
  });

  it.each([
    ["state is a number", JSON.stringify({ state: 123, verifier: VERIFIER })],
    ["verifier is null", JSON.stringify({ state: STATE, verifier: null })],
    ["state is missing", JSON.stringify({ verifier: VERIFIER })],
    ["payload is not JSON", "definitely-not-json"],
  ])("rejects invalid payloads (%s)", async (_label, json) => {
    const value = await signedOAuthValue(json, 300); // correctly signed, bad body
    await expect(readOAuthWith(`${OAUTH_COOKIE}=${value}`)).resolves.toBeNull();
  });
});

describe("clearing cookies", () => {
  it("clearSessionCookie emits a Max-Age=0 Set-Cookie header", async () => {
    const res = await app.request("/session/clear", undefined, env);
    expect(res.headers.get("Set-Cookie")).toContain(`${SESSION_COOKIE}=`);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("clearOAuthCookie emits a Max-Age=0 Set-Cookie header", async () => {
    const res = await app.request("/oauth/clear", undefined, env);
    expect(res.headers.get("Set-Cookie")).toContain(`${OAUTH_COOKIE}=`);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
