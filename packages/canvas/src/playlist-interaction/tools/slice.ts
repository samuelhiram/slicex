import type { PlaylistTool, ToolEnvironment } from "./types";

// Slice tool — LMB drag draws a vertical guide; on release every clip whose
// body crosses that x is split in two. Mirrors FL Studio's Slice tool (C).
export const sliceTool: PlaylistTool = {
  id: "slice",
  cursor: "crosshair",
  onPointerDown(env: ToolEnvironment) {
    const { point, event } = env;
    return {
      kind: "slice-drag",
      pointerId: event.pointerId,
      startPoint: { ...point },
      currentPoint: { ...point },
    };
  },
};
