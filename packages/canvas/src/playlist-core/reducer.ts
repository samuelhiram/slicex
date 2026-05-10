import type { PlaylistAction } from "./actions";
import {
  clamp,
  getMaxScrollX,
  getMaxScrollY,
  getTrackIdByIndex,
  isAutomationClip,
} from "./geometry";
import type { PlaylistHover } from "./types";
import {
  createInsertedTrack,
  materializeTracksThrough,
} from "./state-track-helpers";
import { sortAutomationPoints } from "./state-utils";
import type { PlaylistMetrics, PlaylistState } from "./types";

// Hover equality short-circuit so SET_HOVER on the same target during a
// pointermove flood doesn't allocate a fresh state every frame.
function hoversEqual(a: PlaylistHover, b: PlaylistHover): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "clip":
    case "resize-left":
    case "resize-right":
      return a.clipId === (b as { clipId: string }).clipId;
    case "automation-point":
      return (
        a.clipId === (b as { clipId: string }).clipId &&
        a.pointId === (b as { pointId: string }).pointId
      );
    case "track":
      return a.trackId === (b as { trackId: string }).trackId;
    case "marker":
      return a.markerId === (b as { markerId: string }).markerId;
    default: {
      const exhaustive: never = a;
      return exhaustive;
    }
  }
}

// Pure reducer. Same input + action always produces the same output.
// Normalization (clamp viewport, sort points, etc.) runs after dispatch in PlaylistCore.
export function playlistReducer(
  state: PlaylistState,
  action: PlaylistAction,
  metrics: PlaylistMetrics,
): PlaylistState {
  switch (action.type) {
    case "MOVE_CLIPS":
      return moveClips(state, action.updates);
    case "RESIZE_CLIP":
      return resizeClip(state, action.clipId, action.edge, action.time, metrics);
    case "ADD_AUTOMATION_POINT":
      return addAutomationPoint(
        state,
        action.clipId,
        action.pointId,
        action.time,
        action.value,
      );
    case "MOVE_AUTOMATION_POINT":
      return moveAutomationPoint(
        state,
        action.clipId,
        action.pointId,
        action.time,
        action.value,
      );
    case "REMOVE_AUTOMATION_POINT":
      return removeAutomationPoint(state, action.clipId, action.pointId);
    case "REMOVE_SELECTED":
      return removeSelected(state);
    case "CLEAR_TRACK_CLIPS":
      return clearTrackClips(state, action.trackIndex);
    case "DELETE_SELECTED_CLIPS_ON_TRACK":
      return deleteSelectedClipsOnTrack(state, action.trackIndex);
    case "RENAME_TRACK":
      return renameTrack(state, action.trackIndex, action.label);
    case "RECOLOR_TRACK":
      return recolorTrack(state, action.trackIndex, action.color);
    case "INSERT_TRACK_BELOW":
      return insertTrackBelow(state, action.trackIndex);
    case "DELETE_EMPTY_TRACK":
      return deleteEmptyTrack(state, action.trackIndex);
    case "CREATE_CLIP":
      return createClip(state, action.clip, action.trackIndex);
    case "DELETE_CLIP":
      return deleteClip(state, action.clipId);
    case "TOGGLE_CLIP_MUTE":
      return toggleClipMute(state, action.clipId);
    case "TOGGLE_TRACK_MUTE":
      return toggleTrackFlag(state, action.trackIndex, "muted");
    case "TOGGLE_TRACK_SOLO":
      return toggleTrackFlag(state, action.trackIndex, "soloed");
    case "TOGGLE_TRACK_LOCK":
      return toggleTrackFlag(state, action.trackIndex, "locked");
    case "SET_TRACK_HEIGHT":
      return setTrackHeight(state, action.trackIndex, action.height, metrics);
    case "REORDER_TRACK":
      return reorderTrack(state, action.fromIndex, action.toIndex);
    case "MAKE_CLIPS_UNIQUE":
      return makeClipsUnique(state, action.clipIds);
    case "SET_CLIP_LABEL":
      return setClipField(state, action.clipId, "label", action.label);
    case "SET_CLIP_COLOR":
      return setClipField(state, action.clipId, "color", action.color);
    case "SET_CLIP_CONTENT_OFFSET":
      return setClipNumericField(
        state,
        action.clipId,
        "contentOffset",
        action.contentOffset,
      );
    case "SET_CLIP_STRETCH_RATIO":
      return setClipNumericField(
        state,
        action.clipId,
        "stretchRatio",
        Math.max(0.01, action.stretchRatio),
      );
    case "STRETCH_RESIZE_CLIP":
      return stretchResizeClip(
        state,
        action.clipId,
        action.edge,
        action.time,
        metrics,
      );
    case "SLICE_CLIPS_AT_TIME":
      return sliceClipsAtTime(state, action.time, action.newClips);
    case "SET_STRETCH_MODE":
      return state.stretchMode === action.enabled
        ? state
        : { ...state, stretchMode: action.enabled };
    case "TOGGLE_STRETCH_MODE":
      return { ...state, stretchMode: !state.stretchMode };
    case "ADD_MARKER":
      if (state.markers.some((m) => m.id === action.marker.id)) {
        return state;
      }
      return {
        ...state,
        markers: sortMarkers([...state.markers, { ...action.marker }]),
      };
    case "REMOVE_MARKER":
      if (!state.markers.some((m) => m.id === action.markerId)) {
        return state;
      }
      return {
        ...state,
        markers: state.markers.filter((m) => m.id !== action.markerId),
      };
    case "UPDATE_MARKER": {
      let changed = false;
      const next = state.markers.map((m) => {
        if (m.id !== action.markerId) return m;
        const merged = { ...m, ...action.patch, id: m.id };
        if (
          merged.time === m.time &&
          merged.kind === m.kind &&
          merged.label === m.label &&
          merged.color === m.color &&
          merged.timeSignatureNumerator === m.timeSignatureNumerator &&
          merged.timeSignatureDenominator === m.timeSignatureDenominator
        ) {
          return m;
        }
        changed = true;
        return merged;
      });
      if (!changed) return state;
      return { ...state, markers: sortMarkers(next) };
    }
    case "OPEN_MARKER_CONTEXT_MENU":
      return {
        ...state,
        contextMenu: {
          kind: "marker",
          markerId: action.markerId,
          position: { ...action.position },
        },
      };
    case "SET_TRANSPORT_MODE":
      if (state.transport.mode === action.mode) return state;
      return { ...state, transport: { ...state.transport, mode: action.mode } };
    case "TOGGLE_TRANSPORT_MODE":
      return {
        ...state,
        transport: {
          ...state.transport,
          mode: state.transport.mode === "song" ? "pattern" : "song",
        },
      };
    case "TOGGLE_TRANSPORT_RECORDING":
      return {
        ...state,
        transport: {
          ...state.transport,
          recording: !state.transport.recording,
        },
      };
    case "PASTE_CLIPS":
      return pasteClips(state, action.entries, action.selectIds);
    case "SET_TOOL":
      return state.tool === action.tool
        ? state
        : { ...state, tool: action.tool };
    case "SELECT_ALL_CLIPS":
      return {
        ...state,
        selection: {
          clipIds: state.clips.map((clip) => clip.id),
          automationPointIds: state.selection.automationPointIds,
        },
      };
    case "INVERT_CLIP_SELECTION": {
      const selected = new Set(state.selection.clipIds);
      return {
        ...state,
        selection: {
          clipIds: state.clips
            .map((clip) => clip.id)
            .filter((id) => !selected.has(id)),
          automationPointIds: state.selection.automationPointIds,
        },
      };
    }
    case "SET_CLIPBOARD":
      return { ...state, clipboard: action.clipboard };
    case "SET_SNAP_MODE":
      if (state.snap.mode === action.mode) {
        return state;
      }
      return {
        ...state,
        snap: {
          mode: action.mode,
          lastActiveMode:
            action.mode === "none" ? state.snap.lastActiveMode : action.mode,
        },
      };
    case "TOGGLE_SNAP_NONE": {
      if (state.snap.mode === "none") {
        const restored =
          state.snap.lastActiveMode === "none"
            ? "beat"
            : state.snap.lastActiveMode;
        return {
          ...state,
          snap: { mode: restored, lastActiveMode: restored },
        };
      }
      return {
        ...state,
        snap: { mode: "none", lastActiveMode: state.snap.mode },
      };
    }
    case "SET_SELECTION":
      return {
        ...state,
        selection: {
          clipIds: action.selection.clipIds
            ? [...action.selection.clipIds]
            : state.selection.clipIds,
          automationPointIds: action.selection.automationPointIds
            ? [...action.selection.automationPointIds]
            : state.selection.automationPointIds,
        },
      };
    case "SET_MARQUEE":
      return {
        ...state,
        marquee: action.marquee
          ? {
              start: { ...action.marquee.start },
              current: { ...action.marquee.current },
            }
          : null,
      };
    case "SET_HOVER":
      if (hoversEqual(state.hover, action.hover)) {
        return state;
      }
      return { ...state, hover: action.hover ? { ...action.hover } : null };
    case "SET_CONTEXT_MENU":
      return {
        ...state,
        contextMenu: action.contextMenu
          ? {
              ...action.contextMenu,
              position: { ...action.contextMenu.position },
            }
          : null,
      };
    case "OPEN_TRACK_CONTEXT_MENU": {
      const materialized = materializeTracksThrough(state, action.trackIndex);
      return {
        ...materialized,
        contextMenu: {
          kind: "track",
          trackIndex: Math.max(0, Math.floor(action.trackIndex)),
          position: { ...action.position },
        },
      };
    }
    case "CLOSE_CONTEXT_MENU":
      return { ...state, contextMenu: null };
    case "SET_VIEWPORT_SIZE": {
      const width = Math.max(1, Math.round(action.width));
      const height = Math.max(1, Math.round(action.height));
      if (
        state.viewport.width === width &&
        state.viewport.height === height
      ) {
        return state;
      }
      return {
        ...state,
        viewport: { ...state.viewport, width, height },
      };
    }
    case "UPDATE_VIEWPORT": {
      const candidateViewport = { ...state.viewport, ...action.patch };
      let pxPerBeat = candidateViewport.pxPerBeat;
      let scrollX = candidateViewport.scrollX;
      let scrollY = candidateViewport.scrollY;
      if (action.clamp) {
        pxPerBeat = clamp(
          pxPerBeat,
          metrics.minPxPerBeat,
          metrics.maxPxPerBeat,
        );
        const clampedCandidate: PlaylistState = {
          ...state,
          viewport: { ...candidateViewport, pxPerBeat },
        };
        scrollX = clamp(
          scrollX,
          0,
          getMaxScrollX(clampedCandidate, metrics),
        );
        scrollY = clamp(
          scrollY,
          0,
          getMaxScrollY(clampedCandidate, metrics),
        );
      }
      if (
        state.viewport.scrollX === scrollX &&
        state.viewport.scrollY === scrollY &&
        state.viewport.pxPerBeat === pxPerBeat &&
        state.viewport.width === candidateViewport.width &&
        state.viewport.height === candidateViewport.height
      ) {
        return state;
      }
      return {
        ...state,
        viewport: {
          ...candidateViewport,
          pxPerBeat,
          scrollX,
          scrollY,
        },
      };
    }
    case "SET_PLAY_POSITION": {
      const time = Math.max(0, action.time);
      if (state.playPosition.time === time) {
        return state;
      }
      return {
        ...state,
        playPosition: { ...state.playPosition, time },
      };
    }
    case "SET_PLAY_RUNNING":
      if (state.playPosition.isRunning === action.isRunning) {
        return state;
      }
      return {
        ...state,
        playPosition: { ...state.playPosition, isRunning: action.isRunning },
      };
    case "ADVANCE_PLAY_POSITION":
      if (!state.playPosition.isRunning) {
        return state;
      }
      return {
        ...state,
        playPosition: {
          ...state.playPosition,
          time: Math.max(
            0,
            state.playPosition.time + Math.max(0, action.deltaTime),
          ),
        },
      };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

function moveClips(
  state: PlaylistState,
  updates: { id: string; start: number; trackIndex: number }[],
): PlaylistState {
  const byId = new Map(updates.map((update) => [update.id, update]));
  const maxTrackIndex = updates.reduce(
    (max, update) => Math.max(max, Math.max(0, Math.floor(update.trackIndex))),
    state.tracks.length - 1,
  );
  const materialized = materializeTracksThrough(state, maxTrackIndex);
  const clips = materialized.clips.map((clip) => {
    const update = byId.get(clip.id);
    if (!update) {
      return clip;
    }
    return {
      ...clip,
      start: Math.max(0, update.start),
      trackId: getTrackIdByIndex(materialized, update.trackIndex),
    };
  });
  return { ...materialized, clips };
}

function resizeClip(
  state: PlaylistState,
  clipId: string,
  edge: "left" | "right",
  time: number,
  metrics: PlaylistMetrics,
): PlaylistState {
  const clips = state.clips.map((clip) => {
    if (clip.id !== clipId) {
      return clip;
    }
    const start = clip.start;
    const end = clip.start + clip.duration;
    if (edge === "right") {
      const nextEnd = Math.max(start + metrics.minClipDuration, time);
      return { ...clip, duration: nextEnd - start };
    }
    const nextStart = clamp(time, 0, end - metrics.minClipDuration);
    return { ...clip, start: nextStart, duration: end - nextStart };
  });
  return { ...state, clips };
}

function addAutomationPoint(
  state: PlaylistState,
  clipId: string,
  pointId: string,
  time: number,
  value: number,
): PlaylistState {
  const clips = state.clips.map((clip) => {
    if (clip.id !== clipId || !isAutomationClip(clip)) {
      return clip;
    }
    return {
      ...clip,
      points: sortAutomationPoints([
        ...clip.points,
        {
          id: pointId,
          time: clamp(time, 0, clip.duration),
          value: clamp(value, 0, 1),
        },
      ]),
    };
  });
  return {
    ...state,
    clips,
    selection: { clipIds: [clipId], automationPointIds: [pointId] },
  };
}

function moveAutomationPoint(
  state: PlaylistState,
  clipId: string,
  pointId: string,
  time: number,
  value: number,
): PlaylistState {
  const clips = state.clips.map((clip) => {
    if (clip.id !== clipId || !isAutomationClip(clip)) {
      return clip;
    }
    return {
      ...clip,
      points: sortAutomationPoints(
        clip.points.map((point) =>
          point.id === pointId
            ? {
                ...point,
                time: clamp(time, 0, clip.duration),
                value: clamp(value, 0, 1),
              }
            : point,
        ),
      ),
    };
  });
  return { ...state, clips };
}

function removeAutomationPoint(
  state: PlaylistState,
  clipId: string,
  pointId: string,
): PlaylistState {
  const clips = state.clips.map((clip) => {
    if (clip.id !== clipId || !isAutomationClip(clip)) {
      return clip;
    }
    if (clip.points.length <= 2) {
      return clip;
    }
    return {
      ...clip,
      points: clip.points.filter((point) => point.id !== pointId),
    };
  });
  return {
    ...state,
    clips,
    selection: {
      clipIds: state.selection.clipIds,
      automationPointIds: state.selection.automationPointIds.filter(
        (id) => id !== pointId,
      ),
    },
  };
}

function removeSelected(state: PlaylistState): PlaylistState {
  const selectedClipIds = new Set(state.selection.clipIds);
  const selectedPointIds = new Set(state.selection.automationPointIds);
  const clips = state.clips
    .filter((clip) => !selectedClipIds.has(clip.id))
    .map((clip) => {
      if (!isAutomationClip(clip)) {
        return clip;
      }
      const nextPoints = clip.points.filter(
        (point) => !selectedPointIds.has(point.id),
      );
      return nextPoints.length >= 2 ? { ...clip, points: nextPoints } : clip;
    });
  return {
    ...state,
    clips,
    selection: { clipIds: [], automationPointIds: [] },
  };
}

function clearTrackClips(
  state: PlaylistState,
  trackIndex: number,
): PlaylistState {
  const materialized = materializeTracksThrough(state, trackIndex);
  const trackId = getTrackIdByIndex(materialized, trackIndex);
  const removedIds = new Set(
    materialized.clips
      .filter((clip) => clip.trackId === trackId)
      .map((clip) => clip.id),
  );
  return {
    ...materialized,
    clips: materialized.clips.filter((clip) => clip.trackId !== trackId),
    selection: {
      clipIds: materialized.selection.clipIds.filter(
        (id) => !removedIds.has(id),
      ),
      automationPointIds: materialized.selection.automationPointIds,
    },
    contextMenu: null,
  };
}

function deleteSelectedClipsOnTrack(
  state: PlaylistState,
  trackIndex: number,
): PlaylistState {
  const materialized = materializeTracksThrough(state, trackIndex);
  const trackId = getTrackIdByIndex(materialized, trackIndex);
  const selected = new Set(materialized.selection.clipIds);
  const removedIds = new Set(
    materialized.clips
      .filter((clip) => clip.trackId === trackId && selected.has(clip.id))
      .map((clip) => clip.id),
  );
  return {
    ...materialized,
    clips: materialized.clips.filter((clip) => !removedIds.has(clip.id)),
    selection: {
      clipIds: materialized.selection.clipIds.filter(
        (id) => !removedIds.has(id),
      ),
      automationPointIds: materialized.selection.automationPointIds,
    },
    contextMenu: null,
  };
}

function renameTrack(
  state: PlaylistState,
  trackIndex: number,
  label: string,
): PlaylistState {
  const materialized = materializeTracksThrough(state, trackIndex);
  const tracks = materialized.tracks.map((track, index) =>
    index === trackIndex ? { ...track, label } : track,
  );
  return { ...materialized, tracks, contextMenu: null };
}

function recolorTrack(
  state: PlaylistState,
  trackIndex: number,
  color: string,
): PlaylistState {
  const materialized = materializeTracksThrough(state, trackIndex);
  const tracks = materialized.tracks.map((track, index) =>
    index === trackIndex ? { ...track, color } : track,
  );
  return { ...materialized, tracks, contextMenu: null };
}

function insertTrackBelow(
  state: PlaylistState,
  trackIndex: number,
): PlaylistState {
  const materialized = materializeTracksThrough(state, trackIndex);
  const tracks = [...materialized.tracks];
  tracks.splice(
    trackIndex + 1,
    0,
    createInsertedTrack(tracks, trackIndex),
  );
  return { ...materialized, tracks, contextMenu: null };
}

function createClip(
  state: PlaylistState,
  clip: import("./types").PlaylistClip,
  trackIndex: number,
): PlaylistState {
  if (state.clips.some((existing) => existing.id === clip.id)) {
    return state;
  }
  // Materialize the target track if it's still virtual. Without this, paint
  // tool strokes onto virtual rows would create clips whose trackId never
  // exists in state.tracks, leaving them invisible (filtered out by the
  // presentation's trackIndexById lookup).
  const materialized = materializeTracksThrough(state, trackIndex);
  const trackId = getTrackIdByIndex(materialized, trackIndex);
  return {
    ...materialized,
    clips: [...materialized.clips, { ...clip, trackId }],
  };
}

function deleteClip(state: PlaylistState, clipId: string): PlaylistState {
  if (!state.clips.some((clip) => clip.id === clipId)) {
    return state;
  }
  return {
    ...state,
    clips: state.clips.filter((clip) => clip.id !== clipId),
    selection: {
      clipIds: state.selection.clipIds.filter((id) => id !== clipId),
      automationPointIds: state.selection.automationPointIds,
    },
  };
}

function pasteClips(
  state: PlaylistState,
  entries: { clip: import("./types").PlaylistClip; trackIndex: number }[],
  selectIds: string[],
): PlaylistState {
  if (entries.length === 0) {
    return state;
  }
  const maxTrackIndex = entries.reduce(
    (max, entry) => Math.max(max, Math.max(0, Math.floor(entry.trackIndex))),
    state.tracks.length - 1,
  );
  const materialized = materializeTracksThrough(state, maxTrackIndex);
  const existingIds = new Set(materialized.clips.map((clip) => clip.id));
  const newClips = entries
    .filter((entry) => !existingIds.has(entry.clip.id))
    .map((entry) => ({
      ...entry.clip,
      trackId: getTrackIdByIndex(materialized, entry.trackIndex),
    }));
  if (newClips.length === 0) {
    return materialized;
  }
  return {
    ...materialized,
    clips: [...materialized.clips, ...newClips],
    selection: {
      clipIds: [...selectIds],
      automationPointIds: [],
    },
  };
}

function toggleClipMute(state: PlaylistState, clipId: string): PlaylistState {
  let changed = false;
  const clips = state.clips.map((clip) => {
    if (clip.id !== clipId) {
      return clip;
    }
    changed = true;
    return { ...clip, muted: !clip.muted };
  });
  return changed ? { ...state, clips } : state;
}

function toggleTrackFlag(
  state: PlaylistState,
  trackIndex: number,
  flag: "muted" | "soloed" | "locked",
): PlaylistState {
  const materialized = materializeTracksThrough(state, trackIndex);
  const tracks = materialized.tracks.map((track, index) =>
    index === trackIndex ? { ...track, [flag]: !track[flag] } : track,
  );
  return { ...materialized, tracks };
}

function setTrackHeight(
  state: PlaylistState,
  trackIndex: number,
  height: number,
  metrics: PlaylistMetrics,
): PlaylistState {
  const materialized = materializeTracksThrough(state, trackIndex);
  const clamped = Math.round(
    Math.min(metrics.trackMaxHeight, Math.max(metrics.trackMinHeight, height)),
  );
  const tracks = materialized.tracks.map((track, index) =>
    index === trackIndex ? { ...track, height: clamped } : track,
  );
  return { ...materialized, tracks };
}

function reorderTrack(
  state: PlaylistState,
  fromIndex: number,
  toIndex: number,
): PlaylistState {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    fromIndex >= state.tracks.length
  ) {
    return state;
  }
  const clamped = Math.max(0, Math.min(toIndex, state.tracks.length - 1));
  if (clamped === fromIndex) {
    return state;
  }
  const tracks = [...state.tracks];
  const [moved] = tracks.splice(fromIndex, 1);
  tracks.splice(clamped, 0, moved!);
  return { ...state, tracks };
}

function makeClipsUnique(
  state: PlaylistState,
  clipIds: string[],
): PlaylistState {
  if (clipIds.length === 0) {
    return state;
  }
  const targets = new Set(clipIds);
  let changed = false;
  const clips = state.clips.map((clip) => {
    if (!targets.has(clip.id)) {
      return clip;
    }
    changed = true;
    return { ...clip, sourceId: clip.id };
  });
  return changed ? { ...state, clips } : state;
}

function setClipField<K extends "label" | "color">(
  state: PlaylistState,
  clipId: string,
  field: K,
  value: string,
): PlaylistState {
  let changed = false;
  const clips = state.clips.map((clip) => {
    if (clip.id !== clipId) {
      return clip;
    }
    if (clip[field] === value) {
      return clip;
    }
    changed = true;
    return { ...clip, [field]: value };
  });
  return changed ? { ...state, clips } : state;
}

function setClipNumericField<K extends "contentOffset" | "stretchRatio">(
  state: PlaylistState,
  clipId: string,
  field: K,
  value: number,
): PlaylistState {
  let changed = false;
  const clips = state.clips.map((clip) => {
    if (clip.id !== clipId) {
      return clip;
    }
    if (clip[field] === value) {
      return clip;
    }
    changed = true;
    return { ...clip, [field]: value };
  });
  return changed ? { ...state, clips } : state;
}

function stretchResizeClip(
  state: PlaylistState,
  clipId: string,
  edge: "left" | "right",
  time: number,
  metrics: PlaylistMetrics,
): PlaylistState {
  const clips = state.clips.map((clip) => {
    if (clip.id !== clipId) {
      return clip;
    }
    const oldDuration = clip.duration;
    if (oldDuration <= 0) return clip;
    const start = clip.start;
    const end = clip.start + clip.duration;
    let nextStart = start;
    let nextDuration = oldDuration;
    if (edge === "right") {
      nextDuration = Math.max(metrics.minClipDuration, time - start);
    } else {
      nextStart = Math.min(end - metrics.minClipDuration, Math.max(0, time));
      nextDuration = end - nextStart;
    }
    const factor = nextDuration / oldDuration;
    if (!Number.isFinite(factor) || factor <= 0) return clip;
    const baseRatio = clip.stretchRatio ?? 1;
    return {
      ...clip,
      start: nextStart,
      duration: nextDuration,
      stretchRatio: baseRatio * factor,
    };
  });
  return { ...state, clips };
}

function sortMarkers(
  markers: import("./types").PlaylistMarker[],
): import("./types").PlaylistMarker[] {
  return [...markers].sort((a, b) => a.time - b.time);
}

function sliceClipsAtTime(
  state: PlaylistState,
  time: number,
  newClips: import("./types").PlaylistClip[],
): PlaylistState {
  const newById = new Map(newClips.map((c) => [c.id, c] as const));
  const adjusted: PlaylistState["clips"] = [];
  for (const clip of state.clips) {
    if (
      time > clip.start + 1e-6 &&
      time < clip.start + clip.duration - 1e-6
    ) {
      // Left half stays in place; its duration shrinks to (time - start).
      adjusted.push({
        ...clip,
        duration: time - clip.start,
      });
    } else {
      adjusted.push(clip);
    }
  }
  // Append the right halves built by the wrapper.
  return {
    ...state,
    clips: [
      ...adjusted,
      ...newClips.filter((c) => !state.clips.some((x) => x.id === c.id)),
    ].map((clip) => newById.get(clip.id) ?? clip),
  };
}

function deleteEmptyTrack(
  state: PlaylistState,
  trackIndex: number,
): PlaylistState {
  const materialized = materializeTracksThrough(state, trackIndex);
  const trackId = getTrackIdByIndex(materialized, trackIndex);
  if (
    materialized.clips.some((clip) => clip.trackId === trackId) ||
    materialized.tracks.length <= 1
  ) {
    return { ...materialized, contextMenu: null };
  }
  return {
    ...materialized,
    tracks: materialized.tracks.filter((_, index) => index !== trackIndex),
    contextMenu: null,
  };
}
