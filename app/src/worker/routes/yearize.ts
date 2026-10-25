import { Hono } from "hono";
import type { HonoEnv } from "../env";

const yearize = new Hono<HonoEnv>();

yearize.all("*", (c) =>
  c.json({ error: { code: "not_implemented", message: "yearize lands with tasks T09/T10" } }, 501)
);

export default yearize;
