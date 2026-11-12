import type { PlaylistTool, ToolEnvironment } from "./types";

// Delete tool — LMB on a clip deletes it; drag deletes any clip the cursor
// touches. Mirrors FL Studio's Delete tool (D).
//
// With the host's `deferDelete` the press and the sweep only MARK the clips
// (the controller reports them through onPendingChange so the host can
// highlight them); everything marked is deleted on release, as one step the
// host can announce ("Borrados 2 · Deshacer").
export const deleteTool: PlaylistTool = {
  id: "delete",
  cursor: "not-allowed",
  onPointerDown(env: ToolEnvironment) {
    const { core, point, hit, event } = env;
    const deletedClipIds = new Set<string>();
    const deferred = env.deferDelete === true;

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
      deletedClipIds.add(hit.clip.id);
      if (!deferred) core.deleteClips([hit.clip.id]);
    }

    return {
      kind: "delete-drag",
      pointerId: event.pointerId,
      lastPoint: { ...point },
      deletedClipIds,
      deferred,
    };
  },
};
