import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

declare global {
	// eslint-disable-next-line no-var
	var __slicexPrisma: PrismaClient | undefined;
}

export function createPrismaClient(connectionString?: string): PrismaClient {
	const cs =
		connectionString ??
		(typeof process !== "undefined" ? process.env?.DATABASE_URL : undefined);

	if (!cs) {
		throw new Error(
			"connectionString (or DATABASE_URL) is required to initialize PrismaClient",
		);
	}

	const adapter = new PrismaPg({ connectionString: cs });
	return new PrismaClient({ adapter });
}

export function getPrismaClient(connectionString?: string): PrismaClient {
	if (connectionString) {
		return createPrismaClient(connectionString);
	}

	const prisma = globalThis.__slicexPrisma ?? createPrismaClient();

	if (
		typeof process === "undefined" ||
		process.env?.NODE_ENV !== "production"
	) {
		globalThis.__slicexPrisma = prisma;
	}

	return prisma;
}

export default getPrismaClient;
