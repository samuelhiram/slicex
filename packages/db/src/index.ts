import { getPrismaClient } from "./client";
import type { Prisma } from "@prisma/client";

export async function getTimelineById(timelineId: string) {
  const prisma = getPrismaClient();
  return prisma.timeline.findUnique({ where: { id: timelineId } });
}

export async function createTimelineRevision(
  timelineId: string,
  documentJson: Prisma.InputJsonValue,
) {
  const prisma = getPrismaClient();
  return prisma.timelineRevision.create({ data: { timelineId, documentJson } });
}

export async function createTimelineRevisionAndSetHead(
  timelineId: string,
  documentJson: Prisma.InputJsonValue,
  title: string,
) {
  const prisma = getPrismaClient();

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

export { getPrismaClient };
export type { Prisma } from "@prisma/client";
