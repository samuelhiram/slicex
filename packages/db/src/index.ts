import prisma from "./client";

export async function getTimelineById(timelineId: string) {
  return prisma.timeline.findUnique({ where: { id: timelineId } });
}

export async function createTimelineRevision(
  timelineId: string,
  documentJson: any,
) {
  return prisma.timelineRevision.create({ data: { timelineId, documentJson } });
}

export { prisma };
