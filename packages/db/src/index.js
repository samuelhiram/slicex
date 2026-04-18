import { getPrismaClient } from "./client";
export async function getTimelineById(timelineId) {
    const prisma = getPrismaClient();
    return prisma.timeline.findUnique({ where: { id: timelineId } });
}
export async function createTimelineRevision(timelineId, documentJson) {
    const prisma = getPrismaClient();
    return prisma.timelineRevision.create({ data: { timelineId, documentJson } });
}
export async function createTimelineRevisionAndSetHead(timelineId, documentJson, title) {
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
