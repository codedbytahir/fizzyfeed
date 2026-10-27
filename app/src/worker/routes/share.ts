/**
 * Card share (task #5): GET /preview composes the deterministic share text
 * for one deck card, lists channels, and reports write-scope state;
 * POST /queue attaches the card PNG and creates the Buffer posts.
 *
 * Write-scope invariant: consent-gated createPost call sites are recap.ts
 * (recap queue) + share.ts (card share) — both follow the exact same
 * discipline, in the same order: client-generated queueId + 24h KV
 * idempotency (`share:` namespace) so a double-submit replays the first
 * result instead of double-posting; explicit consent; server-side text
 * validation; the write-scope gate BEFORE the daily counter burns; 5 queue
 * operations/user/day; per-channel results (no all-or-nothing); the audit
 * line carries ids and counts only — never the post text, never image bytes.
 */
import { Hono } from "hono";
import type { Env, HonoEnv } from "../env";
import { jsonError } from "../lib/http";
import { BufferApiError, createBufferClient } from "../lib/buffer";
import { RefreshError, withAccessToken } from "../lib/refresh";
import { readSessionUserId } from "../lib/session";
import { getCardPng, loadDeckContext } from "./cards";
import { hasWriteScope, UPGRADE_PATH } from "../lib/recap";
import { composeShareText, validateShareText } from "../lib/share";
import type {
  BufferChannel,
  RecapChannelResult,
  SharePreview,
  ShareQueueResult,
} from "../../shared/types";

const share = new Hono<HonoEnv>();

const DAILY_QUEUE_LIMIT = 5; // mirrors spec 06 §3: 5 queue operations/user/day
const IDEMPOTENCY_TTL = 86_400; // 24h
const RATE_LIMIT_TTL = 172_800; // 2 days — spans the UTC day boundary
const B64_CHUNK = 0x8000; // 32k chars per String.fromCharCode call — stack-safe

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

/** Chunk-safe base64 over a PNG (avoids argument-limit blowups on big cards). */
function pngToBase64(png: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < png.length; i += B64_CHUNK) {
    binary += String.fromCharCode(...png.subarray(i, i + B64_CHUNK));
  }
  return btoa(binary);
}

// GET /api/share/preview?card=N → SharePreview | 401/404/409/401/502
share.get("/preview", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in with buffer to share your cards");

  const raw = c.req.query("card");
  const cardN = typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(cardN) || cardN < 1 || cardN > 7) {
    return jsonError(c, 404, "not_found", "unknown card");
  }

  const { stats, cards: deckCards } = await loadDeckContext(c.env, userId);
  const card = deckCards.find((cd) => cd.n === cardN);
  if (!card) {
    return jsonError(c, 404, "card_unavailable", "card not in your deck yet");
  }
  if (stats.totals.posts === 0) {
    return jsonError(c, 409, "empty_deck", "your deck isn't ready to share yet");
  }

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
  const preview: SharePreview = {
    cardN,
    text: composeShareText(card, stats, c.env.APP_ORIGIN),
    channels,
    needsWriteScope: !hasWriteScope(scopes),
  };
  return c.json(preview);
});

// POST /api/share/queue → ShareQueueResult (consent-gated Buffer write)
share.post("/queue", async (c) => {
  const userId = await readSessionUserId(c);
  if (!userId) return jsonError(c, 401, "no_session", "sign in with buffer to share your cards");

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
    card?: unknown;
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

  // 2 · idempotency FIRST (mirrors routes/recap.ts): a retried POST replays
  // the stored result verbatim and never touches Buffer again.
  const idempotencyKey = `share:${queueId}`;
  const stored = await c.env.CACHE.get(idempotencyKey);
  if (stored !== null) {
    try {
      return c.json(JSON.parse(stored) as ShareQueueResult, 200);
    } catch {
      // corrupt marker → fall through and re-execute rather than hard-fail
    }
  }

  // 3 · explicit consent: the user saw the exact preview first
  if (body.consent !== true) {
    return jsonError(c, 400, "consent_required", "explicit consent required — read the preview first");
  }

  // 4 · the (possibly user-edited) text is respected verbatim or rejected
  const text = body.text;
  if (typeof text !== "string") {
    return jsonError(c, 400, "text_invalid", "text is required");
  }
  const verdict = validateShareText(text);
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

  // 6 · daily counter read (KV, tolerant of a corrupt value)
  const day = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const rateKey = `share-count:${userId}:${day}`;
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

  // 7 · write-scope gate BEFORE the daily counter burns (recap critic r1: a
  // scope-less user must never consume quota). The upgrade endpoint is owned
  // by routes/auth.ts.
  const scopes = await readScopes(c.env, userId);
  if (!hasWriteScope(scopes)) {
    return c.json(
      {
        error: {
          code: "upgrade_required",
          message: "connect with write access to share the card",
          upgradeUrl: UPGRADE_PATH,
        },
      },
      403
    );
  }

  // 8 · card identity + PNG before the quota burns (critic r1: an invalid
  // card or a deck that can't render must never consume a share slot)
  const cardN = body.card;
  if (typeof cardN !== "number" || !Number.isInteger(cardN) || cardN < 1 || cardN > 7) {
    return jsonError(c, 404, "not_found", "unknown card");
  }
  const png = await getCardPng(c.env, userId, cardN);
  if (!png) {
    return jsonError(c, 404, "card_unavailable", "card not in your deck yet");
  }
  const photoBase64 = pngToBase64(png);

  // 9 · rate limit: 5 share queues/user/day — checked after the scope gate
  if (count >= DAILY_QUEUE_LIMIT) {
    return jsonError(c, 429, "rate_limited", "share queue limit reached for today");
  }
  await c.env.CACHE.put(rateKey, JSON.stringify({ count: count + 1 }), {
    expirationTtl: RATE_LIMIT_TTL,
  });

  // 10 · execute: sequential per-channel creates with the card attached.
  // Partial failure stays partial (spec 06 §3 semantics, mirrored).
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
          const created = await client.createPost(token, {
            channelId,
            text,
            now: true,
            media: { photoBase64 },
          });
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

  // 11 · store the idempotency marker for 24h
  const queued: ShareQueueResult = { queueId, results };
  await c.env.CACHE.put(idempotencyKey, JSON.stringify(queued), {
    expirationTtl: IDEMPOTENCY_TTL,
  });

  // 12 · audit: ids + counts only — never the text, never image bytes
  const okCount = results.filter((r) => r.ok).length;
  console.log(
    `card share queued: user=${userId} queueId=${queueId} card=${cardN} channels=${requested.length} ok=${okCount}`
  );

  return c.json(queued, 200);
});

export default share;
