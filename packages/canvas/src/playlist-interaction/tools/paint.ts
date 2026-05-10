import {
  screenXToTime,
  screenYToTrackIndex,
  snapTime,
} from "../../playlist-core";
import { brushSnapStep, buildBrushOcclusion } from "../brush";
import type { PlaylistTool, ToolEnvironment } from "./types";

const DEFAULT_PAINT_DURATION_BEATS = 4;
const DEFAULT_PAINT_COLOR = "#7aa6d8";

// Paint tool — LMB drag paints a fresh clip per snapped cell that doesn't
// already contain one. Mirrors FL Studio's Paint tool (B).
//
// Brush primitives live in playlist-interaction/brush.ts: this tool just
// composes them. See docs/performance-canon.md §3 "Brush stroke pattern"
// for the canonical contract.
export const paintTool: PlaylistTool = {
  id: "paint",
  cursor: "cell",
  onPointerDown(env: ToolEnvironment) {
    const { core, metrics, point, event } = env;
    const state = core.getState();
    const trackIndex = screenYToTrackIndex(state, point.y, metrics);
    const start = Math.max(
      0,
      snapTime(screenXToTime(state, point.x, metrics), state, event.altKey),
    );
    const snapStep = brushSnapStep(state, metrics);
    const occupied = buildBrushOcclusion(state, snapStep);

    if (!occupied.has(trackIndex, start, state)) {
      core.createClip({
        trackIndex,
        start,
        duration: DEFAULT_PAINT_DURATION_BEATS,
        type: "pattern",
        label: "Clip",
        color: DEFAULT_PAINT_COLOR,
      });
      occupied.add(trackIndex, start, core.getState());
    }

    return {
      kind: "paint-drag",
      pointerId: event.pointerId,
      lastTrackIndex: trackIndex,
      lastSnappedStart: start,
      occupied,
      snapStep,
      duration: DEFAULT_PAINT_DURATION_BEATS,
      color: DEFAULT_PAINT_COLOR,
    };
  },
};
