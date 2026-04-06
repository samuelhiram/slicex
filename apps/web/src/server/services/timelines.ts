import {
  getTimelineById as dbGetTimelineById,
  createTimelineRevision,
} from "@slicex/db";

export async function getTimelineById(timelineId: string) {
  return dbGetTimelineById(timelineId);
}

export async function saveTimelineRevision(
  timelineId: string,
  documentJson: any,
) {
  return createTimelineRevision(timelineId, documentJson);
}
