import { clamp, screenXToTime } from "../../playlist-core";
import type { PlaylistTool, ToolEnvironment } from "./types";

const ZOOM_IN_FACTOR = 1.5;
const ZOOM_OUT_FACTOR = 1 / 1.5;

// Zoom tool — LMB zooms in 1.5× centred on the cursor. RMB zooms out (handled
// at the controller level via the regular contextmenu suppression). FL Studio
// also supports drag-to-define-region; deferred to Fase 12 polish.
export const zoomTool: PlaylistTool = {
  id: "zoom",
  cursor: "zoom-in",
  onPointerDown(env: ToolEnvironment) {
    applyZoom(env, ZOOM_IN_FACTOR);
    return null;
  },
};

export function zoomToolApplyOut(env: ToolEnvironment): void {
  applyZoom(env, ZOOM_OUT_FACTOR);
}

function applyZoom(env: ToolEnvironment, factor: number): void {
  const { core, metrics, point } = env;
  const state = core.getState();
  const timelineX = point.x - metrics.trackHeaderWidth;
  if (timelineX < 0) {
    return;
  }
  const anchorTime = screenXToTime(state, point.x, metrics);
  const pxPerBeat = clamp(
    state.viewport.pxPerBeat * factor,
    metrics.minPxPerBeat,
    metrics.maxPxPerBeat,
  );
  const scrollX = anchorTime * pxPerBeat - timelineX;
  core.updateViewport({ pxPerBeat, scrollX });
}
