import type { PlaylistTool, ToolEnvironment } from "./types";

// Mute tool — LMB on a clip toggles its muted flag. Mirrors FL Studio's Mute tool (T).
export const muteTool: PlaylistTool = {
  id: "mute",
  cursor: "pointer",
  onPointerDown(env: ToolEnvironment) {
    const { core, hit } = env;
    if (
      hit.kind === "clip" ||
      hit.kind === "automation-body" ||
      hit.kind === "resize-left" ||
      hit.kind === "resize-right"
    ) {
      core.toggleClipMute(hit.clip.id);
    }
    return null;
  },
};
