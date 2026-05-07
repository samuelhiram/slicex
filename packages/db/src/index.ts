import { getPrismaClient, createPrismaClient } from "./client";
import type { Prisma, PrismaClient } from "@prisma/client";

export async function getTimelineById(
  timelineId: string,
  prisma: PrismaClient = getPrismaClient(),
) {
  return prisma.timeline.findUnique({ where: { id: timelineId } });
}

export async function createTimelineRevision(
  timelineId: string,
  documentJson: Prisma.InputJsonValue,
  prisma: PrismaClient = getPrismaClient(),
) {
  return prisma.timelineRevision.create({ data: { timelineId, documentJson } });
}

export async function createTimelineRevisionAndSetHead(
  timelineId: string,
  documentJson: Prisma.InputJsonValue,
  title: string,
  prisma: PrismaClient = getPrismaClient(),
) {
  return prisma.$transaction(async (tx) => {
    const createdRevision = await tx.timelineRevision.create({
      data: {
        timelineId,
        documentJson,
      },
    });

    await tx.timeline.update({
      where: { id: timelineId },
      data: {
        headRevisionId: createdRevision.id,
        title,
      },
    });

    return createdRevision;
  });
}

export { getPrismaClient, createPrismaClient };
export type { Prisma, PrismaClient } from "@prisma/client";
