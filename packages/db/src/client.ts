// Use require to avoid type mismatch across Prisma major versions in the scaffold
// eslint-disable-next-line @typescript-eslint/no-var-requires
// @ts-ignore
const { PrismaClient } = require('@prisma/client');

// @ts-ignore
const prisma = new PrismaClient();

export default prisma;
