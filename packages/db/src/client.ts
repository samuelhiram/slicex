import { PrismaClient } from '@prisma/client';

declare global {
	// eslint-disable-next-line no-var
	var __slicexPrisma?: PrismaClient;
}

const prisma = globalThis.__slicexPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__slicexPrisma = prisma;

export default prisma;
