// Minimal Sentry server config for Next.js
const Sentry = require("@sentry/nextjs");

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || "",
  environment: process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0) || 0,
});

module.exports = Sentry;
