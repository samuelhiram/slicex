import pino from "pino";
import * as Sentry from "@sentry/nextjs";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "slicex-web" },
});

export function initServerSentry() {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  try {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate:
        Number(
          process.env.SENTRY_TRACES_SAMPLE_RATE ||
            process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ||
            0,
        ) || 0.0,
      release: process.env.SENTRY_RELEASE,
    });
  } catch (e) {
    // ignore Sentry init errors in local dev
  }
}

export function withRequestId(requestId?: string) {
  if (requestId && process.env.SENTRY_DSN) {
    try {
      Sentry.configureScope((scope) => scope.setTag("requestId", requestId));
    } catch (e) {
      // noop
    }
  }
  return logger.child({ requestId });
}

export function captureException(err: any, ctx?: any) {
  try {
    if (process.env.SENTRY_DSN) Sentry.captureException(err);
  } catch (e) {
    // noop
  }
  logger.error({ err, ...ctx }, "captured exception");
}
