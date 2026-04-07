import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
	throw new Error("DATABASE_URL is required to initialize PrismaClient");
}

const adapter = new PrismaPg({ connectionString });

declare global {
	// eslint-disable-next-line no-var
	var __slicexPrisma: PrismaClient | undefined;
}

const prisma = globalThis.__slicexPrisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") globalThis.__slicexPrisma = prisma;

export default prisma;
