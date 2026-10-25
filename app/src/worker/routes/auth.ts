/**
 * Route module placeholder — replaced by its owning task.
 * Every route file keeps this shape: `export default new Hono<HonoEnv>()`.
 */
import { Hono } from "hono";
import type { HonoEnv } from "../env";

const auth = new Hono<HonoEnv>();

auth.all("*", (c) =>
  c.json({ error: { code: "not_implemented", message: "auth lands with task T06" } }, 501)
);

export default auth;
