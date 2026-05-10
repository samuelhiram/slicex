import { selectTool } from "./select";
import type { PlaylistTool } from "./types";

// Slice tool stub — falls back to Select behaviour until Fase 6 lands the
// real slice gesture (drag vertical to cut all clips intersected).
export const sliceTool: PlaylistTool = {
  id: "slice",
  cursor: "crosshair",
  onPointerDown: selectTool.onPointerDown,
};
