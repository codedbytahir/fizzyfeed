import { Hono } from "hono";
import type { HonoEnv } from "../env";

const persona = new Hono<HonoEnv>();

persona.all("*", (c) =>
  c.json({ error: { code: "not_implemented", message: "persona lands with task T14" } }, 501)
);

export default persona;
