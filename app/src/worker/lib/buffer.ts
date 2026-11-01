/**
 * Typed Buffer API client (spec 01 §2, spec 02 §5, task T08 — migrated 2026-11
 * to Buffer's current developer platform: OAuth at auth.buffer.com, GraphQL at
 * api.buffer.com; the legacy REST api.bufferapp.com / api.buffer.com/1 paths
 * no longer serve these flows and answer invalid_client / UNAUTHENTICATED).
 *
 * Endpoint constants live HERE and only here (spec 02 §1). The client is a
 * factory: auth.ts and refresh.ts build it per-request from env, so no client
 * id/secret ever appears in code. The GraphQL API is org-scoped — the client
 * resolves the account's first organization once per instance and reuses it
 * for channels + posts queries. Post text travels in GraphQL variables,
 * never interpolated into the query string. This module never logs — tokens
 * and post text must never reach the console (spec 01 §5).
 *
 * Error mapping: network failures and non-2xx throw BufferApiError (a Buffer
 * 401 keeps status 401 — refresh.ts keys the reactive refresh off it; every
 * other failure maps to 502 with the real status in `upstreamStatus`). HTTP
 * 200 responses carrying a GraphQL `errors` array, and mutation unions that
 * resolve to a MutationError variant, also map to 502. Error messages are
 * static strings — Buffer response bodies are never echoed back (they could
 * carry token material).
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
  authzUrl: "https://auth.buffer.com/auth",
  tokenUrl: "https://auth.buffer.com/token",
  apiBase: "https://api.buffer.com", // single GraphQL endpoint, POST only
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
const JSON_HEADERS = { "content-type": "application/json" } as const;

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

/** GraphQL DateTime (ISO 8601) → unix seconds. */
function isoToUnix(v: unknown): number | undefined {
  if (typeof v !== "string" || v.length === 0) return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
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

interface GqlBody {
  data: Record<string, unknown>;
}

/**
 * One GraphQL round trip against the single api.buffer.com endpoint. Values
 * travel in `variables` (text is never interpolated into the query). A 200
 * response that carries a top-level errors array is still a failure.
 */
async function gql(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  action: string
): Promise<GqlBody["data"]> {
  const res = await bufferFetch(
    BUFFER_ENDPOINTS.apiBase,
    {
      method: "POST",
      headers: { ...JSON_HEADERS, authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ query, variables }),
    },
    action
  );
  const body = asRecord(await bufferJson(res, action));
  if (Array.isArray(body["errors"]) && body["errors"].length > 0) {
    throw new BufferApiError(502, `buffer ${action} failed`);
  }
  const data = body["data"];
  if (typeof data !== "object" || data === null) {
    throw new BufferApiError(502, `buffer ${action} response missing data`);
  }
  return data as Record<string, unknown>;
}

function mapTokenResponse(body: unknown, fallbackRefreshToken: string | undefined, action: string): TokenPair {
  const o = asRecord(body);
  const accessToken = str(o.access_token);
  if (!accessToken) throw new BufferApiError(502, `buffer ${action} response missing access_token`);
  // Refresh responses rotate the refresh token (single-use per current docs);
  // some responses may omit it — keep the one we already hold (spec 02 §4).
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

function mapChannel(raw: unknown): BufferChannel | null {
  const o = asRecord(raw);
  const id = str(o.id);
  if (!id) return null;
  return {
    id,
    service: str(o.service) ?? "",
    serviceId: str(o.serviceId) ?? str(o.service_id) ?? "",
    name: str(o.displayName) ?? str(o.display_name) ?? str(o.name) ?? "",
    avatarUrl: str(o.avatar),
  };
}

const ACCOUNT_ORG_QUERY = `query OrgId { account { organizations { id } } }`;
const CHANNELS_QUERY = `query Channels($input: ChannelsInput!) { channels(input: $input) { id service serviceId displayName name avatar } }`;
const POSTS_QUERY = `query Posts($first: Int, $after: String, $input: PostsInput!) {
  posts(first: $first, after: $after, input: $input) {
    edges { node { id text sentAt dueAt createdAt channelId channelService } }
    pageInfo { hasNextPage endCursor }
  }
}`;
const CREATE_POST_MUTATION = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id } }
    ... on MutationError { message }
  }
}`;

// ── the client factory ──────────────────────────────────────────────────────

export interface BufferClientOpts {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function createBufferClient(opts: BufferClientOpts): BufferClient {
  // The GraphQL API scopes channels/posts by organizationId; the account's
  // first organization is resolved once per client instance and reused.
  // "" caches the "no organizations" answer so we never re-query it.
  let cachedOrgId: string | undefined;
  const defaultOrganizationId = async (accessToken: string): Promise<string> => {
    if (cachedOrgId !== undefined) return cachedOrgId;
    const data = await gql(accessToken, ACCOUNT_ORG_QUERY, {}, "organization lookup");
    const account = asRecord(data["account"]);
    const orgs = Array.isArray(account["organizations"]) ? account["organizations"] : [];
    cachedOrgId = str(asRecord(orgs[0])["id"]) ?? "";
    return cachedOrgId;
  };

  const client: BufferClient = {
    async getProfile(accessToken: string): Promise<BufferProfile> {
      const data = await gql(accessToken, `query Profile { account { id name avatar } }`, {}, "profile fetch");
      const account = asRecord(data["account"]);
      const id = str(account["id"]);
      if (!id) throw new BufferApiError(502, "buffer profile response missing id");
      return {
        id,
        name: str(account["name"]) ?? "",
        avatar: str(account["avatar"]),
      };
    },

    async listChannels(accessToken: string): Promise<BufferChannel[]> {
      const orgId = await defaultOrganizationId(accessToken);
      if (!orgId) return [];
      const data = await gql(accessToken, CHANNELS_QUERY, { input: { organizationId: orgId } }, "channels fetch");
      const list = data["channels"];
      if (!Array.isArray(list)) return [];
      return list.map(mapChannel).filter((ch): ch is BufferChannel => ch !== null);
    },

    async listPosts(
      accessToken: string,
      listOpts: { channelId: string; since?: number; until?: number; cursor?: string; count?: number }
    ): Promise<{ posts: BufferPost[]; nextCursor?: string; hasMore: boolean }> {
      const count = listOpts.count ?? 50;
      const since = listOpts.since ?? 0;
      const orgId = await defaultOrganizationId(accessToken);
      if (!orgId) return { posts: [], hasMore: false };

      const filter: Record<string, unknown> = {
        status: ["sent"],
        channelIds: [listOpts.channelId],
      };
      if (since > 0) filter["startDate"] = new Date(since * 1000).toISOString();
      if (listOpts.until !== undefined && listOpts.until > 0) {
        filter["endDate"] = new Date(listOpts.until * 1000).toISOString();
      }

      const data = await gql(
        accessToken,
        POSTS_QUERY,
        {
          first: count,
          after: listOpts.cursor ?? null,
          input: {
            organizationId: orgId,
            filter,
            sort: [{ field: "createdAt", direction: "desc" }],
          },
        },
        "posts fetch"
      );
      const conn = asRecord(data["posts"]);
      const edges = Array.isArray(conn["edges"]) ? conn["edges"] : [];
      const posts: BufferPost[] = [];
      for (const edge of edges) {
        const node = asRecord(asRecord(edge)["node"]);
        const id = str(node["id"]);
        if (!id) continue;
        posts.push({
          id,
          channelId: str(node["channelId"]) ?? listOpts.channelId,
          service: str(node["channelService"]) ?? "",
          text: str(node["text"]) ?? "",
          createdAt: isoToUnix(node["sentAt"]) ?? isoToUnix(node["dueAt"]) ?? isoToUnix(node["createdAt"]) ?? 0,
        });
      }
      const pageInfo = asRecord(conn["pageInfo"]);
      const hasNextPage = pageInfo["hasNextPage"] === true;
      const endCursor = str(pageInfo["endCursor"]);
      // Posts come newest-first; stop rule (spec 03 §2): keep paging only
      // while the page is full AND the oldest post is still inside the window.
      const oldest = posts.length > 0 ? posts[posts.length - 1] : undefined;
      const hasMore = hasNextPage && oldest !== undefined && oldest.createdAt >= since;
      return { posts, nextCursor: endCursor, hasMore };
    },

    async createPost(accessToken: string, input: CreatePostInput): Promise<{ id: string }> {
      const gqlInput: Record<string, unknown> = {
        channelId: input.channelId,
        text: input.text,
        schedulingType: "automatic",
        mode: input.now ? "shareNow" : input.scheduledAt !== undefined ? "customScheduled" : "addToQueue",
      };
      if (input.scheduledAt !== undefined) {
        gqlInput["dueAt"] = new Date(input.scheduledAt * 1000).toISOString();
      }
      // Buffer hosts no uploads: the image must be a public, stable URL.
      if (input.media) {
        gqlInput["assets"] = [{ image: { url: input.media.photoUrl } }];
      }
      const data = await gql(accessToken, CREATE_POST_MUTATION, { input: gqlInput }, "post create");
      const created = asRecord(data["createPost"]);
      const post = asRecord(created["post"]);
      const id = str(post["id"]);
      if (!id) throw new BufferApiError(502, "buffer post create response missing id");
      return { id };
    },

    async refreshAccessToken(refreshToken: string): Promise<TokenPair> {
      const form = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
      });
      const res = await bufferFetch(BUFFER_ENDPOINTS.tokenUrl, { method: "POST", headers: FORM_HEADERS, body: form.toString() }, "token refresh");
      return mapTokenResponse(await bufferJson(res, "token refresh"), refreshToken, "token refresh");
    },
  };
  return client;
}
