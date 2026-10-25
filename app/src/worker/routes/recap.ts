/**
 * One-click recap (spec 06): GET /preview composes the deterministic recap
 * text, lists channels, and reports write-scope state; POST /queue is the
 * product's SINGLE Buffer write — grep-proof: the only createPost call site
 * in the entire codebase lives in this file (spec 06 §5).
 *
 * Queue semantics (spec 06 §3): client-generated queueId + 24h KV
 * idempotency so a double-submit replays the first result instead of
 * double-posting; per-channel results (no all-or-nothing); 5 queue
 * operations/user/day; the audit line carries ids and counts only — never
 * the post text (privacy).
 */
import { Hono } from "hono";
import type { Env, HonoEnv } from "../env";
import { jsonError } from "../lib/http";
import { BufferApiError, createBufferClient } from "../lib/buffer";
import { RefreshError, withAccessToken } from "../lib/refresh";
import { readSessionUserId } from "../lib/session";
import { buildDeck } from "./deck";
import {
  composeRecap,
  hasWriteScope,
  validateRecapText,
  UPGRADE_PATH,
} from "../lib/recap";
import type {
  BufferChannel,
  RecapChannelResult,
  RecapQueueResult,
  RecapPreview,
} from "../../shared/types";

const recap = new Hono<HonoEnv>();

const DAILY_QUEUE_LIMIT = 5; // spec 06 §3: 5 queue operations/user/day
const IDEMPOTENCY_TTL = 86_400; // 24h (spec 06 §3)
const RATE_LIMIT_TTL = 172_800; // 2 days — spans the UTC day boundary

function bufferClientFrom(env: Env) {
  return createBufferClient({
    clientId: env.BUFFER_CLIENT_ID,
    clientSecret: env.BUFFER_CLIENT_SECRET,
    redirectUri: env.BUFFER_REDIRECT_URI,
  });
}

async function readScopes(env: Env, userId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT scopes FROM buffer_tokens WHERE user_id = ?")
    .bind(userId)
    .first<{ scopes: string | null }>();
  return typeof row?.scopes === "string" ? row.scopes : "";
}

/** Map Buffer-transport failures to the typed error shape (spec 01 §5). */
function upstreamError(err: unknown): { status: 401 | 502; code: string; message: string } | null {
  if (err instanceof RefreshError) {
    return {
      status: 401,
      code: "session_expired",
      message: "buffer session expired — reconnect to continue",
    };
  }
  if (err instanceof BufferApiError) {
    return { status: 502, code: "upstream", message: "buffer is unreachable right now" };
  }
  return null;
}

// GET /api/recap/preview → RecapPreview | 401/401/502
recap.get("/preview", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in with buffer to open your recap");

  const year = new Date().getUTCFullYear();
  const { deck, persona } = await buildDeck(c.env, userId, year);

  let channels: BufferChannel[];
  try {
    channels = await withAccessToken(c.env, userId, (token) =>
      bufferClientFrom(c.env).listChannels(token)
    );
  } catch (err) {
    const mapped = upstreamError(err);
    if (mapped) return jsonError(c, mapped.status, mapped.code, mapped.message);
    throw err;
  }

  const scopes = await readScopes(c.env, userId);
  const preview: RecapPreview = {
    text: composeRecap(deck.stats, persona, c.env.APP_ORIGIN),
    channels,
    needsWriteScope: !hasWriteScope(scopes),
    personaUsed: persona !== null,
  };
  return c.json(preview);
});

// POST /api/recap/queue → RecapQueueResult (the single Buffer write, spec 06)
recap.post("/queue", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in with buffer to queue your recap");

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return jsonError(c, 400, "malformed", "request body must be valid json");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return jsonError(c, 400, "malformed", "request body must be a json object");
  }
  const body = raw as {
    text?: unknown;
    channelIds?: unknown;
    consent?: unknown;
    queueId?: unknown;
  };

  // 1 · client-generated queueId (uuid) is required for idempotency
  const queueId = body.queueId;
  if (typeof queueId !== "string" || queueId.length === 0) {
    return jsonError(c, 400, "invalid_queue", "queueId (client-generated uuid) is required");
  }

  // 2 · idempotency FIRST (spec 06 §3): a retried POST replays the stored
  // result verbatim and never touches Buffer again — no double-posting.
  const idempotencyKey = `recap:${queueId}`;
  const stored = await c.env.CACHE.get(idempotencyKey);
  if (stored !== null) {
    try {
      return c.json(JSON.parse(stored) as RecapQueueResult, 200);
    } catch {
      // corrupt marker → fall through and re-execute rather than hard-fail
    }
  }

  // 3 · explicit consent (spec 06 §2: the user saw the exact preview first)
  if (body.consent !== true) {
    return jsonError(c, 400, "consent_required", "explicit consent required — read the preview first");
  }

  // 4 · text (possibly user-edited) is respected verbatim or rejected
  const text = body.text;
  if (typeof text !== "string") {
    return jsonError(c, 400, "text_invalid", "text is required");
  }
  const verdict = validateRecapText(text);
  if (!verdict.ok) {
    return jsonError(c, 400, "text_invalid", verdict.reason);
  }

  // 5 · at least one target channel
  const channelIds = body.channelIds;
  if (!Array.isArray(channelIds)) {
    return jsonError(c, 400, "no_channels", "pick at least one channel");
  }
  const list: unknown[] = channelIds;
  const requested = list.filter((id): id is string => typeof id === "string");
  if (requested.length === 0) {
    return jsonError(c, 400, "no_channels", "pick at least one channel");
  }

  // 6 · 5 queue operations/user/day (KV counter, spec 06 §3)
  const day = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const rateKey = `recap-count:${userId}:${day}`;
  let count = 0;
  const rawCount = await c.env.CACHE.get(rateKey);
  if (rawCount !== null) {
    try {
      const parsed: unknown = JSON.parse(rawCount);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as { count?: unknown }).count === "number"
      ) {
        count = (parsed as { count: number }).count;
      }
    } catch {
      count = 0; // unreadable counter → treat the day as fresh
    }
  }
  if (count >= DAILY_QUEUE_LIMIT) {
    return jsonError(c, 429, "rate_limited", "recap queue limit reached for today");
  }
  await c.env.CACHE.put(rateKey, JSON.stringify({ count: count + 1 }), {
    expirationTtl: RATE_LIMIT_TTL,
  });

  // 7 · write-scope gate → OAuth upgrade hint (spec 06 §5, spec 02 §2; the
  // /api/auth/buffer/upgrade endpoint itself is owned by routes/auth.ts)
  const scopes = await readScopes(c.env, userId);
  if (!hasWriteScope(scopes)) {
    return c.json(
      {
        error: {
          code: "upgrade_required",
          message: "connect with write access to queue the recap",
          upgradeUrl: UPGRADE_PATH,
        },
      },
      403
    );
  }

  // 8 · execute: one listChannels, then sequential per-channel creates.
  // Partial failure stays partial (spec 06 §3: no all-or-nothing).
  let results: RecapChannelResult[];
  try {
    results = await withAccessToken(c.env, userId, async (token) => {
      const client = bufferClientFrom(c.env);
      const channels = await client.listChannels(token);
      const byId = new Map(channels.map((ch) => [ch.id, ch]));
      const out: RecapChannelResult[] = [];
      for (const channelId of requested) {
        const channel = byId.get(channelId);
        if (!channel) {
          out.push({
            channelId,
            service: "",
            ok: false,
            error: { code: "unknown_channel", message: "channel is not connected to your account" },
          });
          continue;
        }
        try {
          const created = await client.createPost(token, { channelId, text, now: true });
          out.push({ channelId, service: channel.service, ok: true, postId: created.id });
        } catch (err) {
          out.push({
            channelId,
            service: channel.service,
            ok: false,
            error: {
              code: "upstream",
              message: err instanceof BufferApiError ? err.message : "buffer rejected the post",
            },
          });
        }
      }
      return out;
    });
  } catch (err) {
    const mapped = upstreamError(err);
    if (mapped) return jsonError(c, mapped.status, mapped.code, mapped.message);
    throw err;
  }

  // 9 · store the idempotency marker for 24h (spec 06 §3)
  const queued: RecapQueueResult = { queueId, results };
  await c.env.CACHE.put(idempotencyKey, JSON.stringify(queued), {
    expirationTtl: IDEMPOTENCY_TTL,
  });

  // 10 · audit: ids + counts only, never the text (spec 06 §3, spec 01 §5)
  const okCount = results.filter((r) => r.ok).length;
  console.log(`recap queued: user=${userId} queueId=${queueId} channels=${requested.length} ok=${okCount}`);

  // 11 · per-channel results drive the ✓/✗ UI (spec 06 §4)
  return c.json(queued, 200);
});

export default recap;
