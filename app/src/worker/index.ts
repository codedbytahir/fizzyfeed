/**
 * Hono app mount + static-assets fallback (spec 01 §2). One Worker, one deploy.
 * API lives under /api/*; everything else falls through to ASSETS (SPA).
 */
import { Hono } from "hono";
import type { HonoEnv } from "./env";
import { BRAND_NAME } from "../shared/brand";
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

api.get("/health", (c) =>
  c.json({
    ok: true,
    brand: BRAND_NAME,
    time: new Date().toISOString(),
  })
);

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
