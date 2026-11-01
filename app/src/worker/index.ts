/**
 * Hono app mount + static-assets fallback (spec 01 §2). One Worker, one deploy.
 * API lives under /api/*; everything else falls through to ASSETS (SPA).
 */
import { Hono } from "hono";
import type { HonoEnv } from "./env";
import { BRAND_NAME } from "../shared/brand";
import { assertBase64Key, base64Decode } from "./lib/crypto";
import { originCheck } from "./lib/http";
import { rateLimit } from "./lib/ratelimit";
import { readSessionUserId, slideSession } from "./lib/session";

import auth from "./routes/auth";
import yearize from "./routes/yearize";
import deck from "./routes/deck";
import cards from "./routes/cards";
import persona from "./routes/persona";
import recap from "./routes/recap";
import greatestHits from "./routes/greatestHits";
import share from "./routes/share"; // parallel-agent module (lands before integration)
import shareLink, { sharePublic } from "./routes/sharePage"; // parallel-agent module

const api = new Hono<HonoEnv>();

api.use("*", originCheck());

// per-IP edge rate limits — the outer IP layer; per-user debounces live in routes
api.use("/auth/*", rateLimit("auth"));
api.use("/recap/queue", rateLimit("write"));
api.use("/share/queue", rateLimit("write"));
api.use("/share-link/*", rateLimit("write"));
api.use("/yearize/*", rateLimit("write"));
api.use("*", rateLimit("read")); // catch-all read/unknown, health exempt inside

// config probe (ops): secrets are write-only, so a malformed key otherwise only
// surfaces as an unexplained 500 deep inside the oauth callback (seen live
// 2026-11-01). Surfacing it here makes `curl /api/health` the first thing to
// check — 200 = key material parses, 500 = fix the secret before anything else.
api.get("/health", async (c) => {
  const configError = await (async () => {
    try {
      assertBase64Key(c.env.TOKEN_AES_KEY, 32);
      base64Decode(c.env.SESSION_SECRET); // parse-only: length is "≥ 32 bytes" per spec 01
      if (!c.env.BUFFER_CLIENT_ID) return "BUFFER_CLIENT_ID missing";
      return null;
    } catch (err) {
      return `key material malformed: ${(err as Error).message}`;
    }
  })();
  if (configError) {
    console.error(`health config error: ${configError}`);
    return c.json({ ok: false, error: { code: "config", message: configError } }, 500);
  }
  return c.json({
    ok: true,
    brand: BRAND_NAME,
    time: new Date().toISOString(),
  });
});

// feature routes (each module owns its own auth + validation)
api.route("/auth", auth); // /api/auth/buffer/*, /api/auth/logout, /api/me, /api/auth/revoke
api.route("/yearize", yearize);
api.route("/deck", deck);
api.route("/cards", cards);
api.route("/persona", persona);
api.route("/recap", recap);
api.route("/greatest-hits", greatestHits);
api.route("/share", share);
api.route("/share-link", shareLink);

// unknown API path → typed 404 (never SPA fallback)
api.notFound((c) => c.json({ error: { code: "not_found", message: "unknown api route" } }, 404));

// unhandled API error → typed 500, message never leaks internals
api.onError((err, c) => {
  console.error(`api error: ${c.req.method} ${c.req.path} :: ${err.message}`);
  return c.json({ error: { code: "internal", message: "internal error" } }, 500);
});

const app = new Hono<HonoEnv>();

app.route("/api", api);

// typed 404 for unknown API paths (must precede the SPA fallback — a mounted
// sub-app's notFound does not stop parent routing in Hono)
app.all("/api/*", (c) =>
  c.json({ error: { code: "not_found", message: "unknown api route" } }, 404)
);

// public share pages (per-IP public class) — must precede the ASSETS fallback;
// bare /u is throttled too so it can't slip through to the unthrottled SPA shell
app.use("/u", rateLimit("public"));
app.use("/u/*", rateLimit("public"));
app.route("/u", sharePublic);

// SPA + static assets fallback (ASSETS binding, SPA not-found handling)
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: unknown, ctx: ExecutionContext) {
    const { runYearizeCron } = await import("./cron/yearize");
    ctx.waitUntil(runYearizeCron(env as import("./env").Env));
  },
} satisfies ExportedHandler<import("./env").Env>;

export { readSessionUserId, slideSession };
