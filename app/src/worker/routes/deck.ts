import { Hono } from "hono";
import type { HonoEnv } from "../env";

const deck = new Hono<HonoEnv>();

deck.all("*", (c) =>
  c.json({ error: { code: "not_implemented", message: "deck lands with task T12" } }, 501)
);

export default deck;
