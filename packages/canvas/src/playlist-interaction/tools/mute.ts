import type { PlaylistTool, ToolEnvironment } from "./types";

// Mute tool — LMB on a clip toggles its muted flag. Mirrors FL Studio's Mute tool (T).
export const muteTool: PlaylistTool = {
  id: "mute",
  cursor: "pointer",
  onPointerDown(env: ToolEnvironment) {
    const { core, point, hit, event } = env;
    const touchedClipIds = new Set<string>();
    let muted = true;
    if (
      hit.kind === "clip" ||
      hit.kind === "automation-body" ||
      hit.kind === "resize-left" ||
      hit.kind === "resize-right"
    ) {
      muted = hit.clip.muted !== true;
      touchedClipIds.add(hit.clip.id);
      core.setClipsMuted([hit.clip.id], muted);
    }
    return {
      kind: "mute-drag",
      pointerId: event.pointerId,
      lastPoint: { ...point },
      muted,
      touchedClipIds,
    };
  },
};
