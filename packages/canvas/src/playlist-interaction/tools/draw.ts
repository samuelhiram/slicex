import {
  getTrackIndexById,
  screenXToTime,
  screenYToTrackIndex,
  snapTime,
  type PlaylistAutomationPoint,
} from "../../playlist-core";
import { clipCreateTemplateFromSelection } from "./clip-template";
import type { PlaylistTool, ToolEnvironment } from "./types";

const DEFAULT_CLIP_DURATION_BEATS = 4;

// Draw tool — LMB on empty creates a clip; LMB on clip behaves like Select drag/resize.
// Mirrors FL Studio's Draw tool (P).
export const drawTool: PlaylistTool = {
  id: "draw",
  cursor: "crosshair",
  onPointerDown(env: ToolEnvironment) {
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

    // Empty timeline area → create a clip and start dragging it.
    const trackIndex = screenYToTrackIndex(state, point.y, metrics);
    const rawTime = screenXToTime(state, point.x, metrics);
    const start = Math.max(0, snapTime(rawTime, state, event.altKey));
    const template = clipCreateTemplateFromSelection(state, {
      type: "pattern",
      label: "Clip",
      color: "#7aa6d8",
      duration: DEFAULT_CLIP_DURATION_BEATS,
    });
    const id = core.createClip({
      trackIndex,
      start,
      duration: template.duration,
      type: template.type,
      label: template.label,
      color: template.color,
      sourceId: template.sourceId,
    });
    core.setSelection({ clipIds: [id], automationPointIds: [] });
    return {
      kind: "clip-drag",
      pointerId: event.pointerId,
      primaryClipId: id,
      startPointerTime: rawTime,
      startTrackIndex: trackIndex,
      originals: [{ id, start, trackIndex }],
    };
  },
};
