import { getTimelineById as dbGetTimelineById, createTimelineRevision } from '@slicex/db';
export async function getTimelineById(timelineId) {
    return dbGetTimelineById(timelineId);
}
export async function saveTimelineRevision(timelineId, documentJson) {
    return createTimelineRevision(timelineId, documentJson);
}
