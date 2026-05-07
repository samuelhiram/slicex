import { createPrismaClient, type PrismaClient } from "@slicex/db";
import type { Env } from "./env";

export function getDb(env: Env): PrismaClient {
  const connectionString =
    env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "No database connection available. Bind HYPERDRIVE or set DATABASE_URL.",
    );
  }

  return createPrismaClient(connectionString);
}
