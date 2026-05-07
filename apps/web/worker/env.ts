import type { Logger } from "./logger";

export interface Env {
  ASSETS: Fetcher;
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
  SENTRY_DSN?: string;
  SENTRY_RELEASE?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
  LOG_LEVEL?: string;
}

export type Variables = {
  requestId: string;
  logger: Logger;
};

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
    logger: Logger;
  }
}
