import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
function createPrismaClient() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is required to initialize PrismaClient");
    }
    const adapter = new PrismaPg({ connectionString });
    return new PrismaClient({ adapter });
}
export function getPrismaClient() {
    const prisma = globalThis.__slicexPrisma ?? createPrismaClient();
    if (process.env.NODE_ENV !== "production") {
        globalThis.__slicexPrisma = prisma;
    }
    return prisma;
}
export default getPrismaClient;
