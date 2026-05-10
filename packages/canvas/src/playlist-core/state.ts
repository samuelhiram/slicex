import {
  isUndoableAction,
  type PlaylistAction,
  type PlaylistClipMoveUpdate,
} from "./actions";
import {
  getTrackIdByIndex,
  getTrackIndexById,
  isAutomationClip,
} from "./geometry";
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
  type PlaylistClipboard,
  type PlaylistContextMenu,
  type PlaylistMarquee,
  type PlaylistMetrics,
  type PlaylistPoint,
  type PlaylistSelection,
  type PlaylistSnapMode,
  type PlaylistState,
  type PlaylistStateListener,
  type PlaylistToolId,
} from "./types";
import type { PlaylistPresentation } from "./presentation";
import { createPlaylistPresentation } from "./presentation";
import { makeClipId, makePointId } from "./state-track-helpers";
import { cloneClip } from "./state-utils";
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
  sourceId?: string;
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
    const reduced = playlistReducer(previous, action, this.metrics);
    // Reducer signals "no change" by returning the same reference. Skip
    // normalization and notify entirely so callers like advancePlayPosition
    // (60 fps from the rAF tick) don't churn allocations and re-renders
    // when they're effectively a no-op.
    if (reduced === previous) {
      return;
    }
    const next = normalizeState(reduced, this.metrics);
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
    const state = this.history.present;
    const filtered = updates.filter((update) => {
      const clip = state.clips.find((candidate) => candidate.id === update.id);
      if (!clip) return false;
      // Cannot move a clip that lives on a locked track.
      const fromIndex = getTrackIndexById(state, clip.trackId);
      if (state.tracks[fromIndex]?.locked) return false;
      // Cannot drop onto a locked track either.
      if (state.tracks[update.trackIndex]?.locked) return false;
      return true;
    });
    if (filtered.length === 0) return;
    this.dispatch({ type: "MOVE_CLIPS", updates: filtered });
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
    if (this.isClipOnLockedTrack(clipId)) return;
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
    const state = this.history.present;
    // Restrict removal to clips/points whose tracks are not locked. Currently
    // automation points share the host clip's track, so the same check covers
    // both clip ids and point ids.
    const lockedClipIds = new Set(
      state.clips
        .filter((clip) => {
          const idx = getTrackIndexById(state, clip.trackId);
          return state.tracks[idx]?.locked === true;
        })
        .map((clip) => clip.id),
    );
    if (lockedClipIds.size === 0) {
      this.dispatch({ type: "REMOVE_SELECTED" });
      return;
    }
    const safeClipIds = state.selection.clipIds.filter(
      (id) => !lockedClipIds.has(id),
    );
    if (
      safeClipIds.length === state.selection.clipIds.length &&
      state.selection.automationPointIds.length === 0
    ) {
      this.dispatch({ type: "REMOVE_SELECTED" });
      return;
    }
    if (
      safeClipIds.length === 0 &&
      state.selection.automationPointIds.length === 0
    ) {
      return;
    }
    // Temporarily narrow selection to non-locked items, dispatch, then
    // restore the original selection minus what was actually removed.
    this.beginGesture();
    this.setSelection({
      clipIds: safeClipIds,
      automationPointIds: state.selection.automationPointIds,
    });
    this.dispatch({ type: "REMOVE_SELECTED" });
    this.endGesture();
  }

  // Tool selection (UI-only, not undoable).
  setTool(tool: PlaylistToolId): void {
    this.dispatch({ type: "SET_TOOL", tool });
  }

  // Snap mode (UI-only, not undoable).
  setSnapMode(mode: PlaylistSnapMode): void {
    this.dispatch({ type: "SET_SNAP_MODE", mode });
  }

  toggleSnapNone(): void {
    this.dispatch({ type: "TOGGLE_SNAP_NONE" });
  }

  // Track flag wrappers (undoable).
  toggleTrackMute(trackIndex: number): void {
    this.dispatch({ type: "TOGGLE_TRACK_MUTE", trackIndex });
  }

  toggleTrackSolo(trackIndex: number): void {
    this.dispatch({ type: "TOGGLE_TRACK_SOLO", trackIndex });
  }

  toggleTrackLock(trackIndex: number): void {
    this.dispatch({ type: "TOGGLE_TRACK_LOCK", trackIndex });
  }

  setTrackHeight(trackIndex: number, height: number): void {
    this.dispatch({ type: "SET_TRACK_HEIGHT", trackIndex, height });
  }

  reorderTrack(fromIndex: number, toIndex: number): void {
    this.dispatch({ type: "REORDER_TRACK", fromIndex, toIndex });
  }

  isTrackLocked(trackIndex: number): boolean {
    return this.history.present.tracks[trackIndex]?.locked === true;
  }

  // Clip metadata wrappers (undoable).
  setClipLabel(clipId: string, label: string): void {
    if (this.isClipOnLockedTrack(clipId)) return;
    this.dispatch({ type: "SET_CLIP_LABEL", clipId, label });
  }

  setClipColor(clipId: string, color: string): void {
    if (this.isClipOnLockedTrack(clipId)) return;
    this.dispatch({ type: "SET_CLIP_COLOR", clipId, color });
  }

  setClipContentOffset(clipId: string, contentOffset: number): void {
    if (this.isClipOnLockedTrack(clipId)) return;
    this.dispatch({ type: "SET_CLIP_CONTENT_OFFSET", clipId, contentOffset });
  }

  setClipStretchRatio(clipId: string, stretchRatio: number): void {
    if (this.isClipOnLockedTrack(clipId)) return;
    this.dispatch({ type: "SET_CLIP_STRETCH_RATIO", clipId, stretchRatio });
  }

  // Resize-with-stretch: scales the clip's stretchRatio by the duration
  // change instead of cropping content. Used while stretchMode is on.
  stretchResizeClip(
    clipId: string,
    edge: "left" | "right",
    time: number,
  ): void {
    if (this.isClipOnLockedTrack(clipId)) return;
    this.dispatch({ type: "STRETCH_RESIZE_CLIP", clipId, edge, time });
  }

  // Slice every clip whose body crosses `time` (Slice tool drag / Insert key).
  // Each affected clip becomes a left half (truncated in place) plus a right
  // half pushed back into the state with a fresh id and a contentOffset that
  // represents the drop-in time of the cut. Locked tracks are skipped.
  sliceClipsAtTime(time: number): string[] {
    const state = this.history.present;
    const lockedTrackIds = new Set(
      state.tracks
        .filter((track) => track.locked === true)
        .map((track) => track.id),
    );
    const candidates = state.clips.filter(
      (clip) =>
        !lockedTrackIds.has(clip.trackId) &&
        time > clip.start + 1e-6 &&
        time < clip.start + clip.duration - 1e-6,
    );
    if (candidates.length === 0) {
      return [];
    }
    let working = [...state.clips];
    const newClips: PlaylistClip[] = [];
    for (const clip of candidates) {
      const newId = makeClipId(working);
      const baseOffset = clip.contentOffset ?? 0;
      const stretch = clip.stretchRatio ?? 1;
      const cutOffsetWithinContent = (time - clip.start) * stretch;
      const right: PlaylistClip = {
        ...cloneClip(clip),
        id: newId,
        start: time,
        duration: clip.start + clip.duration - time,
        sourceId: clip.sourceId ?? clip.id,
        contentOffset: baseOffset + cutOffsetWithinContent,
      };
      newClips.push(right);
      working = [...working, right];
    }
    this.dispatch({
      type: "SLICE_CLIPS_AT_TIME",
      time,
      newClips,
    });
    return newClips.map((c) => c.id);
  }

  // Stretch mode toggle (UI flag, not undoable).
  toggleStretchMode(): void {
    this.dispatch({ type: "TOGGLE_STRETCH_MODE" });
  }

  setStretchMode(enabled: boolean): void {
    this.dispatch({ type: "SET_STRETCH_MODE", enabled });
  }

  makeClipUnique(clipId: string): void {
    if (this.isClipOnLockedTrack(clipId)) return;
    this.dispatch({ type: "MAKE_CLIPS_UNIQUE", clipIds: [clipId] });
  }

  makeSelectionUnique(): void {
    const ids = this.history.present.selection.clipIds.filter(
      (id) => !this.isClipOnLockedTrack(id),
    );
    if (ids.length === 0) return;
    this.dispatch({ type: "MAKE_CLIPS_UNIQUE", clipIds: ids });
  }

  // FL Studio: Shift+C selects every clip whose sourceId matches the focused clip.
  selectAllSimilarClips(clipId: string): void {
    const state = this.history.present;
    const target = state.clips.find((clip) => clip.id === clipId);
    if (!target) return;
    const sourceId = target.sourceId ?? target.id;
    const ids = state.clips
      .filter((clip) => (clip.sourceId ?? clip.id) === sourceId)
      .map((clip) => clip.id);
    this.setSelection({ clipIds: ids, automationPointIds: [] });
  }

  selectClipSource(clipId: string): void {
    // Currently equivalent to "select all similar"; kept as a separate verb so
    // future phases can branch (e.g. focus the source in a Channel rack).
    this.selectAllSimilarClips(clipId);
  }

  // Clone the selected clips in place (same start, same track) with fresh
  // ids but matching sourceId. Returns the new clip ids and selects them.
  // Used by Shift-drag clone-drag in the select tool.
  cloneClipsInPlace(clipIds: string[]): string[] {
    const state = this.history.present;
    const ids = new Set(clipIds);
    const sourceClips = state.clips.filter(
      (clip) => ids.has(clip.id) && !this.isClipOnLockedTrack(clip.id),
    );
    if (sourceClips.length === 0) {
      return [];
    }
    let working = [...state.clips];
    const entries: { clip: PlaylistClip; trackIndex: number }[] = [];
    for (const source of sourceClips) {
      const id = makeClipId(working);
      const newClip: PlaylistClip = {
        ...cloneClip(source),
        id,
        sourceId: source.sourceId ?? source.id,
      };
      entries.push({
        clip: newClip,
        trackIndex: getTrackIndexById(state, source.trackId),
      });
      working = [...working, newClip];
    }
    const selectIds = entries.map((entry) => entry.clip.id);
    this.dispatch({ type: "PASTE_CLIPS", entries, selectIds });
    return selectIds;
  }

  // Context menu helpers used by the controller.
  openClipContextMenu(clipId: string, position: PlaylistPoint): void {
    this.dispatch({
      type: "SET_CONTEXT_MENU",
      contextMenu: { kind: "clip", clipId, position },
    });
  }

  openBackgroundContextMenu(
    time: number,
    trackIndex: number,
    position: PlaylistPoint,
  ): void {
    this.dispatch({
      type: "SET_CONTEXT_MENU",
      contextMenu: {
        kind: "background",
        time: Math.max(0, time),
        trackIndex: Math.max(0, trackIndex),
        position,
      },
    });
  }

  // Clip CRUD used by the tool dispatchers (Draw, Paint, Delete, Mute).
  createClip(input: PlaylistCreateClipInput): string {
    const state = this.history.present;
    if (state.tracks[input.trackIndex]?.locked) {
      return "";
    }
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
      sourceId: input.sourceId ?? id,
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
    if (this.isClipOnLockedTrack(clipId)) return;
    this.dispatch({ type: "DELETE_CLIP", clipId });
  }

  toggleClipMute(clipId: string): void {
    if (this.isClipOnLockedTrack(clipId)) return;
    this.dispatch({ type: "TOGGLE_CLIP_MUTE", clipId });
  }

  // Selection helpers (UI-only, not undoable).
  selectAllClips(): void {
    this.dispatch({ type: "SELECT_ALL_CLIPS" });
  }

  deselectAll(): void {
    this.dispatch({
      type: "SET_SELECTION",
      selection: { clipIds: [], automationPointIds: [] },
    });
  }

  invertClipSelection(): void {
    this.dispatch({ type: "INVERT_CLIP_SELECTION" });
  }

  toggleClipSelection(clipId: string): void {
    const current = this.history.present.selection.clipIds;
    const next = current.includes(clipId)
      ? current.filter((id) => id !== clipId)
      : [...current, clipId];
    this.setSelection({ clipIds: next, automationPointIds: [] });
  }

  addClipsToSelection(clipIds: string[]): void {
    const current = new Set(this.history.present.selection.clipIds);
    for (const id of clipIds) {
      current.add(id);
    }
    this.setSelection({
      clipIds: Array.from(current),
      automationPointIds: [],
    });
  }

  setClipSelection(clipIds: string[], options: { additive?: boolean } = {}): void {
    if (options.additive) {
      this.addClipsToSelection(clipIds);
      return;
    }
    this.setSelection({
      clipIds: [...clipIds],
      automationPointIds: [],
    });
  }

  // Range select between an anchor (first id in current selection, or the
  // target if selection is empty) and the target, inclusive, ordered by start.
  extendClipSelection(targetClipId: string): void {
    const state = this.history.present;
    const sorted = [...state.clips].sort((a, b) => a.start - b.start);
    const anchor =
      state.selection.clipIds.length > 0
        ? state.selection.clipIds[0]!
        : targetClipId;
    const anchorIdx = sorted.findIndex((c) => c.id === anchor);
    const targetIdx = sorted.findIndex((c) => c.id === targetClipId);
    if (anchorIdx < 0 || targetIdx < 0) {
      this.setSelection({
        clipIds: [targetClipId],
        automationPointIds: [],
      });
      return;
    }
    const [from, to] =
      anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
    const clipIds = sorted.slice(from, to + 1).map((c) => c.id);
    this.setSelection({ clipIds, automationPointIds: [] });
  }

  // Clipboard operations.
  copyToClipboard(): boolean {
    const state = this.history.present;
    const ids = new Set(state.selection.clipIds);
    const selected = state.clips.filter((clip) => ids.has(clip.id));
    if (selected.length === 0) {
      return false;
    }
    const minStart = selected.reduce(
      (min, clip) => Math.min(min, clip.start),
      Number.POSITIVE_INFINITY,
    );
    const maxEnd = selected.reduce(
      (max, clip) => Math.max(max, clip.start + clip.duration),
      0,
    );
    const trackIndices = selected.map((clip) =>
      getTrackIndexById(state, clip.trackId),
    );
    const baseTrackIndex = Math.min(...trackIndices);
    const clipboard: PlaylistClipboard = {
      entries: selected.map((clip, i) => ({
        clip: cloneClip(clip),
        startOffset: clip.start - minStart,
        trackOffset: trackIndices[i]! - baseTrackIndex,
      })),
      span: maxEnd - minStart,
    };
    this.dispatch({ type: "SET_CLIPBOARD", clipboard });
    return true;
  }

  cutSelection(): boolean {
    if (this.history.present.selection.clipIds.length === 0) {
      return false;
    }
    this.beginGesture();
    this.copyToClipboard();
    this.removeSelected();
    this.endGesture();
    return true;
  }

  pasteClipboard(
    options: { atTime?: number; atTrackIndex?: number } = {},
  ): string[] {
    const state = this.history.present;
    if (!state.clipboard || state.clipboard.entries.length === 0) {
      return [];
    }
    const startTime = options.atTime ?? state.playPosition.time;
    const baseTrackIndex =
      options.atTrackIndex ?? selectionBaseTrackIndex(state);
    const newEntries: { clip: PlaylistClip; trackIndex: number }[] = [];
    let workingClips = [...state.clips];
    for (const entry of state.clipboard.entries) {
      const id = makeClipId(workingClips);
      const trackIndex = Math.max(0, baseTrackIndex + entry.trackOffset);
      const newClip: PlaylistClip = {
        ...cloneClip(entry.clip),
        id,
        start: Math.max(0, startTime + entry.startOffset),
        // Pasted clips share the source of the originals (FL Studio: paste
        // produces siblings, not unique copies). Falls back to the original
        // id when the source itself had no explicit sourceId.
        sourceId: entry.clip.sourceId ?? entry.clip.id,
      };
      newEntries.push({ clip: newClip, trackIndex });
      workingClips = [...workingClips, newClip];
    }
    const selectIds = newEntries.map((entry) => entry.clip.id);
    this.dispatch({
      type: "PASTE_CLIPS",
      entries: newEntries,
      selectIds,
    });
    return selectIds;
  }

  duplicateSelectionRight(): string[] {
    const state = this.history.present;
    const ids = new Set(state.selection.clipIds);
    const selected = state.clips.filter((clip) => ids.has(clip.id));
    if (selected.length === 0) {
      return [];
    }
    const minStart = selected.reduce(
      (min, clip) => Math.min(min, clip.start),
      Number.POSITIVE_INFINITY,
    );
    const maxEnd = selected.reduce(
      (max, clip) => Math.max(max, clip.start + clip.duration),
      0,
    );
    const span = maxEnd - minStart;
    const newEntries: { clip: PlaylistClip; trackIndex: number }[] = [];
    let workingClips = [...state.clips];
    for (const clip of selected) {
      const id = makeClipId(workingClips);
      const newClip: PlaylistClip = {
        ...cloneClip(clip),
        id,
        start: clip.start + span,
        sourceId: clip.sourceId ?? clip.id,
      };
      newEntries.push({
        clip: newClip,
        trackIndex: getTrackIndexById(state, clip.trackId),
      });
      workingClips = [...workingClips, newClip];
    }
    const selectIds = newEntries.map((entry) => entry.clip.id);
    this.dispatch({
      type: "PASTE_CLIPS",
      entries: newEntries,
      selectIds,
    });
    return selectIds;
  }

  private isClipOnLockedTrack(clipId: string): boolean {
    const state = this.history.present;
    const clip = state.clips.find((candidate) => candidate.id === clipId);
    if (!clip) return false;
    const idx = getTrackIndexById(state, clip.trackId);
    return state.tracks[idx]?.locked === true;
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

function selectionBaseTrackIndex(state: PlaylistState): number {
  if (state.selection.clipIds.length === 0) {
    return 0;
  }
  let min = Number.POSITIVE_INFINITY;
  for (const id of state.selection.clipIds) {
    const clip = state.clips.find((c) => c.id === id);
    if (!clip) continue;
    const idx = getTrackIndexById(state, clip.trackId);
    if (idx < min) {
      min = idx;
    }
  }
  return Number.isFinite(min) ? min : 0;
}
