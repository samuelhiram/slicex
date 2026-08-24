import {
  screenXToTime,
  screenYToTrackIndex,
  snapTime,
} from "../../playlist-core";
import { brushSnapStep, buildBrushOcclusion } from "../brush";
import { clipCreateTemplateFromSelection } from "./clip-template";
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
    const { core, metrics, point, event, hit } = env;
    const state = core.getState();
    // Never stamp on top of an existing clip. The occupancy grid alone is not
    // enough: it is keyed by SNAPPED cell, so an Alt (snap-bypass) press lands
    // between cells and reports the spot as free, dropping a duplicate clip
    // right on top of the one under the cursor.
    const overExistingClip =
      hit.kind === "clip" ||
      hit.kind === "automation-body" ||
      hit.kind === "resize-left" ||
      hit.kind === "resize-right";
    const trackIndex = screenYToTrackIndex(state, point.y, metrics);
    const start = Math.max(
      0,
      snapTime(screenXToTime(state, point.x, metrics), state, event.altKey),
    );
    const snapStep = brushSnapStep(state, metrics);
    const occupied = buildBrushOcclusion(state, snapStep);
    const template = clipCreateTemplateFromSelection(state, {
      type: "pattern",
      label: "Clip",
      color: DEFAULT_PAINT_COLOR,
      duration: DEFAULT_PAINT_DURATION_BEATS,
    });

    if (!overExistingClip && !occupied.has(trackIndex, start, state)) {
      core.createClip({
        trackIndex,
        start,
        duration: template.duration,
        type: template.type,
        label: template.label,
        color: template.color,
        sourceId: template.sourceId,
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
      duration: template.duration,
      color: template.color,
      type: template.type,
      label: template.label,
      sourceId: template.sourceId,
    };
  },
};
