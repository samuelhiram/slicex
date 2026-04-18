import {
  clamp,
  getMaxScrollX,
  getMaxScrollY,
  getTrackIdByIndex,
  getTrackIndexById,
  isAutomationClip,
} from "./geometry";
import {
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistAutomationClip,
  type PlaylistClip,
  type PlaylistMarquee,
  type PlaylistMetrics,
  type PlaylistSelection,
  type PlaylistState,
  type PlaylistStateListener,
} from "./types";

export interface PlaylistCoreOptions {
  metrics?: PlaylistMetrics;
}

export interface PlaylistSubscription {
  unsubscribe: () => void;
}

export interface PlaylistClipMoveUpdate {
  id: string;
  start: number;
  trackIndex: number;
}

function cloneSelection(selection: PlaylistSelection): PlaylistSelection {
  return {
    clipIds: [...selection.clipIds],
    automationPointIds: [...selection.automationPointIds],
  };
}

function cloneClip(clip: PlaylistClip): PlaylistClip {
  if (isAutomationClip(clip)) {
    return {
      ...clip,
      points: clip.points.map((point) => ({ ...point })),
    };
  }

  return { ...clip };
}

function cloneState(state: PlaylistState): PlaylistState {
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
    hover: state.hover ? { ...state.hover } : null,
    playhead: state.playhead,
  };
}

function sortAutomationPoints(
  points: PlaylistAutomationClip["points"],
): PlaylistAutomationClip["points"] {
  return [...points].sort((left, right) => left.time - right.time);
}

function normalizeState(
  input: PlaylistState,
  metrics: PlaylistMetrics,
): PlaylistState {
  const state = cloneState(input);

  state.viewport.pxPerBeat = clamp(
    state.viewport.pxPerBeat,
    metrics.minPxPerBeat,
    metrics.maxPxPerBeat,
  );
  state.viewport.scrollX = clamp(state.viewport.scrollX, 0, getMaxScrollX(state, metrics));
  state.viewport.scrollY = clamp(state.viewport.scrollY, 0, getMaxScrollY(state, metrics));
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

function makePointId(clip: PlaylistAutomationClip): string {
  let index = clip.points.length + 1;
  let id = `${clip.id}-pt-${index}`;

  while (clip.points.some((point) => point.id === id)) {
    index += 1;
    id = `${clip.id}-pt-${index}`;
  }

  return id;
}

export class PlaylistCore {
  private state: PlaylistState;

  private readonly listeners = new Set<PlaylistStateListener>();

  readonly metrics: PlaylistMetrics;

  constructor(initialState: PlaylistState, options: PlaylistCoreOptions = {}) {
    this.metrics = options.metrics ?? DEFAULT_PLAYLIST_METRICS;
    this.state = normalizeState(initialState, this.metrics);
  }

  getState(): PlaylistState {
    return this.state;
  }

  subscribe(listener: PlaylistStateListener): PlaylistSubscription {
    this.listeners.add(listener);

    return {
      unsubscribe: () => {
        this.listeners.delete(listener);
      },
    };
  }

  setViewportSize(width: number, height: number): void {
    this.commit({
      ...this.state,
      viewport: {
        ...this.state.viewport,
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      },
    });
  }

  updateViewport(
    patch: Partial<PlaylistState["viewport"]>,
    options: { clamp?: boolean } = {},
  ): void {
    const next = {
      ...this.state,
      viewport: {
        ...this.state.viewport,
        ...patch,
      },
    };

    if (options.clamp === false) {
      this.commit(next);
      return;
    }

    this.commit(normalizeState(next, this.metrics));
  }

  setSelection(selection: Partial<PlaylistSelection>): void {
    this.commit({
      ...this.state,
      selection: {
        clipIds: selection.clipIds
          ? [...selection.clipIds]
          : this.state.selection.clipIds,
        automationPointIds: selection.automationPointIds
          ? [...selection.automationPointIds]
          : this.state.selection.automationPointIds,
      },
    });
  }

  setMarquee(marquee: PlaylistMarquee | null): void {
    this.commit({
      ...this.state,
      marquee: marquee
        ? {
            start: { ...marquee.start },
            current: { ...marquee.current },
          }
        : null,
    });
  }

  setHover(hover: PlaylistState["hover"]): void {
    this.commit({
      ...this.state,
      hover: hover ? { ...hover } : null,
    });
  }

  setPlayhead(playhead: number): void {
    this.commit({
      ...this.state,
      playhead: Math.max(0, playhead),
    });
  }

  moveClips(updates: PlaylistClipMoveUpdate[]): void {
    const byId = new Map(updates.map((update) => [update.id, update]));
    const clips = this.state.clips.map((clip) => {
      const update = byId.get(clip.id);

      if (!update) {
        return clip;
      }

      return {
        ...clip,
        start: Math.max(0, update.start),
        trackId: getTrackIdByIndex(this.state, update.trackIndex),
      };
    });

    this.commit({ ...this.state, clips });
  }

  resizeClip(clipId: string, edge: "left" | "right", time: number): void {
    const clips = this.state.clips.map((clip) => {
      if (clip.id !== clipId) {
        return clip;
      }

      const start = clip.start;
      const end = clip.start + clip.duration;

      if (edge === "right") {
        const nextEnd = Math.max(start + this.metrics.minClipDuration, time);
        return { ...clip, duration: nextEnd - start };
      }

      const nextStart = clamp(
        time,
        0,
        end - this.metrics.minClipDuration,
      );
      return { ...clip, start: nextStart, duration: end - nextStart };
    });

    this.commit({ ...this.state, clips });
  }

  moveAutomationPoint(
    clipId: string,
    pointId: string,
    time: number,
    value: number,
  ): void {
    const clips = this.state.clips.map((clip) => {
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

    this.commit({ ...this.state, clips });
  }

  addAutomationPoint(
    clipId: string,
    time: number,
    value: number,
  ): string | null {
    let createdId: string | null = null;
    const clips = this.state.clips.map((clip) => {
      if (clip.id !== clipId || !isAutomationClip(clip)) {
        return clip;
      }

      createdId = makePointId(clip);

      return {
        ...clip,
        points: sortAutomationPoints([
          ...clip.points,
          {
            id: createdId,
            time: clamp(time, 0, clip.duration),
            value: clamp(value, 0, 1),
          },
        ]),
      };
    });

    if (!createdId) {
      return null;
    }

    this.commit({
      ...this.state,
      clips,
      selection: { clipIds: [clipId], automationPointIds: [createdId] },
    });

    return createdId;
  }

  removeAutomationPoint(clipId: string, pointId: string): void {
    const clips = this.state.clips.map((clip) => {
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

    this.commit({
      ...this.state,
      clips,
      selection: {
        clipIds: this.state.selection.clipIds,
        automationPointIds: this.state.selection.automationPointIds.filter(
          (id) => id !== pointId,
        ),
      },
    });
  }

  removeSelected(): void {
    const selectedClipIds = new Set(this.state.selection.clipIds);
    const selectedPointIds = new Set(this.state.selection.automationPointIds);

    const clips = this.state.clips
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

    this.commit({
      ...this.state,
      clips,
      selection: { clipIds: [], automationPointIds: [] },
    });
  }

  private commit(nextState: PlaylistState): void {
    this.state = normalizeState(nextState, this.metrics);

    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

export function createPlaylistCore(
  initialState: PlaylistState,
  options?: PlaylistCoreOptions,
): PlaylistCore {
  return new PlaylistCore(initialState, options);
}
