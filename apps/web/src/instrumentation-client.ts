import * as Sentry from "@sentry/nextjs";

export function initClientSentry() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  try {
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_ENV || process.env.NODE_ENV,
      release:
        process.env.NEXT_PUBLIC_SENTRY_RELEASE || process.env.SENTRY_RELEASE,
      tracesSampleRate:
        Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0) || 0,
    });
  } catch (e) {
    // ignore init problems in dev
  }
}
