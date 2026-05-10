import type { PlaylistToolId } from "../../playlist-core";
import { drawTool } from "./draw";
import { deleteTool } from "./delete";
import { muteTool } from "./mute";
import { paintTool } from "./paint";
import { selectTool } from "./select";
import { sliceTool } from "./slice";
import { slipTool } from "./slip";
import type { PlaylistTool } from "./types";
import { zoomTool } from "./zoom";

export const TOOLS: Readonly<Record<PlaylistToolId, PlaylistTool>> = {
  select: selectTool,
  draw: drawTool,
  paint: paintTool,
  delete: deleteTool,
  mute: muteTool,
  slip: slipTool,
  slice: sliceTool,
  zoom: zoomTool,
};

export function getTool(id: PlaylistToolId): PlaylistTool {
  return TOOLS[id] ?? selectTool;
}
