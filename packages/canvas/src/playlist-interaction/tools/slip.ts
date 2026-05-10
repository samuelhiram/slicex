import { screenXToTime } from "../../playlist-core";
import type { PlaylistTool, ToolEnvironment } from "./types";

// Slip tool — LMB-drag inside a clip slides the inner content (contentOffset)
// while keeping start/duration fixed. Mirrors FL Studio's Slip tool (S).
export const slipTool: PlaylistTool = {
  id: "slip",
  cursor: "ew-resize",
  onPointerDown(env: ToolEnvironment) {
    const { core, metrics, point, hit, event } = env;
    const state = core.getState();

    if (
      hit.kind !== "clip" &&
      hit.kind !== "automation-body" &&
      hit.kind !== "resize-left" &&
      hit.kind !== "resize-right"
    ) {
      return null;
    }

    const startPointerTime = screenXToTime(state, point.x, metrics);
    return {
      kind: "slip-drag",
      pointerId: event.pointerId,
      clipId: hit.clip.id,
      startPointerTime,
      startContentOffset: hit.clip.contentOffset ?? 0,
      startStretchRatio: hit.clip.stretchRatio ?? 1,
    };
  },
};
