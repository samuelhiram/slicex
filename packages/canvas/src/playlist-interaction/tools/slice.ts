import type { PlaylistTool, ToolEnvironment } from "./types";

// Slice tool — LMB drag draws a vertical guide; on release every clip whose
// body crosses that x is split in two. Mirrors FL Studio's Slice tool (C).
// The clip pressed on is remembered: a host with sliceScope "target" cuts
// only that clip (or the selection it belongs to) — see the controller.
export const sliceTool: PlaylistTool = {
  id: "slice",
  cursor: "crosshair",
  onPointerDown(env: ToolEnvironment) {
    const { point, event, hit } = env;
    const targetClipId =
      hit.kind === "clip" ||
      hit.kind === "resize-left" ||
      hit.kind === "resize-right" ||
      hit.kind === "automation-body"
        ? hit.clip.id
        : null;
    return {
      kind: "slice-drag",
      pointerId: event.pointerId,
      startPoint: { ...point },
      currentPoint: { ...point },
      targetClipId,
    };
  },
};
