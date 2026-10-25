import { Hono } from "hono";
import type { HonoEnv } from "../env";

const cards = new Hono<HonoEnv>();

cards.all("*", (c) =>
  c.json({ error: { code: "not_implemented", message: "cards land with task T11" } }, 501)
);

export default cards;
