import {
  clamp,
  getTrackIdByIndex,
  isAutomationClip,
} from "./geometry";
import {
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistContextMenu,
  type PlaylistMarquee,
  type PlaylistMetrics,
  type PlaylistPoint,
  type PlaylistSelection,
  type PlaylistState,
  type PlaylistStateListener,
} from "./types";
import type { PlaylistPresentation } from "./presentation";
import { createPlaylistPresentation } from "./presentation";
import {
  createInsertedTrack,
  makePointId,
  materializeTracksThrough,
} from "./state-track-helpers";
import { normalizeState, sortAutomationPoints } from "./state-utils";

// PlaylistCore is the mutable facade. Keep pure transforms in the helper modules.
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

export class PlaylistCore {
  private state: PlaylistState;

  private readonly listeners = new Set<PlaylistStateListener>();

  private presentationCache:
    | { state: PlaylistState; presentation: PlaylistPresentation }
    | null = null;

  readonly metrics: PlaylistMetrics;

  constructor(initialState: PlaylistState, options: PlaylistCoreOptions = {}) {
    this.metrics = options.metrics ?? DEFAULT_PLAYLIST_METRICS;
    this.state = normalizeState(initialState, this.metrics);
  }

  // Lifecycle and derived presentation.
  getState(): PlaylistState {
    return this.state;
  }

  getPresentation(): PlaylistPresentation {
    if (this.presentationCache?.state === this.state) {
      return this.presentationCache.presentation;
    }

    const presentation = createPlaylistPresentation(this.state, this.metrics);
    this.presentationCache = {
      state: this.state,
      presentation,
    };

    return presentation;
  }

  // Subscription management.
  subscribe(listener: PlaylistStateListener): PlaylistSubscription {
    this.listeners.add(listener);

    return {
      unsubscribe: () => {
        this.listeners.delete(listener);
      },
    };
  }

  // Viewport and selection.
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

  setContextMenu(contextMenu: PlaylistContextMenu): void {
    this.commit({
      ...this.state,
      contextMenu: contextMenu
        ? {
            ...contextMenu,
            position: { ...contextMenu.position },
          }
        : null,
    });
  }

  openTrackContextMenu(trackIndex: number, position: PlaylistPoint): void {
    const materialized = materializeTracksThrough(this.state, trackIndex);

    this.commit({
      ...materialized,
      contextMenu: {
        kind: "track",
        trackIndex: Math.max(0, Math.floor(trackIndex)),
        position: { ...position },
      },
    });
  }

  closeContextMenu(): void {
    this.setContextMenu(null);
  }

  setHover(hover: PlaylistState["hover"]): void {
    this.commit({
      ...this.state,
      hover: hover ? { ...hover } : null,
    });
  }

  setPlayPosition(time: number): void {
    this.commit({
      ...this.state,
      playPosition: {
        ...this.state.playPosition,
        time: Math.max(0, time),
      },
    });
  }

  setPlayPositionRunning(isRunning: boolean): void {
    this.commit({
      ...this.state,
      playPosition: {
        ...this.state.playPosition,
        isRunning,
      },
    });
  }

  advancePlayPosition(deltaTime: number): void {
    if (!this.state.playPosition.isRunning) {
      return;
    }

    this.setPlayPosition(this.state.playPosition.time + Math.max(0, deltaTime));
  }

  // Track and clip mutations.
  moveClips(updates: PlaylistClipMoveUpdate[]): void {
    const byId = new Map(updates.map((update) => [update.id, update]));
    const maxTrackIndex = updates.reduce(
      (max, update) => Math.max(max, Math.max(0, Math.floor(update.trackIndex))),
      this.state.tracks.length - 1,
    );
    const state = materializeTracksThrough(this.state, maxTrackIndex);
    const clips = state.clips.map((clip) => {
      const update = byId.get(clip.id);

      if (!update) {
        return clip;
      }

      return {
        ...clip,
        start: Math.max(0, update.start),
        trackId: getTrackIdByIndex(state, update.trackIndex),
      };
    });

    this.commit({ ...state, clips });
  }

  clearTrackClips(trackIndex: number): void {
    const state = materializeTracksThrough(this.state, trackIndex);
    const trackId = getTrackIdByIndex(state, trackIndex);
    const removedIds = new Set(
      state.clips.filter((clip) => clip.trackId === trackId).map((clip) => clip.id),
    );

    this.commit({
      ...state,
      clips: state.clips.filter((clip) => clip.trackId !== trackId),
      selection: {
        clipIds: state.selection.clipIds.filter((id) => !removedIds.has(id)),
        automationPointIds: state.selection.automationPointIds,
      },
      contextMenu: null,
    });
  }

  deleteSelectedClipsOnTrack(trackIndex: number): void {
    const state = materializeTracksThrough(this.state, trackIndex);
    const trackId = getTrackIdByIndex(state, trackIndex);
    const selected = new Set(state.selection.clipIds);
    const removedIds = new Set(
      state.clips
        .filter((clip) => clip.trackId === trackId && selected.has(clip.id))
        .map((clip) => clip.id),
    );

    this.commit({
      ...state,
      clips: state.clips.filter((clip) => !removedIds.has(clip.id)),
      selection: {
        clipIds: state.selection.clipIds.filter((id) => !removedIds.has(id)),
        automationPointIds: state.selection.automationPointIds,
      },
      contextMenu: null,
    });
  }

  renameTrack(trackIndex: number, label: string): void {
    const state = materializeTracksThrough(this.state, trackIndex);
    const tracks = state.tracks.map((track, index) =>
      index === trackIndex ? { ...track, label } : track,
    );

    this.commit({ ...state, tracks, contextMenu: null });
  }

  recolorTrack(trackIndex: number, color: string): void {
    const state = materializeTracksThrough(this.state, trackIndex);
    const tracks = state.tracks.map((track, index) =>
      index === trackIndex ? { ...track, color } : track,
    );

    this.commit({ ...state, tracks, contextMenu: null });
  }

  insertTrackBelow(trackIndex: number): void {
    const state = materializeTracksThrough(this.state, trackIndex);
    const tracks = [...state.tracks];
    tracks.splice(trackIndex + 1, 0, createInsertedTrack(tracks, trackIndex));

    this.commit({ ...state, tracks, contextMenu: null });
  }

  deleteEmptyTrack(trackIndex: number): void {
    const state = materializeTracksThrough(this.state, trackIndex);
    const trackId = getTrackIdByIndex(state, trackIndex);

    if (state.clips.some((clip) => clip.trackId === trackId) || state.tracks.length <= 1) {
      this.closeContextMenu();
      return;
    }

    this.commit({
      ...state,
      tracks: state.tracks.filter((_, index) => index !== trackIndex),
      contextMenu: null,
    });
  }

  // Automation mutations.
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

  // Commit and notify listeners.
  private commit(nextState: PlaylistState): void {
    this.state = normalizeState(nextState, this.metrics);
    this.presentationCache = null;

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
