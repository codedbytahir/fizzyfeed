/**
 * Typed Buffer API client (spec 01 §2, spec 02 §5, task T08).
 *
 * Endpoint constants live HERE and only here (spec 02 §1). The client is a
 * factory: auth.ts and refresh.ts build it per-request from env, so no client
 * id/secret ever appears in code. createPost accepts an optional
 * input.media.photoBase64 and forwards it as the `media[photo]` form field
 * (card share path — routes/share.ts attaches the rendered card PNG). This
 * module never logs — tokens and post text must never reach the console
 * (spec 01 §5).
 *
 * Error mapping: any upstream non-2xx or network failure throws BufferApiError.
 * A Buffer 401 keeps status 401 (refresh.ts keys the reactive refresh off it);
 * every other upstream failure maps to status 502 with the real status stored
 * in `upstreamStatus`. Error messages are static strings — Buffer response
 * bodies are never echoed back (they could carry token material).
 */
import type {
  BufferChannel,
  BufferClient,
  BufferPost,
  BufferProfile,
  CreatePostInput,
  TokenPair,
} from "../../shared/types";

export const BUFFER_ENDPOINTS = {
  authzUrl: "https://buffer.com/oauth2/authorize",
  tokenUrl: "https://api.buffer.com/1/oauth2/token.json",
  apiBase: "https://api.buffer.com/1",
} as const;

export class BufferApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public upstreamStatus?: number
  ) {
    super(message);
    this.name = "BufferApiError";
  }
}

const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded" } as const;

export interface BufferClientOpts {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// ── tolerant JSON helpers (Buffer payloads drift; map defensively) ──────────

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

async function bufferFetch(url: string, init: RequestInit, action: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new BufferApiError(502, `buffer unreachable during ${action}`);
  }
  if (!res.ok) {
    if (res.status === 401) throw new BufferApiError(401, `buffer rejected ${action}`, 401);
    throw new BufferApiError(502, `buffer ${action} failed`, res.status);
  }
  return res;
}

async function bufferJson(res: Response, action: string): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new BufferApiError(502, `buffer ${action} returned invalid json`);
  }
}

function mapTokenResponse(body: unknown, fallbackRefreshToken: string | undefined, action: string): TokenPair {
  const o = asRecord(body);
  const accessToken = str(o.access_token);
  if (!accessToken) throw new BufferApiError(502, `buffer ${action} response missing access_token`);
  // Some refresh responses omit refresh_token — keep the one we have (spec 02 §4 rotation).
  const refreshToken = str(o.refresh_token) ?? fallbackRefreshToken ?? "";
  return {
    accessToken,
    refreshToken,
    expiresIn: num(o.expires_in) ?? 3600,
    scope: str(o.scope) ?? "",
  };
}

// ── authorize URL (login flow, spec 02 §1) ──────────────────────────────────

export interface AuthorizeUrlOpts {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
}

export function buildAuthorizeUrl(opts: AuthorizeUrlOpts): string {
  const url = new URL(BUFFER_ENDPOINTS.authzUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("scope", opts.scope);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// ── token exchange (callback, spec 02 §1) ───────────────────────────────────

export interface ExchangeCodeOpts {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}

export async function exchangeCodeForTokens(opts: ExchangeCodeOpts): Promise<TokenPair> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    code_verifier: opts.codeVerifier,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
  });
  const res = await bufferFetch(BUFFER_ENDPOINTS.tokenUrl, { method: "POST", headers: FORM_HEADERS, body: form.toString() }, "token exchange");
  return mapTokenResponse(await bufferJson(res, "token exchange"), undefined, "token exchange");
}

// ── channel / post mapping ──────────────────────────────────────────────────

function extractProfileList(body: unknown): unknown[] {
  // Buffer answers either a raw array or { success, profiles | channels: [...] }.
  if (Array.isArray(body)) return body;
  const o = asRecord(body);
  const profiles = o["profiles"];
  if (Array.isArray(profiles)) return profiles;
  const channels = o["channels"];
  if (Array.isArray(channels)) return channels;
  return [];
}

function mapChannel(raw: unknown): BufferChannel | null {
  const o = asRecord(raw);
  const id = str(o.id);
  if (!id) return null;
  return {
    id,
    service: str(o.service) ?? "",
    serviceId: str(o.service_id) ?? "",
    name: str(o.service_username) ?? str(o.username) ?? str(o.name) ?? "",
    avatarUrl: str(o.avatar_https) ?? str(o.avatar),
  };
}

async function fetchChannelPostsPage(
  accessToken: string,
  channelId: string,
  count: number,
  page: number,
  since: number
): Promise<{ posts: BufferPost[]; hasMore: boolean }> {
  const url = new URL(`${BUFFER_ENDPOINTS.apiBase}/profiles/${encodeURIComponent(channelId)}/posts.json`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("count", String(count));
  url.searchParams.set("page", String(page));
  const res = await bufferFetch(url.toString(), { method: "GET" }, "posts fetch");
  const body = asRecord(await bufferJson(res, "posts fetch"));
  const updates = Array.isArray(body.updates) ? body.updates : [];
  const posts: BufferPost[] = [];
  for (const raw of updates) {
    const o = asRecord(raw);
    const id = str(o.id);
    if (!id) continue;
    posts.push({
      id,
      channelId: str(o.profile_id) ?? channelId,
      service: str(o.service) ?? "",
      text: str(o.text) ?? "",
      createdAt: num(o.created_at) ?? num(o.due_at) ?? 0,
    });
  }
  // updates come newest-first; page stop rule (spec 03 §2): keep paging only
  // while the page is full AND the oldest post is still inside the since window.
  const oldest = posts.length > 0 ? posts[posts.length - 1] : undefined;
  const hasMore = updates.length === count && oldest !== undefined && oldest.createdAt >= since;
  return { posts, hasMore };
}

function extractCreatedPostId(body: Record<string, unknown>): string | undefined {
  // create.json answers { updates: { "<profile_id>": { id, ... } } } — one entry
  // per target channel; tolerate a flat top-level id too.
  const updates = asRecord(body.updates);
  for (const value of Object.values(updates)) {
    const id = str(asRecord(value).id);
    if (id) return id;
  }
  return str(body.id);
}

// ── the client factory ──────────────────────────────────────────────────────

export function createBufferClient(opts: BufferClientOpts): BufferClient {
  const client: BufferClient = {
    async getProfile(accessToken: string): Promise<BufferProfile> {
      const url = new URL(`${BUFFER_ENDPOINTS.apiBase}/user.json`);
      url.searchParams.set("access_token", accessToken);
      const res = await bufferFetch(url.toString(), { method: "GET" }, "profile fetch");
      const o = asRecord(await bufferJson(res, "profile fetch"));
      const id = str(o.id) ?? str(o.user_id);
      if (!id) throw new BufferApiError(502, "buffer profile response missing id");
      return {
        id,
        name: str(o.name) ?? "",
        avatar: str(o.avatar_https) ?? str(o.avatar),
      };
    },

    async listChannels(accessToken: string): Promise<BufferChannel[]> {
      const url = new URL(`${BUFFER_ENDPOINTS.apiBase}/profiles.json`);
      url.searchParams.set("access_token", accessToken);
      const res = await bufferFetch(url.toString(), { method: "GET" }, "channels fetch");
      const list = extractProfileList(await bufferJson(res, "channels fetch"));
      return list.map(mapChannel).filter((ch): ch is BufferChannel => ch !== null);
    },

    async listPosts(
      accessToken: string,
      listOpts: { channelId?: string; since?: number; until?: number; page?: number; count?: number }
    ): Promise<{ posts: BufferPost[]; hasMore: boolean }> {
      const count = listOpts.count ?? 50;
      const since = listOpts.since ?? 0;
      if (listOpts.channelId) {
        // Heavy backfill (spec 03) ALWAYS passes channelId — this is the paged path.
        return fetchChannelPostsPage(accessToken, listOpts.channelId, count, listOpts.page ?? 1, since);
      }
      // No channelId: page 1 of every channel, merged newest-first. `until` is
      // applied by callers (the API has no server-side until filter here).
      const channels = await client.listChannels(accessToken);
      const pages = await Promise.all(
        channels.map((ch) => fetchChannelPostsPage(accessToken, ch.id, count, 1, since))
      );
      const posts = pages
        .flatMap((p) => p.posts)
        .sort((a, b) => b.createdAt - a.createdAt);
      return { posts, hasMore: pages.some((p) => p.hasMore) };
    },

    async createPost(accessToken: string, input: CreatePostInput): Promise<{ id: string }> {
      const url = new URL(`${BUFFER_ENDPOINTS.apiBase}/updates/create.json`);
      url.searchParams.set("access_token", accessToken);
      // Buffer's create API takes repeated profile_ids[] form params.
      const form = new URLSearchParams();
      form.set("text", input.text);
      form.append("profile_ids[]", input.channelId);
      if (input.scheduledAt !== undefined) form.set("scheduled_at", String(input.scheduledAt));
      if (input.now) form.set("now", "true");
      // card share: the rendered card PNG travels as base64 in media[photo]
      if (input.media) form.set("media[photo]", input.media.photoBase64);
      const res = await bufferFetch(url.toString(), { method: "POST", headers: FORM_HEADERS, body: form.toString() }, "post create");
      const body = asRecord(await bufferJson(res, "post create"));
      const id = extractCreatedPostId(body);
      if (!id) throw new BufferApiError(502, "buffer post create response missing id");
      return { id };
    },

    async refreshAccessToken(refreshToken: string): Promise<TokenPair> {
      const form = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        redirect_uri: opts.redirectUri,
      });
      const res = await bufferFetch(BUFFER_ENDPOINTS.tokenUrl, { method: "POST", headers: FORM_HEADERS, body: form.toString() }, "token refresh");
      return mapTokenResponse(await bufferJson(res, "token refresh"), refreshToken, "token refresh");
    },
  };
  return client;
}
