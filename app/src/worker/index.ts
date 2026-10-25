/**
 * Hono app mount + static-assets fallback (spec 01 §2). One Worker, one deploy.
 * API lives under /api/*; everything else falls through to ASSETS (SPA).
 */
import { Hono } from "hono";
import type { HonoEnv } from "./env";
import { BRAND_NAME } from "../shared/brand";
import { originCheck } from "./lib/http";
import { readSessionUserId, slideSession } from "./lib/session";

import auth from "./routes/auth";
import yearize from "./routes/yearize";
import deck from "./routes/deck";
import cards from "./routes/cards";
import persona from "./routes/persona";
import recap from "./routes/recap";
import greatestHits from "./routes/greatestHits";

const api = new Hono<HonoEnv>();

api.use("*", originCheck());

api.get("/health", (c) =>
  c.json({
    ok: true,
    brand: BRAND_NAME,
    time: new Date().toISOString(),
  })
);

// feature routes (each module owns its own auth + validation)
api.route("/auth/buffer", auth);
api.route("/yearize", yearize);
api.route("/deck", deck);
api.route("/cards", cards);
api.route("/persona", persona);
api.route("/recap", recap);
api.route("/greatest-hits", greatestHits);

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
