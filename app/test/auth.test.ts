/**
 * Auth route tests (task T06, spec 02): PKCE login redirect, single-use state,
 * callback happy path (rows + AAD-bound ciphertext + both cookies), logout,
 * revoke, /me, and the log-hygiene sentinel (no token material in console).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { ApiError } from "../src/shared/types";
import type { HonoEnv } from "../src/worker/env";
import { unseal } from "../src/worker/lib/crypto";
import auth from "../src/worker/routes/auth";
import {
  asU8,
  cookieIsCleared,
  cookieValue,
  createTestRig,
  FakeExecutionContext,
  getSetCookie,
  jsonResponse,
  type Row,
  type TestRig,
} from "./helpers";

const ACCESS = "at-connect-0123456789abcdef";
const REFRESH = "rt-connect-0123456789abcdef";
const BUFFER_USER_ID = "buffer-ada-1";

function makeApp(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.route("/api/auth", auth);
  return app;
}

function stubBufferFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url = String(input);
    if (url.startsWith("https://api.buffer.com/1/oauth2/token.json")) {
      return jsonResponse({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, scope: "read" });
    }
    if (url.startsWith("https://api.buffer.com/1/user.json")) {
      return jsonResponse({ id: BUFFER_USER_ID, name: "Ada Lovelace", avatar_https: "https://cdn.test/ada.png" });
    }
    if (url.startsWith("https://api.buffer.com/1/profiles.json")) {
      return jsonResponse([
        { id: "ch-1", service: "twitter", service_id: "tw-9", service_username: "ada", avatar_https: "https://cdn.test/ada.png" },
      ]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

interface ConnectResult {
  res: Response;
  sessionCookie: string;
  userId: string;
  fetchMock: ReturnType<typeof vi.fn>;
}

async function login(app: Hono<HonoEnv>, rig: TestRig): Promise<{ res: Response; oauthCookie: string; state: string }> {
  const res = await app.request(
    "/api/auth/buffer/login",
    undefined,
    rig.env,
    new FakeExecutionContext() as unknown as ExecutionContext
  );
  return {
    res,
    oauthCookie: cookieValue(res, "fb_oauth"),
    state: new URL(res.headers.get("Location") ?? "").searchParams.get("state") ?? "",
  };
}

/** Full connect flow: login → callback with mocked Buffer, backfill kick settled. */
async function connect(app: Hono<HonoEnv>, rig: TestRig): Promise<ConnectResult> {
  const fetchMock = stubBufferFetch();
  const ec = new FakeExecutionContext();
  const loginRes = await login(app, rig);
  const res = await app.request(
    `/api/auth/buffer/callback?state=${encodeURIComponent(loginRes.state)}&code=auth-code-1`,
    { headers: { Cookie: loginRes.oauthCookie } },
    rig.env,
    ec as unknown as ExecutionContext
  );
  await ec.settle();
  return { res, sessionCookie: cookieValue(res, "fizzy_session"), userId: [...rig.db.tokens.keys()][0] ?? "", fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/auth/buffer/login", () => {
  it("302s to the Buffer authorize URL with state + PKCE challenge and sets fb_oauth", async () => {
    const rig = createTestRig();
    const app = makeApp();
    const { res } = await login(app, rig);

    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location") ?? "");
    expect(`${loc.origin}${loc.pathname}`).toBe("https://buffer.com/oauth2/authorize");
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.get("client_id")).toBe("test-client");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://app.test/api/auth/buffer/callback");
    expect(loc.searchParams.get("scope")).toBe("read");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(loc.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const oauthSet = getSetCookie(res).find((c) => c.startsWith("fb_oauth=")) ?? "";
    expect(oauthSet).toContain("HttpOnly");
    expect(oauthSet).toContain("Secure");
    expect(oauthSet).toContain("SameSite=Lax");
    expect(oauthSet).toContain("Max-Age=300");
  });
});

describe("GET /api/auth/buffer/callback", () => {
  it("rejects a callback without the state cookie → 400 invalid_state", async () => {
    const rig = createTestRig();
    const app = makeApp();
    const res = await app.request(
      "/api/auth/buffer/callback?state=whatever&code=code-1",
      undefined,
      rig.env,
      new FakeExecutionContext() as unknown as ExecutionContext
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("invalid_state");
  });

  it("rejects a mismatched state → 400 invalid_state and still consumes the cookie", async () => {
    const rig = createTestRig();
    const app = makeApp();
    const { oauthCookie } = await login(app, rig);
    const res = await app.request(
      "/api/auth/buffer/callback?state=tampered-state&code=code-1",
      { headers: { Cookie: oauthCookie } },
      rig.env,
      new FakeExecutionContext() as unknown as ExecutionContext
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("invalid_state");
    expect(cookieIsCleared(res, "fb_oauth")).toBe(true);
  });

  it("connects: 302 /app, session + cleared oauth cookies, rows written, AAD-bound ciphertext", async () => {
    const rig = createTestRig();
    const app = makeApp();
    const { res, userId, fetchMock } = await connect(app, rig);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://app.test/app");
    expect(cookieIsCleared(res, "fb_oauth")).toBe(true);
    const sessionSet = getSetCookie(res).find((c) => c.startsWith("fizzy_session=")) ?? "";
    expect(sessionSet).not.toContain("Max-Age=0");

    // PKCE exchange really sent the authorization_code form
    const tokenCall = fetchMock.mock.calls.find((c) => String(c[0]).startsWith("https://api.buffer.com/1/oauth2/token.json"));
    const form = new URLSearchParams(String(tokenCall?.[1]?.body ?? ""));
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("auth-code-1");
    expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(form.get("client_id")).toBe("test-client");
    expect(form.get("redirect_uri")).toBe("https://app.test/api/auth/buffer/callback");

    // users + tokens + sync_state rows exist
    const user = rig.db.users.get(BUFFER_USER_ID) as Row;
    expect(user["display_name"]).toBe("Ada Lovelace");
    expect(user["avatar_url"]).toBe("https://cdn.test/ada.png");
    expect(userId).toBe(user["id"]);
    const tokenRow = rig.db.tokens.get(userId) as Row;
    expect(tokenRow["scopes"]).toBe("read");
    expect(rig.db.syncState.get(userId)?.["backfill_done"]).toBe(0);

    // ciphertext ≠ plaintext, unsealable only with AAD=userId
    const ct = asU8(tokenRow["access_enc"]);
    expect(Array.from(ct.slice(0, 16)).map((b) => String.fromCharCode(b)).join("")).not.toContain(ACCESS);
    const iv = asU8(tokenRow["iv"]);
    const salt = asU8(tokenRow["salt"]);
    expect(await unseal(rig.env.TOKEN_AES_KEY, { iv, salt, ct }, userId)).toBe(ACCESS);
    await expect(unseal(rig.env.TOKEN_AES_KEY, { iv, salt, ct }, "other-user")).rejects.toThrow();
  });

  it("is single-use: a replayed callback (cookie consumed) fails with 400", async () => {
    const rig = createTestRig();
    const app = makeApp();
    stubBufferFetch(); // first callback performs the real token + profile exchanges
    const { oauthCookie, state } = await login(app, rig);
    const url = `/api/auth/buffer/callback?state=${encodeURIComponent(state)}&code=auth-code-1`;
    const ec = new FakeExecutionContext();
    const first = await app.request(url, { headers: { Cookie: oauthCookie } }, rig.env, ec as unknown as ExecutionContext);
    expect(first.status).toBe(302);
    // the 302 cleared fb_oauth (Max-Age=0) — a real browser replays WITHOUT it
    expect(cookieIsCleared(first, "fb_oauth")).toBe(true);
    const second = await app.request(url, undefined, rig.env, ec as unknown as ExecutionContext);
    expect(second.status).toBe(400);
    const body = (await second.json()) as ApiError;
    expect(body.error.code).toBe("invalid_state");
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the session cookie with 204", async () => {
    const rig = createTestRig();
    const app = makeApp();
    const res = await app.request(
      "/api/auth/logout",
      { method: "POST" },
      rig.env,
      new FakeExecutionContext() as unknown as ExecutionContext
    );
    expect(res.status).toBe(204);
    expect(cookieIsCleared(res, "fizzy_session")).toBe(true);
  });
});

describe("POST /api/auth/revoke", () => {
  it("requires a session", async () => {
    const rig = createTestRig();
    const app = makeApp();
    const res = await app.request("/api/auth/revoke", { method: "POST" }, rig.env, new FakeExecutionContext() as unknown as ExecutionContext);
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("no_session");
  });

  it("deletes token + sync_state + metrics rows and clears the session", async () => {
    const rig = createTestRig();
    const app = makeApp();
    const { sessionCookie, userId } = await connect(app, rig);
    rig.db.metricsTokens.set(userId, { user_id: userId, pat_enc: new Uint8Array([1, 2]), iv: new Uint8Array(12), salt: new Uint8Array(16), created_at: 0, revoked_at: null });

    const res = await app.request(
      "/api/auth/revoke",
      { method: "POST", headers: { Cookie: sessionCookie } },
      rig.env,
      new FakeExecutionContext() as unknown as ExecutionContext
    );
    expect(res.status).toBe(204);
    expect(rig.db.tokens.has(userId)).toBe(false);
    expect(rig.db.syncState.has(userId)).toBe(false);
    expect(rig.db.metricsTokens.has(userId)).toBe(false);
    expect(cookieIsCleared(res, "fizzy_session")).toBe(true);
  });
});

describe("GET /api/auth/me", () => {
  it("401 no_session without a session cookie", async () => {
    const rig = createTestRig();
    const app = makeApp();
    const res = await app.request("/api/auth/me", undefined, rig.env, new FakeExecutionContext() as unknown as ExecutionContext);
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("no_session");
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it("returns the MeResponse with decrypted-token channels", async () => {
    const rig = createTestRig();
    const app = makeApp();
    const { sessionCookie, userId, fetchMock } = await connect(app, rig);

    const res = await app.request(
      "/api/auth/me",
      { headers: { Cookie: sessionCookie } },
      rig.env,
      new FakeExecutionContext() as unknown as ExecutionContext
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      displayName: string;
      avatarUrl?: string;
      channels: { id: string; service: string; serviceId: string; name: string; avatarUrl?: string }[];
      connected: boolean;
      backfillDone: boolean;
    };
    expect(body.id).toBe(userId);
    expect(body.displayName).toBe("Ada Lovelace");
    expect(body.avatarUrl).toBe("https://cdn.test/ada.png");
    expect(body.connected).toBe(true);
    expect(body.backfillDone).toBe(false);
    expect(body.channels[0]).toEqual({
      id: "ch-1",
      service: "twitter",
      serviceId: "tw-9",
      name: "ada",
      avatarUrl: "https://cdn.test/ada.png",
    });

    // the sealed access token was decrypted from D1 and used for the Buffer call
    const profilesCall = fetchMock.mock.calls.find((c) => String(c[0]).startsWith("https://api.buffer.com/1/profiles.json"));
    expect(String(profilesCall?.[0])).toContain(`access_token=${ACCESS}`);
  });
});

describe("log hygiene sentinel (spec 01 §5)", () => {
  it("never puts token material into console.log/console.error", async () => {
    const rig = createTestRig();
    const app = makeApp();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { res } = await connect(app, rig);
    expect(res.status).toBe(302);

    // the spies were live and captured something (connect + backfill kick)
    const captured = [...logSpy.mock.calls, ...errSpy.mock.calls].map((args) =>
      args.map((a) => String(a)).join(" ")
    );
    expect(captured.length).toBeGreaterThan(0);

    // ZERO console calls contain the access or refresh token plaintext
    const joined = captured.join("\n");
    expect(joined).not.toContain(ACCESS);
    expect(joined).not.toContain(REFRESH);
  });
});
