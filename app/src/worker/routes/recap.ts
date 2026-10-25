import { Hono } from "hono";
import type { HonoEnv } from "../env";

const recap = new Hono<HonoEnv>();

recap.all("*", (c) =>
  c.json({ error: { code: "not_implemented", message: "recap lands with task T16" } }, 501)
);

export default recap;
