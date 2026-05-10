import { selectTool } from "./select";
import type { PlaylistTool } from "./types";

// Slip tool stub — falls back to Select behaviour until Fase 6 lands the
// real slip-edit gesture (drag interior of clip slides content, keeping
// start/end fixed).
export const slipTool: PlaylistTool = {
  id: "slip",
  cursor: "ew-resize",
  onPointerDown: selectTool.onPointerDown,
};
