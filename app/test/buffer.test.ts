/**
 * Buffer API client tests (task T08, GraphQL migration): query routing,
 * variable payloads, PKCE authorize URL, form-encoded token endpoints,
 * cursor hasMore stop rule, and error mapping (502 / preserved 401).
 * Global fetch is stubbed with canned GraphQL responses per query name.
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
const API_URL = BUFFER_ENDPOINTS.apiBase;

const makeClient = () =>
  createBufferClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
  });

const client = makeClient();

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

function bodyOf(call: FetchCall | undefined): { query: string; variables: Record<string, unknown> } {
  return JSON.parse(String(call?.init?.body ?? "{}"));
}

function gqlName(call: FetchCall | undefined): string {
  const q = bodyOf(call).query;
  const m = /\b(?:query|mutation)\s+(\w+)/.exec(q);
  return m?.[1] ?? "";
}

function gqlData(data: unknown): Response {
  return jsonResponse({ data });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const ORG_OK = { account: { organizations: [{ id: "org-1" }] } };

describe("authorize url", () => {
  it("emits the full PKCE S256 request", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        scope: "account:read posts:read offline_access",
        state: "st-123",
        codeChallenge: "cc-456",
      })
    );
    expect(`${url.origin}${url.pathname}`).toBe(BUFFER_ENDPOINTS.authzUrl);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe("account:read posts:read offline_access");
    expect(url.searchParams.get("state")).toBe("st-123");
    expect(url.searchParams.get("code_challenge")).toBe("cc-456");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("getProfile", () => {
  it("queries the GraphQL endpoint with a Bearer header and maps account tolerantly", async () => {
    const { calls } = stubFetch((url, init) => {
      expect(url).toBe(API_URL);
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["authorization"]).toBe("Bearer at-a");
      return gqlData({ account: { id: "b-u-1", name: "Ada", avatar: "https://cdn.test/a.png" } });
    });
    const profile = await client.getProfile("at-a");
    expect(profile).toEqual({ id: "b-u-1", name: "Ada", avatar: "https://cdn.test/a.png" });
    expect(calls).toHaveLength(1);
    expect(gqlName(calls[0])).toBe("Profile");
  });

  it("falls back to an empty name and missing avatar", async () => {
    stubFetch(() => gqlData({ account: { id: "b-u-2" } }));
    const profile = await client.getProfile("at-a");
    expect(profile).toEqual({ id: "b-u-2", name: "", avatar: undefined });
  });

  it("throws 502 when the account has no id", async () => {
    stubFetch(() => gqlData({ account: {} }));
    const err = await client.getProfile("at-a").then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(BufferApiError);
    expect((err as BufferApiError).status).toBe(502);
  });
});

describe("listChannels", () => {
  it("resolves the org once, then maps channels (displayName → name)", async () => {
    const { calls } = stubFetch((url, init) => {
      expect(url).toBe(API_URL);
      const name = gqlName({ url, init });
      if (name === "OrgId") return gqlData(ORG_OK);
      if (name === "Channels") {
        const vars = bodyOf({ url, init }).variables;
        expect(vars.input).toEqual({ organizationId: "org-1" });
        return gqlData({
          channels: [
            {
              id: "ch-1",
              service: "twitter",
              serviceId: "tw-9",
              displayName: "ada",
              avatar: "https://cdn.test/ada.png",
            },
            { id: "ch-2", service: "instagram", serviceId: "ig-4", name: "ada.ig" },
            { service: "broken" },
          ],
        });
      }
      throw new Error(`unexpected query ${name}`);
    });
    const channels = await client.listChannels("at-a");
    expect(channels).toEqual([
      { id: "ch-1", service: "twitter", serviceId: "tw-9", name: "ada", avatarUrl: "https://cdn.test/ada.png" },
      { id: "ch-2", service: "instagram", serviceId: "ig-4", name: "ada.ig", avatarUrl: undefined },
    ]);
    expect(calls).toHaveLength(2);

    // second call on the SAME client reuses the cached org id
    await client.listChannels("at-a");
    expect(calls).toHaveLength(3);
    expect(gqlName(calls[2])).toBe("Channels");
  });

  it("returns no channels when the account has no organizations", async () => {
    const { calls } = stubFetch(() => gqlData({ account: { organizations: [] } }));
    const channels = await client.listChannels("at-a");
    expect(channels).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe("listPosts", () => {
  const since = 1_700_000_000;
  const iso = (s: number) => new Date(s * 1000).toISOString();

  function postsPage(nodes: unknown[], hasNextPage: boolean, endCursor = "cur-1"): Response {
    return gqlData({
      posts: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage, endCursor } },
    });
  }

  it("maps nodes, applies the hasMore stop rule, and passes filter + sort variables", async () => {
    const fresh = makeClient();
    const { calls } = stubFetch((url, init) => {
      const name = gqlName({ url, init });
      if (name === "OrgId") return gqlData(ORG_OK);
      if (name === "Posts") {
        const vars = bodyOf({ url, init }).variables;
        expect(vars.first).toBe(2);
        expect(vars.after).toBe("cur-0");
        const input = vars.input as Record<string, unknown>;
        expect(input.organizationId).toBe("org-1");
        expect(input.filter).toEqual({
          status: ["sent"],
          channelIds: ["ch-1"],
          startDate: iso(since),
        });
        expect(input.sort).toEqual([{ field: "createdAt", direction: "desc" }]);
        return postsPage(
          [
            { id: "u1", channelId: "ch-1", channelService: "twitter", text: "newest", sentAt: iso(since + 500) },
            { id: "u2", channelId: "ch-1", channelService: "twitter", text: "older", sentAt: iso(since + 100) },
          ],
          true,
          "cur-next"
        );
      }
      throw new Error("unexpected query");
    });
    const { posts, nextCursor, hasMore } = await fresh.listPosts("at-a", {
      channelId: "ch-1",
      since,
      count: 2,
      cursor: "cur-0",
    });
    expect(hasMore).toBe(true);
    expect(nextCursor).toBe("cur-next");
    expect(posts).toEqual([
      { id: "u1", channelId: "ch-1", service: "twitter", text: "newest", createdAt: since + 500 },
      { id: "u2", channelId: "ch-1", service: "twitter", text: "older", createdAt: since + 100 },
    ]);
    expect(calls).toHaveLength(2);
  });

  it("prefers sentAt over dueAt/createdAt for the post timestamp", async () => {
    stubFetch((url, init) => {
      const name = gqlName({ url, init });
      if (name === "OrgId") return gqlData(ORG_OK);
      return postsPage(
        [{ id: "u1", channelId: "ch-1", channelService: "twitter", text: "x", dueAt: iso(since + 900), createdAt: iso(since + 1) }],
        false
      );
    });
    const { posts } = await client.listPosts("at-a", { channelId: "ch-1", since });
    expect(posts[0]?.createdAt).toBe(since + 900);
  });

  it("stops when the oldest post is older than since", async () => {
    stubFetch((url, init) => {
      const name = gqlName({ url, init });
      if (name === "OrgId") return gqlData(ORG_OK);
      return postsPage(
        [
          { id: "u1", channelId: "ch-1", channelService: "twitter", text: "newest", sentAt: iso(since + 500) },
          { id: "u2", channelId: "ch-1", channelService: "twitter", text: "too old", sentAt: iso(since - 1) },
        ],
        true
      );
    });
    const { hasMore } = await client.listPosts("at-a", { channelId: "ch-1", since, count: 2 });
    expect(hasMore).toBe(false);
  });

  it("stops when Buffer reports the stream exhausted", async () => {
    stubFetch((url, init) => {
      const name = gqlName({ url, init });
      if (name === "OrgId") return gqlData(ORG_OK);
      return postsPage(
        [{ id: "u1", channelId: "ch-1", channelService: "twitter", text: "only", sentAt: iso(since + 500) }],
        false
      );
    });
    const { hasMore } = await client.listPosts("at-a", { channelId: "ch-1", since, count: 2 });
    expect(hasMore).toBe(false);
  });

  it("answers empty when the account has no organizations", async () => {
    stubFetch(() => gqlData({ account: { organizations: [] } }));
    const { posts, hasMore } = await makeClient().listPosts("at-a", { channelId: "ch-1" });
    expect(posts).toEqual([]);
    expect(hasMore).toBe(false);
  });
});

describe("createPost", () => {
  it("share-now mode: sends variables and extracts the post id", async () => {
    const { calls } = stubFetch((url, init) => {
      const name = gqlName({ url, init });
      if (name === "CreatePost") {
        const vars = bodyOf({ url, init }).variables;
        expect(vars.input).toEqual({ channelId: "ch-1", text: "hello year", schedulingType: "automatic", mode: "shareNow" });
        return gqlData({ createPost: { __typename: "PostActionSuccess", post: { id: "post-9" } } });
      }
      throw new Error("unexpected query");
    });
    const created = await client.createPost("at-a", { channelId: "ch-1", text: "hello year", now: true });
    expect(created).toEqual({ id: "post-9" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("custom-scheduled mode sends an ISO dueAt; media becomes an image asset URL", async () => {
    const { calls } = stubFetch((url, init) => {
      const name = gqlName({ url, init });
      if (name === "CreatePost") {
        const vars = bodyOf({ url, init }).variables;
        expect(vars.input).toMatchObject({ mode: "customScheduled", dueAt: new Date(1_700_100_000 * 1000).toISOString() });
        expect((vars.input as Record<string, unknown>)["assets"]).toEqual([
          { image: { url: "https://pub.test/card.png" } },
        ]);
        return gqlData({ createPost: { __typename: "PostActionSuccess", post: { id: "post-later" } } });
      }
      throw new Error("unexpected query");
    });
    const created = await client.createPost("at-a", {
      channelId: "ch-2",
      text: "later",
      scheduledAt: 1_700_100_000,
      media: { photoUrl: "https://pub.test/card.png" },
    });
    expect(created.id).toBe("post-later");
    expect(gqlName(calls[0])).toBe("CreatePost");
  });

  it("default mode is addToQueue with no dueAt", async () => {
    stubFetch((url, init) => {
      const name = gqlName({ url, init });
      if (name === "CreatePost") {
        const vars = bodyOf({ url, init }).variables;
        expect((vars.input as Record<string, unknown>)["mode"]).toBe("addToQueue");
        expect((vars.input as Record<string, unknown>)["dueAt"]).toBeUndefined();
        return gqlData({ createPost: { __typename: "PostActionSuccess", post: { id: "p1" } } });
      }
      throw new Error("unexpected query");
    });
    await client.createPost("at-a", { channelId: "ch-1", text: "queue me" });
  });

  it("maps a MutationError variant to 502 with a static message", async () => {
    stubFetch(() => gqlData({ createPost: { __typename: "LimitReachedError", message: "Queue limit reached" } }));
    const err = await client
      .createPost("at-a", { channelId: "ch-1", text: "x" })
      .then(
        () => null,
        (e: unknown) => e
      );
    expect(err).toBeInstanceOf(BufferApiError);
    expect((err as BufferApiError).status).toBe(502);
    expect((err as BufferApiError).message).not.toContain("Queue limit");
  });
});

describe("refreshAccessToken", () => {
  it("sends grant_type + client credentials (no redirect_uri) and maps the TokenPair", async () => {
    const { calls } = stubFetch((url) => {
      expect(url).toBe(TOKEN_URL);
      return jsonResponse({ access_token: "at-new", refresh_token: "rt-new", expires_in: 7200, scope: "posts:read" });
    });
    const pair = await client.refreshAccessToken("rt-old");
    expect(pair).toEqual({ accessToken: "at-new", refreshToken: "rt-new", expiresIn: 7200, scope: "posts:read" });
    const form = new URLSearchParams(String(calls[0]?.init?.body ?? ""));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("rt-old");
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.get("client_secret")).toBe(CLIENT_SECRET);
    expect(form.get("redirect_uri")).toBeNull();
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
      jsonResponse({ access_token: "at-x", refresh_token: "rt-x", expires_in: 3600, scope: "account:read" })
    );
    const pair = await exchangeCodeForTokens({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      code: "code-1",
      codeVerifier: "v".repeat(64),
    });
    expect(pair.accessToken).toBe("at-x");
    const form = new URLSearchParams(String(calls[0]?.init?.body ?? ""));
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

  it("maps a 200 response carrying GraphQL errors to 502", async () => {
    stubFetch(() => jsonResponse({ errors: [{ message: "something broke" }] }));
    const err = await client.getProfile("at-a").then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(BufferApiError);
    expect((err as BufferApiError).status).toBe(502);
    expect((err as BufferApiError).message).not.toContain("something broke");
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
