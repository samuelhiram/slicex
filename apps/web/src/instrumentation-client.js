import * as Sentry from '@sentry/nextjs';
export function initClientSentry() {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
        Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN });
    }
}
