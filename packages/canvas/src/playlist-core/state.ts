import {
  isUndoableAction,
  type PlaylistAction,
  type PlaylistClipMoveUpdate,
} from "./actions";
import {
  clamp,
  formatBarBeat,
  getContentEndBeat,
  getRealTracksScrollLimit,
  getTrackIdByIndex,
  getTrackIndexById,
  isAutomationClip,
  snapTime,
  type PlaylistLayoutOptions,
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
  type PlaylistDragPreview,
  type PlaylistMarker,
  type PlaylistMarkerKind,
  type PlaylistMarquee,
  type PlaylistMetrics,
  type PlaylistPoint,
  type PlaylistSelection,
  type PlaylistSnapHint,
  type PlaylistSnapMode,
  type PlaylistState,
  type PlaylistStateListener,
  type PlaylistTimeAxis,
  type PlaylistToolId,
  type PlaylistTooltip,
} from "./types";
import type { PlaylistPresentation } from "./presentation";
import { createPlaylistPresentation } from "./presentation";
import {
  makeClipId,
  makeGroupId,
  makeMarkerId,
  makePointId,
} from "./state-track-helpers";
import { cloneClip, splitAutomationPoints } from "./state-utils";
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
  // true → the clip is skipped by every slice path (see PlaylistClip.noSlice).
  noSlice?: boolean;
}

// PlaylistCore is the mutable facade backed by a pure reducer + history stack.
// The public API mirrors the original mutator surface so consumers (controller,
// shell) keep working unchanged. Internally each mutator dispatches an action.
export interface PlaylistCoreOptions {
  metrics?: PlaylistMetrics;
  // Optional pluggable time axis: ruler ticks + tooltip time text. Without
  // it the playlist keeps the FL bar/beat grid and "bar.beat.tick" format.
  timeAxis?: PlaylistTimeAxis;
  // FL stretch mode (Shift+M: edge-resize scales stretchRatio instead of
  // cropping). Default true. A host whose clips have no stretchable content
  // passes false: setStretchMode(true) / toggleStretchMode() (and the raw
  // SET_STRETCH_MODE / TOGGLE_STRETCH_MODE actions) become no-ops, the
  // initial state is normalized to stretchMode false, and no resize gesture
  // can enter stretch-resize.
  stretchEnabled?: boolean;
  // FL "infinite tracks": virtual "Track N" rows below the real tracks that
  // materialise when a clip lands on them. Default true. A host whose tracks
  // are its own model (e.g. one per category) passes false:
  //   - no virtual rows are drawn below the real tracks (just background);
  //   - the vertical extent / scrollbar cover the real tracks only, and
  //     updateViewport / setViewportSize clamp scrollY so the last track
  //     rests above the horizontal scrollbar (nothing below to reveal;
  //     getMaxScrollY itself stays infinite — canon §2.5 is the X axis);
  //   - no gesture materialises a track: createClip(s) beyond the last real
  //     track are no-ops (like a locked track) and moveClips clamps the
  //     destination to the last real track.
  virtualTracks?: boolean;
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
  // Undo target of the open gesture: the present right before its FIRST
  // undoable dispatch (amend() dispatches excluded). null while no gesture
  // is open and while the open one has not changed the document yet — so a
  // gesture made only of selection / marquee / overlay / viewport changes
  // records no undo entry, exactly as if those dispatches ran outside it.
  private gestureBase: PlaylistState | null = null;
  // > 0 while amend() runs: undoable dispatches replace the present instead
  // of pushing a new undo entry. A counter so nested amend() calls are safe.
  private amendDepth = 0;
  private gestureOpenedInAmend = false;

  readonly metrics: PlaylistMetrics;

  readonly timeAxis: PlaylistTimeAxis | null;

  // See PlaylistCoreOptions.stretchEnabled.
  readonly stretchEnabled: boolean;

  // See PlaylistCoreOptions.virtualTracks.
  readonly virtualTracks: boolean;

  private readonly layoutOptions: PlaylistLayoutOptions;

  constructor(initialState: PlaylistState, options: PlaylistCoreOptions = {}) {
    this.metrics = options.metrics ?? DEFAULT_PLAYLIST_METRICS;
    this.timeAxis = options.timeAxis ?? null;
    this.stretchEnabled = options.stretchEnabled !== false;
    this.virtualTracks = options.virtualTracks !== false;
    this.layoutOptions = { virtualTracks: this.virtualTracks };
    const initial =
      !this.stretchEnabled && initialState.stretchMode
        ? { ...initialState, stretchMode: false }
        : initialState;
    this.history = createHistory(normalizeState(initial, this.metrics));
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
      this.timeAxis,
      this.layoutOptions,
    );
    this.presentationCache = {
      state: this.history.present,
      presentation,
    };
    return presentation;
  }

  // Layout switches the core was created with (for geometry helpers that
  // take PlaylistLayoutOptions, e.g. the vertical scrollbar maths).
  getLayoutOptions(): PlaylistLayoutOptions {
    return this.layoutOptions;
  }

  // Time text for tooltips. Delegates to the pluggable axis when present;
  // otherwise the FL "bar.beat.tick" format.
  formatTime(beat: number): string {
    if (this.timeAxis) {
      return this.timeAxis.formatTime(beat);
    }
    return formatBarBeat(beat, this.metrics.beatsPerBar);
  }

  // Snap a raw time with the active snap mode, this core's metrics (bar
  // length) and time axis ("axis" mode). `ignoreSnap` = Alt held. `state`
  // defaults to the present; gesture handlers pass the snapshot they read
  // so "events" snapping sees the same clips as the rest of the handler.
  snapTime(
    value: number,
    ignoreSnap = false,
    state: PlaylistState = this.history.present,
  ): number {
    return snapTime(value, state, ignoreSnap, this.metrics, this.timeAxis);
  }

  // Last valid real-track index for gestures, or +Infinity when virtual
  // tracks are on (any index materialises). -1 when there are no tracks.
  maxTrackIndex(): number {
    return this.virtualTracks
      ? Number.POSITIVE_INFINITY
      : this.history.present.tracks.length - 1;
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
    if (
      !this.stretchEnabled &&
      (action.type === "TOGGLE_STRETCH_MODE" ||
        (action.type === "SET_STRETCH_MODE" && action.enabled))
    ) {
      // Stretch mode is off for this host: it can never be switched on.
      return;
    }
    const previous = this.history.present;
    const reduced = playlistReducer(previous, action, this.metrics);
    // Reducer signals "no change" by returning the same reference. Skip
    // normalization and notify entirely so callers like advancePlayPosition
    // (60 fps from the rAF tick) don't churn allocations and re-renders
    // when they're effectively a no-op.
    if (reduced === previous) {
      return;
    }
    // Passing `previous` lets normalizeState hand back previous.clips /
    // previous.tracks untouched when the reducer did not replace them, so a
    // hover / playhead / viewport dispatch keeps their identity (SYNC-15).
    const next = normalizeState(reduced, this.metrics, previous);
    if (isUndoableAction(action) && this.amendDepth === 0) {
      if (this.gestureDepth === 0) {
        this.history = pushHistory(this.history, next);
      } else {
        // First document change of the open gesture: what endGesture()
        // pushes as the undo target.
        if (this.gestureBase === null) this.gestureBase = previous;
        this.history = replacePresent(this.history, next);
      }
    } else {
      this.history = replacePresent(this.history, next);
    }
    this.notify();
  }

  // Run `mutate` so that every dispatch it makes REPLACES the current undo
  // entry instead of pushing a new one: follow-up corrections that belong to
  // the previous step (e.g. a host relabelling a clip it just pasted). Undo
  // from the amended state goes straight to the entry before it; past and
  // future are left untouched. Listeners are still notified per dispatch.
  // Nesting-safe (counter). Inside an open gesture that already changed the
  // document it folds into the gesture's entry; inside one that has not, it
  // folds into the entry before it (amend never starts an undo step, so it
  // never fixes the gesture base). A gesture opened inside `mutate` folds
  // into the present entry too instead of pushing its own step.
  amend(mutate: () => void): void {
    this.amendDepth += 1;
    try {
      mutate();
    } finally {
      this.amendDepth -= 1;
    }
  }

  // Gesture brackets — coalesce many transient mutations into a single undo
  // entry. Every undoable dispatch between the outermost begin/end lands in
  // ONE entry whose undo target is the present before the first of them
  // (see getGestureBase). A gesture with no undoable dispatch records
  // nothing, so opening one "just in case" (the controller does it around
  // every tool pointer-down) never creates an entry on its own.
  beginGesture(): void {
    if (this.gestureDepth === 0) {
      this.gestureBase = null;
      this.gestureOpenedInAmend = this.amendDepth > 0;
    }
    this.gestureDepth += 1;
  }

  endGesture(): void {
    if (this.gestureDepth === 0) {
      return;
    }
    this.gestureDepth -= 1;
    if (this.gestureDepth > 0) {
      return;
    }
    const base = this.gestureBase;
    const openedInAmend = this.gestureOpenedInAmend;
    this.gestureBase = null;
    this.gestureOpenedInAmend = false;
    // Opened inside amend(): its dispatches already replaced the present
    // entry (and notified), so there is no new undo step to record.
    if (base === null || base === this.history.present || openedInAmend) {
      return;
    }
    this.history = pushHistory(
      { ...this.history, present: base },
      this.history.present,
    );
    this.notify();
  }

  // The state the open gesture's undo entry returns to — the present right
  // before its first undoable dispatch; while it has made none yet, the
  // present itself. Its clips / tracks are those at gesture start (only
  // undoable dispatches change them, amend() aside). null when no gesture
  // is open. Nested gestures report the outermost one.
  getGestureBase(): PlaylistState | null {
    if (this.gestureDepth === 0) {
      return null;
    }
    return this.gestureBase ?? this.history.present;
  }

  // Undo / redo.
  undo(): boolean {
    if (!canUndo(this.history)) {
      return false;
    }
    this.history = undoHistory(this.history);
    this.resetGesture();
    this.notify();
    return true;
  }

  redo(): boolean {
    if (!canRedo(this.history)) {
      return false;
    }
    this.history = redoHistory(this.history);
    this.resetGesture();
    this.notify();
    return true;
  }

  private resetGesture(): void {
    this.gestureDepth = 0;
    this.gestureBase = null;
    this.gestureOpenedInAmend = false;
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
    if (!this.virtualTracks) {
      // A taller viewport can leave scrollY past the real tracks: pull it
      // back (no dispatch, hence no notify, when it is already in range).
      const state = this.history.present;
      const limit = getRealTracksScrollLimit(state, this.metrics);
      if (state.viewport.scrollY > limit) {
        this.updateViewport({ scrollY: limit });
      }
    }
  }

  updateViewport(
    patch: Partial<PlaylistState["viewport"]>,
    options: { clamp?: boolean } = {},
  ): void {
    let effective = patch;
    if (!this.virtualTracks && patch.scrollY !== undefined) {
      // virtualTracks: false — nothing to reveal below the real tracks.
      const limit = getRealTracksScrollLimit(this.history.present, this.metrics);
      const scrollY = clamp(patch.scrollY, 0, limit);
      if (scrollY !== patch.scrollY) {
        effective = { ...patch, scrollY };
      }
    }
    this.dispatch({
      type: "UPDATE_VIEWPORT",
      patch: effective,
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
    const filtered = this.clampMoveTargets(updates).filter((update) => {
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
    // Auto-expand groups: for any update whose clip belongs to a group, add
    // every sibling missing from the updates with the same start/track delta.
    // Idempotent — if the caller (e.g. the controller after pointerdown
    // expansion) already passed every member, no extras are appended.
    const expanded = this.clampMoveTargets(
      expandMoveUpdatesToGroups(state, filtered),
    );
    this.dispatch({ type: "MOVE_CLIPS", updates: expanded });
  }

  // virtualTracks: false — a move never targets a row past the last real
  // track (it would materialise a track the host does not know about).
  // Identity when nothing needs clamping (always, with virtual tracks on).
  private clampMoveTargets(
    updates: PlaylistClipMoveUpdate[],
  ): PlaylistClipMoveUpdate[] {
    const maxTrack = this.maxTrackIndex();
    if (maxTrack === Number.POSITIVE_INFINITY) return updates;
    const last = Math.max(0, maxTrack);
    let out: PlaylistClipMoveUpdate[] | null = null;
    for (let i = 0; i < updates.length; i += 1) {
      const update = updates[i]!;
      if (update.trackIndex <= last) continue;
      out ??= updates.slice();
      out[i] = { ...update, trackIndex: last };
    }
    return out ?? updates;
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

  // Mark a clip as (un)sliceable. Undoable; setting the value the clip
  // already has is a no-op (same state, no notify, no undo entry).
  setClipNoSlice(clipId: string, noSlice: boolean): void {
    if (this.isClipOnLockedTrack(clipId)) return;
    this.dispatch({ type: "SET_CLIP_NO_SLICE", clipId, noSlice });
  }

  // Undo checkpoint without a playlist change: the present is replaced by a
  // content-identical state with a new identity (clips/tracks arrays are
  // reused). Outside a gesture it is its own undo entry; inside a gesture it
  // makes the gesture commit an entry even when nothing else changed. Hosts
  // that key their own data by state identity (the financial bridge) use it
  // so their edits undo/redo in step with the playlist.
  touch(): void {
    this.dispatch({ type: "TOUCH" });
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
  // represents the drop-in time of the cut. Locked tracks and noSlice clips
  // are skipped.
  sliceClipsAtTime(time: number): string[] {
    const state = this.history.present;
    const lockedTrackIds = new Set(
      state.tracks
        .filter((track) => track.locked === true)
        .map((track) => track.id),
    );
    const candidates = state.clips.filter(
      (clip) =>
        clip.noSlice !== true &&
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
      const leftDuration = time - clip.start;
      const rightDuration = clip.start + clip.duration - time;
      const right: PlaylistClip = {
        ...cloneClip(clip),
        id: newId,
        start: time,
        duration: rightDuration,
        sourceId: clip.sourceId ?? clip.id,
        contentOffset: baseOffset + cutOffsetWithinContent,
      };
      // Automation halves must be re-cut, not copied: see splitAutomationPoints.
      if (isAutomationClip(clip) && isAutomationClip(right)) {
        right.points = splitAutomationPoints(
          clip.points,
          leftDuration,
          clip.id,
          newId,
          rightDuration,
        ).right;
        // The rebased points already carry the cut offset. Advancing
        // contentOffset too would encode the same shift twice and show a
        // bogus "↻" badge on a half whose envelope starts cleanly at 0.
        right.contentOffset = baseOffset;
      }
      newClips.push(right);
      working = [...working, right];
    }
    this.dispatch({
      type: "SLICE_CLIPS_AT_TIME",
      time,
      clipIds: candidates.map((clip) => clip.id),
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
  // Used by Shift-drag clone-drag in the select tool. Like createClip(s),
  // never lands a clone on a locked track (the destination is the source's
  // own track here).
  cloneClipsInPlace(clipIds: string[]): string[] {
    const state = this.history.present;
    const ids = new Set(clipIds);
    let working = [...state.clips];
    const entries: { clip: PlaylistClip; trackIndex: number }[] = [];
    for (const source of state.clips) {
      if (!ids.has(source.id)) continue;
      const trackIndex = getTrackIndexById(state, source.trackId);
      if (state.tracks[trackIndex]?.locked) continue;
      const id = makeClipId(working);
      const newClip: PlaylistClip = {
        ...cloneClip(source),
        id,
        sourceId: source.sourceId ?? source.id,
      };
      entries.push({ clip: newClip, trackIndex });
      working = [...working, newClip];
    }
    if (entries.length === 0) {
      return [];
    }
    const selectIds = entries.map((entry) => entry.clip.id);
    this.dispatch({ type: "PASTE_CLIPS", entries, selectIds });
    return selectIds;
  }

  // Marker wrappers (undoable). IDs are auto-generated when not provided.
  addMarker(input: {
    time: number;
    kind?: PlaylistMarkerKind;
    label?: string;
    color?: string;
    id?: string;
    timeSignatureNumerator?: number;
    timeSignatureDenominator?: number;
  }): string {
    const state = this.history.present;
    const id = input.id ?? makeMarkerId(state.markers);
    const marker: PlaylistMarker = {
      id,
      time: Math.max(0, input.time),
      kind: input.kind ?? "label",
      label: input.label,
      color: input.color,
      timeSignatureNumerator: input.timeSignatureNumerator,
      timeSignatureDenominator: input.timeSignatureDenominator,
    };
    this.dispatch({ type: "ADD_MARKER", marker });
    return id;
  }

  // FL Studio: Ctrl+T inserts an auto-named marker.
  addAutoNamedMarker(time: number): string {
    const state = this.history.present;
    const count =
      state.markers.filter((m) => m.kind === "label").length + 1;
    return this.addMarker({ time, kind: "label", label: `Marker ${count}` });
  }

  // Shift+Alt+T inserts a time-signature marker at the playhead.
  addTimeSignatureMarker(
    time: number,
    numerator = 4,
    denominator = 4,
  ): string {
    return this.addMarker({
      time,
      kind: "time-signature",
      label: `${numerator}/${denominator}`,
      timeSignatureNumerator: numerator,
      timeSignatureDenominator: denominator,
    });
  }

  removeMarker(markerId: string): void {
    this.dispatch({ type: "REMOVE_MARKER", markerId });
  }

  updateMarker(markerId: string, patch: Partial<PlaylistMarker>): void {
    this.dispatch({ type: "UPDATE_MARKER", markerId, patch });
  }

  openMarkerContextMenu(markerId: string, position: PlaylistPoint): void {
    this.dispatch({ type: "OPEN_MARKER_CONTEXT_MENU", markerId, position });
  }

  // UI-overlay wrappers — drag preview / snap indicator / floating tooltip.
  // All three are idempotent in the reducer (≥30Hz pointermove flood). They
  // belong to §4 of docs/performance-canon.md.
  setDragPreview(preview: PlaylistDragPreview): void {
    this.dispatch({ type: "SET_DRAG_PREVIEW", preview });
  }

  clearDragPreview(): void {
    this.dispatch({ type: "SET_DRAG_PREVIEW", preview: null });
  }

  setSnapHint(hint: PlaylistSnapHint | null): void {
    this.dispatch({ type: "SET_SNAP_HINT", hint });
  }

  clearSnapHint(): void {
    this.dispatch({ type: "SET_SNAP_HINT", hint: null });
  }

  setTooltip(tooltip: PlaylistTooltip | null): void {
    this.dispatch({ type: "SET_TOOLTIP", tooltip });
  }

  clearTooltip(): void {
    this.dispatch({ type: "SET_TOOLTIP", tooltip: null });
  }

  // Group membership wrappers (undoable). Group ids are auto-generated as
  // `g-<n>` so the renderer doesn't have to care about uniqueness.
  setClipGroup(clipId: string, groupId: string | null): void {
    if (this.isClipOnLockedTrack(clipId)) return;
    this.dispatch({ type: "SET_CLIP_GROUP", clipId, groupId });
  }

  groupSelection(): string | null {
    const ids = this.history.present.selection.clipIds.filter(
      (id) => !this.isClipOnLockedTrack(id),
    );
    if (ids.length === 0) return null;
    const groupId = makeGroupId(this.history.present.clips);
    this.dispatch({ type: "GROUP_SELECTION", groupId, clipIds: ids });
    return groupId;
  }

  ungroupSelection(): void {
    const ids = this.history.present.selection.clipIds.filter(
      (id) => !this.isClipOnLockedTrack(id),
    );
    if (ids.length === 0) return;
    this.dispatch({ type: "UNGROUP_SELECTION", clipIds: ids });
  }

  // Returns clip ids expanded to include every clip sharing a groupId with
  // any of the seeds. Pure / synchronous so the controller can call it once
  // at pointerdown and reuse the result for every pointermove of the drag.
  expandSelectionToGroups(seedIds: string[]): string[] {
    const state = this.history.present;
    if (seedIds.length === 0) return [];
    const seedSet = new Set(seedIds);
    const seedGroups = new Set<string>();
    for (const clip of state.clips) {
      if (seedSet.has(clip.id) && clip.groupId !== undefined) {
        seedGroups.add(clip.groupId);
      }
    }
    if (seedGroups.size === 0) {
      return [...seedIds];
    }
    const out = new Set(seedIds);
    for (const clip of state.clips) {
      if (clip.groupId !== undefined && seedGroups.has(clip.groupId)) {
        out.add(clip.id);
      }
    }
    return Array.from(out);
  }

  // FL Studio End key: jump the playhead to the end of the last clip.
  getContentEndTime(): number {
    return getContentEndBeat(this.history.present);
  }

  // Arrow-key nudge for the current clip selection. Expands the seeds
  // through expandSelectionToGroups so a grouped clip drags its siblings.
  // The reducer applies the same delta to every member (one undo entry).
  nudgeSelection(deltaBeats: number, deltaTracks: number): void {
    if (deltaBeats === 0 && deltaTracks === 0) return;
    const state = this.history.present;
    const seedIds = state.selection.clipIds;
    if (seedIds.length === 0) return;
    const expanded = this.expandSelectionToGroups(seedIds);
    const clipById = new Map(state.clips.map((c) => [c.id, c] as const));
    const updates: PlaylistClipMoveUpdate[] = [];
    for (const id of expanded) {
      const clip = clipById.get(id);
      if (!clip) continue;
      const currentTrack = getTrackIndexById(state, clip.trackId);
      const targetTrack = Math.max(0, currentTrack + deltaTracks);
      updates.push({
        id,
        start: Math.max(0, clip.start + deltaBeats),
        trackIndex: targetTrack,
      });
    }
    if (updates.length === 0) return;
    this.moveClips(updates);
  }

  // Arrow-key nudge for the playhead. setPlayPosition is idempotent so a
  // negative delta past zero clamps without notify if already at 0.
  nudgePlayPositionBy(deltaBeats: number): void {
    const next = this.history.present.playPosition.time + deltaBeats;
    this.setPlayPosition(Math.max(0, next));
  }

  // End key: jump the playhead to the end of the last clip.
  jumpToEnd(): void {
    this.setPlayPosition(this.getContentEndTime());
  }

  // Transport wrappers (UI-only).
  setTransportMode(mode: "song" | "pattern"): void {
    this.dispatch({ type: "SET_TRANSPORT_MODE", mode });
  }

  toggleTransportMode(): void {
    this.dispatch({ type: "TOGGLE_TRANSPORT_MODE" });
  }

  toggleTransportRecording(): void {
    this.dispatch({ type: "TOGGLE_TRANSPORT_RECORDING" });
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
    // virtualTracks: false — rows past the last real track are background,
    // not tracks: nothing is created there (same contract as a locked track).
    if (input.trackIndex > this.maxTrackIndex()) {
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
      ...(input.noSlice === true ? { noSlice: true } : null),
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
    this.dispatch({
      type: "CREATE_CLIP",
      clip,
      trackIndex: input.trackIndex,
    });
    return id;
  }

  // Brush-tool friendly batch creator: produces N clips in a single
  // reducer pass + a single notify. Keeps paint-drag at 1 render per
  // pointermove regardless of how many cells were filled. Returns the
  // ids of the freshly created clips (preserving input order).
  createClips(inputs: PlaylistCreateClipInput[]): string[] {
    if (inputs.length === 0) return [];
    const state = this.history.present;
    let working = state.clips;
    const entries: { clip: PlaylistClip; trackIndex: number }[] = [];
    const ids: string[] = [];
    const maxTrack = this.maxTrackIndex();
    for (const input of inputs) {
      if (state.tracks[input.trackIndex]?.locked) {
        continue;
      }
      if (input.trackIndex > maxTrack) {
        continue;
      }
      const id = input.id ?? makeClipId(working);
      const baseClip = {
        id,
        type: input.type ?? "pattern",
        trackId: getTrackIdByIndex(state, input.trackIndex),
        start: Math.max(0, input.start),
        duration: Math.max(this.metrics.minClipDuration, input.duration),
        label: input.label ?? "Clip",
        color: input.color ?? "#888888",
        muted: input.muted,
        sourceId: input.sourceId ?? id,
        ...(input.noSlice === true ? { noSlice: true } : null),
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
      entries.push({ clip, trackIndex: input.trackIndex });
      ids.push(id);
      working = [...working, clip];
    }
    if (entries.length === 0) return [];
    this.dispatch({ type: "CREATE_CLIPS_BATCH", entries });
    return ids;
  }

  deleteClip(clipId: string): void {
    if (this.isClipOnLockedTrack(clipId)) return;
    this.dispatch({ type: "DELETE_CLIP", clipId });
  }

  deleteClips(clipIds: string[]): void {
    const ids = clipIds.filter((id) => !this.isClipOnLockedTrack(id));
    if (ids.length === 0) return;
    this.dispatch({ type: "DELETE_CLIPS_BATCH", clipIds: ids });
  }

  toggleClipMute(clipId: string): void {
    if (this.isClipOnLockedTrack(clipId)) return;
    this.dispatch({ type: "TOGGLE_CLIP_MUTE", clipId });
  }

  setClipsMuted(clipIds: string[], muted: boolean): void {
    const ids = clipIds.filter((id) => !this.isClipOnLockedTrack(id));
    if (ids.length === 0) return;
    this.dispatch({ type: "SET_CLIPS_MUTED", clipIds: ids, muted });
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
    // F6: regenerate group ids so a pasted group becomes a sibling, not a
    // copy that drags the original. One fresh groupId per distinct
    // clipboard groupId; clips that weren't grouped stay ungrouped.
    const groupIdRemap = new Map<string, string>();
    for (const entry of state.clipboard.entries) {
      const sourceGroupId = entry.clip.groupId;
      if (sourceGroupId !== undefined && !groupIdRemap.has(sourceGroupId)) {
        groupIdRemap.set(sourceGroupId, makeGroupId(workingClips));
      }
    }
    for (const entry of state.clipboard.entries) {
      const trackIndex = Math.max(0, baseTrackIndex + entry.trackOffset);
      // Like createClip(s): nothing lands on a locked track (nor, with
      // virtualTracks: false, past the last real one). The rest of the
      // clipboard still pastes at its relative position.
      if (state.tracks[trackIndex]?.locked) continue;
      if (trackIndex > this.maxTrackIndex()) continue;
      const id = makeClipId(workingClips);
      const nextGroupId =
        entry.clip.groupId !== undefined
          ? groupIdRemap.get(entry.clip.groupId)!
          : undefined;
      const newClip: PlaylistClip = {
        ...cloneClip(entry.clip),
        id,
        start: Math.max(0, startTime + entry.startOffset),
        // Pasted clips share the source of the originals (FL Studio: paste
        // produces siblings, not unique copies). Falls back to the original
        // id when the source itself had no explicit sourceId.
        sourceId: entry.clip.sourceId ?? entry.clip.id,
        ...(nextGroupId !== undefined ? { groupId: nextGroupId } : {}),
      };
      // If the source clip wasn't grouped, the spread already omitted the
      // field; nothing more to do.
      newEntries.push({ clip: newClip, trackIndex });
      workingClips = [...workingClips, newClip];
    }
    if (newEntries.length === 0) {
      return [];
    }
    const selectIds = newEntries.map((entry) => entry.clip.id);
    this.dispatch({
      type: "PASTE_CLIPS",
      entries: newEntries,
      selectIds,
    });
    return selectIds;
  }

  // Ctrl+B: duplicates the selection right after itself (shifted by the
  // selection's span). Clips on a locked track are not duplicated (the copy
  // would land on that same track); the span still covers the whole
  // selection so the unlocked copies keep their relative layout.
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
      const trackIndex = getTrackIndexById(state, clip.trackId);
      if (state.tracks[trackIndex]?.locked) continue;
      const id = makeClipId(workingClips);
      const newClip: PlaylistClip = {
        ...cloneClip(clip),
        id,
        start: clip.start + span,
        sourceId: clip.sourceId ?? clip.id,
      };
      newEntries.push({ clip: newClip, trackIndex });
      workingClips = [...workingClips, newClip];
    }
    if (newEntries.length === 0) {
      return [];
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

// Group-aware expansion for MOVE_CLIPS. Picks the delta from the first
// update whose clip carries a groupId, then folds in every other clip of
// the same group with the same (start, trackIndex) delta. Lock-filtered
// against the destination too — sibling clips on locked tracks are skipped.
function expandMoveUpdatesToGroups(
  state: PlaylistState,
  updates: PlaylistClipMoveUpdate[],
): PlaylistClipMoveUpdate[] {
  if (updates.length === 0) return updates;
  const clipById = new Map(state.clips.map((c) => [c.id, c] as const));
  const includedIds = new Set(updates.map((u) => u.id));
  // Compute deltas per group from the first update of that group.
  const groupDeltas = new Map<
    string,
    { startDelta: number; trackDelta: number }
  >();
  for (const update of updates) {
    const clip = clipById.get(update.id);
    if (!clip || clip.groupId === undefined) continue;
    if (groupDeltas.has(clip.groupId)) continue;
    const currentTrackIndex = getTrackIndexById(state, clip.trackId);
    groupDeltas.set(clip.groupId, {
      startDelta: update.start - clip.start,
      trackDelta: update.trackIndex - currentTrackIndex,
    });
  }
  if (groupDeltas.size === 0) return updates;
  const out = [...updates];
  for (const clip of state.clips) {
    if (clip.groupId === undefined) continue;
    if (includedIds.has(clip.id)) continue;
    const delta = groupDeltas.get(clip.groupId);
    if (!delta) continue;
    const currentTrackIndex = getTrackIndexById(state, clip.trackId);
    const targetTrackIndex = Math.max(0, currentTrackIndex + delta.trackDelta);
    // Skip siblings on locked tracks (origin or destination).
    if (state.tracks[currentTrackIndex]?.locked) continue;
    if (state.tracks[targetTrackIndex]?.locked) continue;
    out.push({
      id: clip.id,
      start: Math.max(0, clip.start + delta.startDelta),
      trackIndex: targetTrackIndex,
    });
  }
  return out;
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
