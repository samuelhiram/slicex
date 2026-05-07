import { Hono } from "hono";
import type { Env, Variables } from "../env";

export const health = new Hono<{ Bindings: Env; Variables: Variables }>();

health.get("/health", (c) => {
  return c.json({ ok: true });
});

health.get("/internal/keepalive", (c) => {
  return c.json({ ok: true });
});
