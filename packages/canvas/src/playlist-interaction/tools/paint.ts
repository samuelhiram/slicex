import {
  getTrackIdByIndex,
  screenXToTime,
  screenYToTrackIndex,
  snapTime,
} from "../../playlist-core";
import type { PlaylistTool, ToolEnvironment } from "./types";

const DEFAULT_PAINT_DURATION_BEATS = 4;

// Paint tool — LMB drag paints a fresh clip per snapped cell that doesn't
// already contain one. Mirrors FL Studio's Paint tool (B).
export const paintTool: PlaylistTool = {
  id: "paint",
  cursor: "cell",
  onPointerDown(env: ToolEnvironment) {
    const { core, metrics, point, hit, event } = env;
    const state = core.getState();

    if (hit.kind === "clip" || hit.kind === "automation-body") {
      // Existing clip: do nothing on press; let drag-to-paint pick up other cells.
      // Return paint-drag so subsequent move events are tracked.
      const trackIndex = screenYToTrackIndex(state, point.y, metrics);
      const start = snapTime(
        screenXToTime(state, point.x, metrics),
        state,
        event.altKey,
      );
      return {
        kind: "paint-drag",
        pointerId: event.pointerId,
        lastTrackIndex: trackIndex,
        lastSnappedStart: start,
      };
    }

    const trackIndex = screenYToTrackIndex(state, point.y, metrics);
    const start = Math.max(
      0,
      snapTime(screenXToTime(state, point.x, metrics), state, event.altKey),
    );
    const trackId = getTrackIdByIndex(state, trackIndex);
    const cellOccupied = state.clips.some(
      (clip) =>
        clip.trackId === trackId &&
        start >= clip.start &&
        start < clip.start + clip.duration,
    );
    if (!cellOccupied) {
      core.createClip({
        trackIndex,
        start,
        duration: DEFAULT_PAINT_DURATION_BEATS,
        type: "pattern",
        label: "Clip",
        color: "#7aa6d8",
      });
    }
    return {
      kind: "paint-drag",
      pointerId: event.pointerId,
      lastTrackIndex: trackIndex,
      lastSnappedStart: start,
    };
  },
};
