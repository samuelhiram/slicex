import {
  getTrackIndexById,
  screenXToTime,
  type PlaylistAutomationPoint,
} from "../../playlist-core";
import type { PlaylistTool, ToolEnvironment } from "./types";

// Select tool — preserves the original playlist behaviour.
// LMB clip = drag, LMB resize edge = resize, LMB empty = marquee, etc.
export const selectTool: PlaylistTool = {
  id: "select",
  cursor: "default",
  onPointerDown(env) {
    const { core, metrics, point, hit, event } = env;
    const state = core.getState();

    if (hit.kind === "automation-point") {
      const automationPoint = hit.clip.points.find(
        (candidate: PlaylistAutomationPoint) => candidate.id === hit.pointId,
      );
      if (!automationPoint) {
        return null;
      }
      core.setSelection({
        clipIds: [hit.clip.id],
        automationPointIds: [hit.pointId],
      });
      return {
        kind: "automation-point-drag",
        pointerId: event.pointerId,
        clipId: hit.clip.id,
        pointId: hit.pointId,
        originalTime: automationPoint.time,
        originalValue: automationPoint.value,
      };
    }

    if (hit.kind === "resize-left" || hit.kind === "resize-right") {
      core.setSelection({ clipIds: [hit.clip.id], automationPointIds: [] });
      return {
        kind: "clip-resize",
        pointerId: event.pointerId,
        clipId: hit.clip.id,
        edge: hit.kind === "resize-left" ? "left" : "right",
      };
    }

    if (hit.kind === "clip" || hit.kind === "automation-body") {
      const ctrl = event.ctrlKey || event.metaKey;
      const shift = event.shiftKey;
      const selected = new Set(state.selection.clipIds);

      if (ctrl && shift) {
        // Ctrl+Shift+click = additive add without removing existing selection.
        if (!selected.has(hit.clip.id)) {
          core.addClipsToSelection([hit.clip.id]);
        }
        return null;
      }
      if (ctrl) {
        // Ctrl+click toggles a clip in the selection (no drag).
        core.toggleClipSelection(hit.clip.id);
        return null;
      }
      if (shift) {
        // Shift+drag = clone-drag (FL Studio): clone the targeted clips in
        // place and start dragging the clones. If the hit clip wasn't
        // selected, treat it as the only source.
        const sourceIds = selected.has(hit.clip.id)
          ? state.clips
              .filter((candidate) => selected.has(candidate.id))
              .map((c) => c.id)
          : [hit.clip.id];
        const newIds = core.cloneClipsInPlace(sourceIds);
        if (newIds.length === 0) {
          return null;
        }
        const newState = core.getState();
        const newClips = newState.clips.filter((c) => newIds.includes(c.id));
        const primary = newClips[0]!;
        return {
          kind: "clip-drag",
          pointerId: event.pointerId,
          primaryClipId: primary.id,
          startPointerTime: screenXToTime(state, point.x, metrics),
          startTrackIndex: getTrackIndexById(newState, primary.trackId),
          originals: newClips.map((clip) => ({
            id: clip.id,
            start: clip.start,
            trackIndex: getTrackIndexById(newState, clip.trackId),
          })),
        };
      }

      // F6: drag expands to the whole group of any seed clip. The reducer
      // also auto-expands (in moveClips), but doing it here too keeps the
      // visual originals list in sync with what's about to move so the
      // drop-ghost shows every sibling, not just the primary.
      const seedIds = selected.has(hit.clip.id)
        ? Array.from(selected)
        : [hit.clip.id];
      const expandedIds = core.expandSelectionToGroups(seedIds);
      const expandedSet = new Set(expandedIds);
      const draggingClips = state.clips.filter((candidate) =>
        expandedSet.has(candidate.id),
      );
      if (!selected.has(hit.clip.id)) {
        core.setSelection({ clipIds: [hit.clip.id], automationPointIds: [] });
      }
      return {
        kind: "clip-drag",
        pointerId: event.pointerId,
        primaryClipId: hit.clip.id,
        startPointerTime: screenXToTime(state, point.x, metrics),
        startTrackIndex: getTrackIndexById(state, hit.clip.trackId),
        originals: draggingClips.map((clip) => ({
          id: clip.id,
          start: clip.start,
          trackIndex: getTrackIndexById(state, clip.trackId),
        })),
      };
    }

    // Empty timeline area: marquee. Ctrl or Shift makes it additive.
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    if (!additive) {
      core.setSelection({ clipIds: [], automationPointIds: [] });
    }
    core.setMarquee({ start: point, current: point });
    return {
      kind: "marquee",
      pointerId: event.pointerId,
      startPoint: point,
      additive,
    };
  },
};
