import { Hono } from "hono";
import * as Sentry from "@sentry/cloudflare";
import { ERROR_CODES, makeErrorEnvelope } from "@slicex/contracts";
import type { Env, Variables } from "./env";
import { createLogger } from "./logger";
import { health } from "./routes/health";
import { timelines } from "./routes/timelines";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (c, next) => {
  const requestId =
    c.req.header("x-request-id") ?? crypto.randomUUID();
  const logger = createLogger(c.env.LOG_LEVEL ?? "info", { requestId });
  c.set("requestId", requestId);
  c.set("logger", logger);

  const start = Date.now();
  try {
    await next();
  } finally {
    const ms = Date.now() - start;
    logger.info(
      {
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: c.res?.status,
        ms,
      },
      "request",
    );
  }
});

app.onError((err, c) => {
  const requestId = c.get("requestId");
  const logger = c.get("logger");
  logger?.error(
    { err: err instanceof Error ? err.stack ?? err.message : String(err) },
    "unhandled worker error",
  );
  return Response.json(
    makeErrorEnvelope(
      ERROR_CODES.INTERNAL_UNEXPECTED,
      "Unexpected error",
      undefined,
      requestId,
    ),
    { status: 500 },
  );
});

app.route("/api", health);
app.route("/api", timelines);

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

const handler: ExportedHandler<Env> = {
  fetch: app.fetch,
};

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    release: env.SENTRY_RELEASE,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(env.SENTRY_TRACES_SAMPLE_RATE)
      : 0,
  }),
  handler,
);
