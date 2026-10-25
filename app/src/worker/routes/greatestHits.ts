import { Hono } from "hono";
import type { HonoEnv } from "../env";

const greatestHits = new Hono<HonoEnv>();

greatestHits.all("*", (c) =>
  c.json({ error: { code: "not_implemented", message: "greatest hits lands with task T19" } }, 501)
);

export default greatestHits;
