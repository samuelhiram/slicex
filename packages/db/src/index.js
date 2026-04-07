import prisma from "./client";
export async function getTimelineById(timelineId) {
    return prisma.timeline.findUnique({ where: { id: timelineId } });
}
export async function createTimelineRevision(timelineId, documentJson) {
    return prisma.timelineRevision.create({ data: { timelineId, documentJson } });
}
export { prisma };
