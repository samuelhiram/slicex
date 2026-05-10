import type { PlaylistTool, ToolEnvironment } from "./types";

// Delete tool — LMB on a clip deletes it; drag deletes any clip the cursor
// touches. Mirrors FL Studio's Delete tool (D).
export const deleteTool: PlaylistTool = {
  id: "delete",
  cursor: "not-allowed",
  onPointerDown(env: ToolEnvironment) {
    const { core, hit, event } = env;

    if (hit.kind === "automation-point") {
      core.removeAutomationPoint(hit.clip.id, hit.pointId);
      return null;
    }

    if (
      hit.kind === "clip" ||
      hit.kind === "automation-body" ||
      hit.kind === "resize-left" ||
      hit.kind === "resize-right"
    ) {
      core.deleteClip(hit.clip.id);
    }

    return {
      kind: "delete-drag",
      pointerId: event.pointerId,
    };
  },
};
