import {
  getTrackIndexById,
  screenXToTime,
  type PlaylistAutomationPoint,
} from "../../playlist-core";
import type { PlaylistTool, ToolEnvironment } from "./types";

// Select tool — preserves the original playlist behaviour.
// LMB clip = drag, LMB resize edge = resize, LMB empty = marquee, etc.
export const selectTool: PlaylistTool = {
  id: "select",
  cursor: "default",
  onPointerDown(env) {
    const { core, metrics, point, hit, event } = env;
    const state = core.getState();

    if (hit.kind === "automation-point") {
      const automationPoint = hit.clip.points.find(
        (candidate: PlaylistAutomationPoint) => candidate.id === hit.pointId,
      );
      if (!automationPoint) {
        return null;
      }
      core.setSelection({
        clipIds: [hit.clip.id],
        automationPointIds: [hit.pointId],
      });
      return {
        kind: "automation-point-drag",
        pointerId: event.pointerId,
        clipId: hit.clip.id,
        pointId: hit.pointId,
        originalTime: automationPoint.time,
        originalValue: automationPoint.value,
      };
    }

    if (hit.kind === "resize-left" || hit.kind === "resize-right") {
      core.setSelection({ clipIds: [hit.clip.id], automationPointIds: [] });
      return {
        kind: "clip-resize",
        pointerId: event.pointerId,
        clipId: hit.clip.id,
        edge: hit.kind === "resize-left" ? "left" : "right",
      };
    }

    if (hit.kind === "clip" || hit.kind === "automation-body") {
      const selected = new Set(state.selection.clipIds);
      const draggingClips = selected.has(hit.clip.id)
        ? state.clips.filter((candidate) => selected.has(candidate.id))
        : [hit.clip];
      if (!selected.has(hit.clip.id)) {
        core.setSelection({ clipIds: [hit.clip.id], automationPointIds: [] });
      }
      return {
        kind: "clip-drag",
        pointerId: event.pointerId,
        primaryClipId: hit.clip.id,
        startPointerTime: screenXToTime(state, point.x, metrics),
        startTrackIndex: getTrackIndexById(state, hit.clip.trackId),
        originals: draggingClips.map((clip) => ({
          id: clip.id,
          start: clip.start,
          trackIndex: getTrackIndexById(state, clip.trackId),
        })),
      };
    }

    // Empty timeline area: clear selection and start a marquee.
    core.setSelection({ clipIds: [], automationPointIds: [] });
    core.setMarquee({ start: point, current: point });
    return {
      kind: "marquee",
      pointerId: event.pointerId,
      startPoint: point,
    };
  },
};
