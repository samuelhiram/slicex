import {
  isUndoableAction,
  type PlaylistAction,
  type PlaylistClipMoveUpdate,
} from "./actions";
import { getTrackIdByIndex, isAutomationClip } from "./geometry";
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  replacePresent,
  undoHistory,
  type History,
} from "./history";
import { playlistReducer } from "./reducer";
import {
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistAutomationPoint,
  type PlaylistClip,
  type PlaylistClipType,
  type PlaylistContextMenu,
  type PlaylistMarquee,
  type PlaylistMetrics,
  type PlaylistPoint,
  type PlaylistSelection,
  type PlaylistState,
  type PlaylistStateListener,
  type PlaylistToolId,
} from "./types";
import type { PlaylistPresentation } from "./presentation";
import { createPlaylistPresentation } from "./presentation";
import { makeClipId, makePointId } from "./state-track-helpers";
import { normalizeState } from "./state-utils";

export type { PlaylistClipMoveUpdate } from "./actions";

export interface PlaylistCreateClipInput {
  trackIndex: number;
  start: number;
  duration: number;
  type?: PlaylistClipType;
  id?: string;
  label?: string;
  color?: string;
  muted?: boolean;
  points?: PlaylistAutomationPoint[];
}

// PlaylistCore is the mutable facade backed by a pure reducer + history stack.
// The public API mirrors the original mutator surface so consumers (controller,
// shell) keep working unchanged. Internally each mutator dispatches an action.
export interface PlaylistCoreOptions {
  metrics?: PlaylistMetrics;
}

export interface PlaylistSubscription {
  unsubscribe: () => void;
}

export class PlaylistCore {
  private history: History<PlaylistState>;

  private readonly listeners = new Set<PlaylistStateListener>();

  private presentationCache: {
    state: PlaylistState;
    presentation: PlaylistPresentation;
  } | null = null;

  private gestureDepth = 0;
  private gestureSnapshot: PlaylistState | null = null;

  readonly metrics: PlaylistMetrics;

  constructor(initialState: PlaylistState, options: PlaylistCoreOptions = {}) {
    this.metrics = options.metrics ?? DEFAULT_PLAYLIST_METRICS;
    this.history = createHistory(normalizeState(initialState, this.metrics));
  }

  // Lifecycle and derived presentation.
  getState(): PlaylistState {
    return this.history.present;
  }

  getPresentation(): PlaylistPresentation {
    if (this.presentationCache?.state === this.history.present) {
      return this.presentationCache.presentation;
    }
    const presentation = createPlaylistPresentation(
      this.history.present,
      this.metrics,
    );
    this.presentationCache = {
      state: this.history.present,
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

  // Generic dispatch — any caller (including future tools/gestures) can use this directly.
  dispatch(action: PlaylistAction): void {
    const previous = this.history.present;
    const next = normalizeState(
      playlistReducer(previous, action, this.metrics),
      this.metrics,
    );
    if (next === previous) {
      return;
    }
    if (isUndoableAction(action) && this.gestureDepth === 0) {
      this.history = pushHistory(this.history, next);
    } else {
      this.history = replacePresent(this.history, next);
    }
    this.notify();
  }

  // Gesture brackets — coalesce many transient mutations into a single undo entry.
  beginGesture(): void {
    if (this.gestureDepth === 0) {
      this.gestureSnapshot = this.history.present;
    }
    this.gestureDepth += 1;
  }

  endGesture(): void {
    if (this.gestureDepth === 0) {
      return;
    }
    this.gestureDepth -= 1;
    if (this.gestureDepth > 0 || !this.gestureSnapshot) {
      return;
    }
    const snapshot = this.gestureSnapshot;
    this.gestureSnapshot = null;
    if (snapshot === this.history.present) {
      return;
    }
    this.history = {
      past: [...this.history.past, snapshot],
      present: this.history.present,
      future: [],
    };
    this.notify();
  }

  // Undo / redo.
  undo(): boolean {
    if (!canUndo(this.history)) {
      return false;
    }
    this.history = undoHistory(this.history);
    this.gestureDepth = 0;
    this.gestureSnapshot = null;
    this.notify();
    return true;
  }

  redo(): boolean {
    if (!canRedo(this.history)) {
      return false;
    }
    this.history = redoHistory(this.history);
    this.gestureDepth = 0;
    this.gestureSnapshot = null;
    this.notify();
    return true;
  }

  canUndo(): boolean {
    return canUndo(this.history);
  }

  canRedo(): boolean {
    return canRedo(this.history);
  }

  // Viewport and selection.
  setViewportSize(width: number, height: number): void {
    this.dispatch({ type: "SET_VIEWPORT_SIZE", width, height });
  }

  updateViewport(
    patch: Partial<PlaylistState["viewport"]>,
    options: { clamp?: boolean } = {},
  ): void {
    this.dispatch({
      type: "UPDATE_VIEWPORT",
      patch,
      clamp: options.clamp !== false,
    });
  }

  setSelection(selection: Partial<PlaylistSelection>): void {
    this.dispatch({ type: "SET_SELECTION", selection });
  }

  setMarquee(marquee: PlaylistMarquee | null): void {
    this.dispatch({ type: "SET_MARQUEE", marquee });
  }

  setContextMenu(contextMenu: PlaylistContextMenu): void {
    this.dispatch({ type: "SET_CONTEXT_MENU", contextMenu });
  }

  openTrackContextMenu(trackIndex: number, position: PlaylistPoint): void {
    this.dispatch({ type: "OPEN_TRACK_CONTEXT_MENU", trackIndex, position });
  }

  closeContextMenu(): void {
    this.dispatch({ type: "CLOSE_CONTEXT_MENU" });
  }

  setHover(hover: PlaylistState["hover"]): void {
    this.dispatch({ type: "SET_HOVER", hover });
  }

  setPlayPosition(time: number): void {
    this.dispatch({ type: "SET_PLAY_POSITION", time });
  }

  setPlayPositionRunning(isRunning: boolean): void {
    this.dispatch({ type: "SET_PLAY_RUNNING", isRunning });
  }

  advancePlayPosition(deltaTime: number): void {
    this.dispatch({ type: "ADVANCE_PLAY_POSITION", deltaTime });
  }

  // Track and clip mutations.
  moveClips(updates: PlaylistClipMoveUpdate[]): void {
    this.dispatch({ type: "MOVE_CLIPS", updates });
  }

  clearTrackClips(trackIndex: number): void {
    this.dispatch({ type: "CLEAR_TRACK_CLIPS", trackIndex });
  }

  deleteSelectedClipsOnTrack(trackIndex: number): void {
    this.dispatch({ type: "DELETE_SELECTED_CLIPS_ON_TRACK", trackIndex });
  }

  renameTrack(trackIndex: number, label: string): void {
    this.dispatch({ type: "RENAME_TRACK", trackIndex, label });
  }

  recolorTrack(trackIndex: number, color: string): void {
    this.dispatch({ type: "RECOLOR_TRACK", trackIndex, color });
  }

  insertTrackBelow(trackIndex: number): void {
    this.dispatch({ type: "INSERT_TRACK_BELOW", trackIndex });
  }

  deleteEmptyTrack(trackIndex: number): void {
    this.dispatch({ type: "DELETE_EMPTY_TRACK", trackIndex });
  }

  resizeClip(clipId: string, edge: "left" | "right", time: number): void {
    this.dispatch({ type: "RESIZE_CLIP", clipId, edge, time });
  }

  moveAutomationPoint(
    clipId: string,
    pointId: string,
    time: number,
    value: number,
  ): void {
    this.dispatch({
      type: "MOVE_AUTOMATION_POINT",
      clipId,
      pointId,
      time,
      value,
    });
  }

  addAutomationPoint(
    clipId: string,
    time: number,
    value: number,
  ): string | null {
    const clip = this.history.present.clips.find(
      (candidate) => candidate.id === clipId,
    );
    if (!clip || !isAutomationClip(clip)) {
      return null;
    }
    const pointId = makePointId(clip);
    this.dispatch({
      type: "ADD_AUTOMATION_POINT",
      clipId,
      pointId,
      time,
      value,
    });
    return pointId;
  }

  removeAutomationPoint(clipId: string, pointId: string): void {
    this.dispatch({ type: "REMOVE_AUTOMATION_POINT", clipId, pointId });
  }

  removeSelected(): void {
    this.dispatch({ type: "REMOVE_SELECTED" });
  }

  // Tool selection (UI-only, not undoable).
  setTool(tool: PlaylistToolId): void {
    this.dispatch({ type: "SET_TOOL", tool });
  }

  // Clip CRUD used by the tool dispatchers (Draw, Paint, Delete, Mute).
  createClip(input: PlaylistCreateClipInput): string {
    const state = this.history.present;
    const trackId = getTrackIdByIndex(state, input.trackIndex);
    const id = input.id ?? makeClipId(state.clips);
    const baseClip = {
      id,
      type: input.type ?? "pattern",
      trackId,
      start: Math.max(0, input.start),
      duration: Math.max(this.metrics.minClipDuration, input.duration),
      label: input.label ?? "Clip",
      color: input.color ?? "#888888",
      muted: input.muted,
    };
    const clip: PlaylistClip =
      baseClip.type === "automation"
        ? {
            ...baseClip,
            type: "automation",
            points: input.points ?? [
              { id: `${id}-pt-1`, time: 0, value: 0.5 },
              { id: `${id}-pt-2`, time: baseClip.duration, value: 0.5 },
            ],
          }
        : { ...baseClip, type: baseClip.type };
    this.dispatch({ type: "CREATE_CLIP", clip });
    return id;
  }

  deleteClip(clipId: string): void {
    this.dispatch({ type: "DELETE_CLIP", clipId });
  }

  toggleClipMute(clipId: string): void {
    this.dispatch({ type: "TOGGLE_CLIP_MUTE", clipId });
  }

  // Notify subscribers about the latest committed state.
  private notify(): void {
    this.presentationCache = null;
    for (const listener of this.listeners) {
      listener(this.history.present);
    }
  }
}

export function createPlaylistCore(
  initialState: PlaylistState,
  options?: PlaylistCoreOptions,
): PlaylistCore {
  return new PlaylistCore(initialState, options);
}
