import {
  clamp,
  getMaxScrollX,
  getMaxScrollY,
  isAutomationClip,
} from "./geometry";
import type {
  PlaylistAutomationClip,
  PlaylistClip,
  PlaylistMetrics,
  PlaylistSelection,
  PlaylistState,
} from "./types";

// Pure state transforms live here so the mutable PlaylistCore facade stays small and easy to scan.
export function cloneSelection(
  selection: PlaylistSelection,
): PlaylistSelection {
  return {
    clipIds: [...selection.clipIds],
    automationPointIds: [...selection.automationPointIds],
  };
}

export function cloneClip(clip: PlaylistClip): PlaylistClip {
  if (isAutomationClip(clip)) {
    return {
      ...clip,
      points: clip.points.map((point) => ({ ...point })),
    };
  }

  return { ...clip };
}

export function cloneState(state: PlaylistState): PlaylistState {
  return {
    tracks: state.tracks.map((track) => ({ ...track })),
    clips: state.clips.map(cloneClip),
    viewport: { ...state.viewport },
    snap: { ...state.snap },
    selection: cloneSelection(state.selection),
    marquee: state.marquee
      ? {
          start: { ...state.marquee.start },
          current: { ...state.marquee.current },
        }
      : null,
    contextMenu: state.contextMenu
      ? {
          ...state.contextMenu,
          position: { ...state.contextMenu.position },
        }
      : null,
    hover: state.hover ? { ...state.hover } : null,
    playPosition: { ...state.playPosition },
    tool: state.tool ?? "select",
    clipboard: state.clipboard
      ? {
          entries: state.clipboard.entries.map((entry) => ({
            clip: cloneClip(entry.clip),
            startOffset: entry.startOffset,
            trackOffset: entry.trackOffset,
          })),
          span: state.clipboard.span,
        }
      : null,
    stretchMode: state.stretchMode ?? false,
  };
}

export function sortAutomationPoints(
  points: PlaylistAutomationClip["points"],
): PlaylistAutomationClip["points"] {
  return [...points].sort((left, right) => left.time - right.time);
}

export function normalizeState(
  input: PlaylistState,
  metrics: PlaylistMetrics,
): PlaylistState {
  const state = cloneState(input);

  state.viewport.pxPerBeat = clamp(
    state.viewport.pxPerBeat,
    metrics.minPxPerBeat,
    metrics.maxPxPerBeat,
  );
  state.viewport.scrollX = clamp(
    state.viewport.scrollX,
    0,
    getMaxScrollX(state, metrics),
  );
  state.viewport.scrollY = clamp(
    state.viewport.scrollY,
    0,
    getMaxScrollY(state, metrics),
  );
  state.playPosition.time = Math.max(0, state.playPosition.time);
  state.clips = state.clips.map((clip) => {
    const duration = Math.max(metrics.minClipDuration, clip.duration);
    const start = Math.max(0, clip.start);

    if (isAutomationClip(clip)) {
      return {
        ...clip,
        start,
        duration,
        points: sortAutomationPoints(
          clip.points.map((point) => ({
            ...point,
            time: clamp(point.time, 0, duration),
            value: clamp(point.value, 0, 1),
          })),
        ),
      };
    }

    return { ...clip, start, duration };
  });

  return state;
}
