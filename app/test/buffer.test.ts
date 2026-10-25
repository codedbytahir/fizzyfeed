/**
 * Buffer API client tests (task T08): mapping, PKCE authorize URL, form
 * encoding, hasMore stop rule, and error mapping (502 / preserved 401).
 * Global fetch is stubbed with canned JSON per URL pattern.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUFFER_ENDPOINTS,
  BufferApiError,
  buildAuthorizeUrl,
  createBufferClient,
  exchangeCodeForTokens,
} from "../src/worker/lib/buffer";
import { jsonResponse } from "./helpers";

const CLIENT_ID = "test-client";
const CLIENT_SECRET = "test-secret";
const REDIRECT_URI = "https://app.test/api/auth/buffer/callback";
const TOKEN_URL = BUFFER_ENDPOINTS.tokenUrl;

const client = createBufferClient({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  redirectUri: REDIRECT_URI,
});

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  });
  return { calls };
}

function formOf(call: FetchCall | undefined): URLSearchParams {
  return new URLSearchParams(String(call?.init?.body ?? ""));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authorize url", () => {
  it("emits the full PKCE S256 request", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        scope: "read",
        state: "st-123",
        codeChallenge: "cc-456",
      })
    );
    expect(`${url.origin}${url.pathname}`).toBe(BUFFER_ENDPOINTS.authzUrl);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe("read");
    expect(url.searchParams.get("state")).toBe("st-123");
    expect(url.searchParams.get("code_challenge")).toBe("cc-456");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("getProfile", () => {
  it("maps user.json tolerantly and puts the access token in the query", async () => {
    const { calls } = stubFetch((url) => {
      expect(url.startsWith(`${BUFFER_ENDPOINTS.apiBase}/user.json?`)).toBe(true);
      expect(url).toContain("access_token=at-a");
      return jsonResponse({ id: "b-u-1", name: "Ada", avatar_https: "https://cdn.test/a.png" });
    });
    const profile = await client.getProfile("at-a");
    expect(profile).toEqual({ id: "b-u-1", name: "Ada", avatar: "https://cdn.test/a.png" });
    expect(calls).toHaveLength(1);
  });

  it("falls back to user_id/avatar fields when present", async () => {
    stubFetch(() => jsonResponse({ user_id: "b-u-2", name: "Grace", avatar: "https://cdn.test/g.png" }));
    const profile = await client.getProfile("at-a");
    expect(profile).toEqual({ id: "b-u-2", name: "Grace", avatar: "https://cdn.test/g.png" });
  });
});

describe("listChannels", () => {
  it("maps a raw array response (service_id → serviceId, service_username → name)", async () => {
    stubFetch(() =>
      jsonResponse([
        {
          id: "ch-1",
          service: "twitter",
          service_id: "tw-9",
          service_username: "ada",
          avatar_https: "https://cdn.test/ada.png",
        },
        { id: "ch-2", service: "instagram", service_id: "ig-4", service_username: "ada.ig" },
      ])
    );
    const channels = await client.listChannels("at-a");
    expect(channels).toEqual([
      { id: "ch-1", service: "twitter", serviceId: "tw-9", name: "ada", avatarUrl: "https://cdn.test/ada.png" },
      { id: "ch-2", service: "instagram", serviceId: "ig-4", name: "ada.ig", avatarUrl: undefined },
    ]);
  });

  it("accepts the { success, profiles } envelope shape", async () => {
    stubFetch(() =>
      jsonResponse({
        success: true,
        profiles: [{ id: "ch-3", service: "linkedin", service_id: "li-1", service_username: "Ada L" }],
      })
    );
    const channels = await client.listChannels("at-a");
    expect(channels).toHaveLength(1);
    expect(channels[0]?.id).toBe("ch-3");
  });
});

describe("listPosts", () => {
  it("maps updates and applies the hasMore stop rule (full page inside window)", async () => {
    const since = 1_700_000_000;
    const { calls } = stubFetch((url) => {
      expect(url).toContain("/profiles/ch-1/posts.json?");
      expect(url).toContain("count=2");
      expect(url).toContain("page=3");
      expect(url).toContain("access_token=at-a");
      return jsonResponse({
        updates: [
          { id: "u1", profile_id: "ch-1", service: "twitter", text: "newest", created_at: since + 500 },
          { id: "u2", profile_id: "ch-1", service: "twitter", text: "older", created_at: since + 100 },
        ],
      });
    });
    const { posts, hasMore } = await client.listPosts("at-a", { channelId: "ch-1", since, count: 2, page: 3 });
    expect(hasMore).toBe(true);
    expect(posts).toEqual([
      { id: "u1", channelId: "ch-1", service: "twitter", text: "newest", createdAt: since + 500 },
      { id: "u2", channelId: "ch-1", service: "twitter", text: "older", createdAt: since + 100 },
    ]);
    expect(calls).toHaveLength(1);
  });

  it("stops when the oldest post is older than since", async () => {
    const since = 1_700_000_000;
    stubFetch(() =>
      jsonResponse({
        updates: [
          { id: "u1", profile_id: "ch-1", service: "twitter", text: "newest", created_at: since + 500 },
          { id: "u2", profile_id: "ch-1", service: "twitter", text: "too old", created_at: since - 1 },
        ],
      })
    );
    const { hasMore } = await client.listPosts("at-a", { channelId: "ch-1", since, count: 2, page: 2 });
    expect(hasMore).toBe(false);
  });

  it("stops on a partial page even when everything is inside the window", async () => {
    stubFetch(() =>
      jsonResponse({
        updates: [{ id: "u1", profile_id: "ch-1", service: "twitter", text: "only", created_at: 1_700_000_500 }],
      })
    );
    const { hasMore } = await client.listPosts("at-a", { channelId: "ch-1", since: 0, count: 2, page: 1 });
    expect(hasMore).toBe(false);
  });

  it("without channelId iterates channels and merges newest-first", async () => {
    stubFetch((url) => {
      if (url.startsWith(`${BUFFER_ENDPOINTS.apiBase}/profiles.json`)) {
        return jsonResponse([
          { id: "ch-a", service: "twitter", service_id: "a", service_username: "ada" },
          { id: "ch-b", service: "instagram", service_id: "b", service_username: "ada.ig" },
        ]);
      }
      if (url.includes("/profiles/ch-a/posts.json")) {
        return jsonResponse({ updates: [{ id: "a1", profile_id: "ch-a", service: "twitter", text: "a", created_at: 100 }] });
      }
      if (url.includes("/profiles/ch-b/posts.json")) {
        return jsonResponse({ updates: [{ id: "b1", profile_id: "ch-b", service: "instagram", text: "b", created_at: 200 }] });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { posts } = await client.listPosts("at-a", { count: 10 });
    expect(posts.map((p) => p.id)).toEqual(["b1", "a1"]);
  });
});

describe("createPost", () => {
  it("posts the form-encoded fields with access_token in the query and extracts the id", async () => {
    const { calls } = stubFetch((url) => {
      expect(url.startsWith(`${BUFFER_ENDPOINTS.apiBase}/updates/create.json?`)).toBe(true);
      expect(url).toContain("access_token=at-a");
      return jsonResponse({ success: true, updates: { "ch-1": { id: "update-9" } } });
    });
    const created = await client.createPost("at-a", { channelId: "ch-1", text: "hello year", now: true });
    expect(created).toEqual({ id: "update-9" });
    expect(calls[0]?.init?.method).toBe("POST");
    const form = formOf(calls[0]);
    expect(form.get("text")).toBe("hello year");
    expect(form.get("profile_ids[]")).toBe("ch-1");
    expect(form.get("now")).toBe("true");
  });

  it("supports scheduled_at and a flat top-level id response", async () => {
    const { calls } = stubFetch(() => jsonResponse({ success: true, id: "update-flat" }));
    const created = await client.createPost("at-a", { channelId: "ch-2", text: "later", scheduledAt: 1_700_100_000 });
    expect(created.id).toBe("update-flat");
    const form = formOf(calls[0]);
    expect(form.get("scheduled_at")).toBe("1700100000");
    expect(form.get("now")).toBeNull();
  });
});

describe("refreshAccessToken", () => {
  it("sends grant_type + client credentials and maps the TokenPair", async () => {
    const { calls } = stubFetch((url) => {
      expect(url).toBe(TOKEN_URL);
      return jsonResponse({ access_token: "at-new", refresh_token: "rt-new", expires_in: 7200, scope: "read" });
    });
    const pair = await client.refreshAccessToken("rt-old");
    expect(pair).toEqual({ accessToken: "at-new", refreshToken: "rt-new", expiresIn: 7200, scope: "read" });
    const form = formOf(calls[0]);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("rt-old");
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.get("client_secret")).toBe(CLIENT_SECRET);
    expect(form.get("redirect_uri")).toBe(REDIRECT_URI);
  });

  it("keeps the previous refresh token when the response omits one", async () => {
    stubFetch(() => jsonResponse({ access_token: "at-new", expires_in: 3600 }));
    const pair = await client.refreshAccessToken("rt-old");
    expect(pair.refreshToken).toBe("rt-old");
  });
});

describe("exchangeCodeForTokens", () => {
  it("posts the authorization_code form and maps the pair", async () => {
    const { calls } = stubFetch(() =>
      jsonResponse({ access_token: "at-x", refresh_token: "rt-x", expires_in: 3600, scope: "read" })
    );
    const pair = await exchangeCodeForTokens({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      code: "code-1",
      codeVerifier: "v".repeat(64),
    });
    expect(pair.accessToken).toBe("at-x");
    const form = formOf(calls[0]);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("code-1");
    expect(form.get("code_verifier")).toBe("v".repeat(64));
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.get("client_secret")).toBe(CLIENT_SECRET);
    expect(form.get("redirect_uri")).toBe(REDIRECT_URI);
  });
});

describe("error mapping", () => {
  it("maps upstream 500 to BufferApiError 502 with the upstream status kept", async () => {
    stubFetch(() => jsonResponse({ error: "boom" }, 500));
    const err = await client.getProfile("at-a").then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(BufferApiError);
    const apiErr = err as BufferApiError;
    expect(apiErr.status).toBe(502);
    expect(apiErr.upstreamStatus).toBe(500);
    // static message — response bodies are never echoed (token hygiene)
    expect(apiErr.message).not.toContain("boom");
  });

  it("preserves a Buffer 401 as status 401", async () => {
    stubFetch(() => jsonResponse({ error: "nope" }, 401));
    const err = await client.listChannels("at-a").then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(BufferApiError);
    expect((err as BufferApiError).status).toBe(401);
  });

  it("maps network failure to BufferApiError 502", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("dns fail");
    });
    const err = await client.listPosts("at-a", { channelId: "ch-1" }).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(BufferApiError);
    expect((err as BufferApiError).status).toBe(502);
    expect((err as BufferApiError).upstreamStatus).toBeUndefined();
  });
});
