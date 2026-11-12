import {
  automationPointFromScreen,
  clamp,
  getHorizontalScrollableRange,
  getHorizontalScrollbarRect,
  getHorizontalScrollbarThumbRect,
  getTrackHeightByIndex,
  getTrackTopByIndex,
  getHorizontalContentExtent,
  getTrackIdByIndex,
  getTrackLaneCount,
  getTrackLaneHeight,
  getTracksTop,
  getHorizontalScrollbarHeight,
  getVerticalScrollableRange,
  getVerticalScrollbarRect,
  getVerticalScrollbarThumbRect,
  normalizeRect,
  rectsIntersect,
  screenXToTime,
  screenYToTrackIndex,
} from "../playlist-core";
import { interpolateBrushPath } from "./brush";
import type {
  PlaylistCore,
  PlaylistPoint,
  PlaylistRect,
  PlaylistToolId,
  PlaylistTrackMenuAction,
} from "../playlist-core";
import type { ActiveGesture, ClipDragTrackInfo } from "./gesture-types";
import type { PlaylistCreateRequest } from "./tools/types";

export type { PlaylistCreateRequest } from "./tools/types";
import {
  createViewportNavigator,
  createWheelClassifier,
  prefersReducedMotion,
  wheelDeltaScale,
  type ViewportNavigator,
} from "./navigator";
import {
  CLIP_LEVEL_GRIP_FINE_PX,
  hitTestPlaylist,
  type PlaylistHit,
} from "./hit-test";
import { getTool, zoomToolApplyOut } from "./tools";
import { createTouchTracker } from "./touch";

export interface PlaylistInteractionController {
  destroy: () => void;
  // Smooth viewport motion (scroll / zoom / reveal / fit) for host UI such
  // as "Hoy" buttons or zoom presets; shares the wheel's animation.
  readonly navigator: ViewportNavigator;
}

export interface PlaylistClipLevelEvent {
  clipId: string;
  phase: "start" | "move" | "end";
  // Pointer travel since the press, in px; positive = upwards.
  deltaY: number;
  // Shift held: the host may use a finer step.
  fine?: boolean;
}

/**
 * A document edit the controller just COMMITTED (on release / on the key),
 * never reported per pointermove: the host can name it and offer undo
 * ("Borrados 2 · Deshacer"). Labels are the clips' labels at that moment.
 */
export type PlaylistEditEvent =
  | { kind: "delete"; clipIds: string[]; labels: string[] }
  | {
      kind: "slice";
      time: number;
      clipIds: string[];
      labels: string[];
      newClipIds: string[];
    }
  | {
      // A keyboard move (arrows) of the selection, reported once the burst
      // of key presses settles (nudgeFeedbackMs).
      kind: "nudge";
      clipIds: string[];
      labels: string[];
      fromStart: number;
      toStart: number;
      deltaTracks: number;
    };

/** Clips a gesture in progress WILL affect on release (delete / slice). */
export interface PlaylistPendingClips {
  kind: "delete" | "slice";
  clipIds: ReadonlySet<string>;
}

/** What a keyboard move of the selection did so far (see describeNudge). */
export interface PlaylistNudgeInfo {
  clipId: string;
  label: string;
  fromStart: number;
  toStart: number;
  deltaTracks: number;
}

/** Plain-language names of the track header buttons ([off, on] states). */
export interface PlaylistTrackButtonHints {
  mute: readonly [string, string];
  solo: readonly [string, string];
  lock: readonly [string, string];
  reorder?: string;
}

export interface PlaylistInteractionOptions {
  // Gives every non-automation clip a "level" the host owns (e.g. an
  // amount). With this set, the top edge of a clip (CLIP_LEVEL_HANDLE_PX)
  // is a handle for the Select / Draw tools: dragging it vertically calls
  // this with the travel. The whole drag is ONE gesture (one undo entry
  // for whatever the host dispatches). Return the text of the tooltip to
  // show next to the cursor, or null for none.
  onClipLevelDrag?: (event: PlaylistClipLevelEvent) => string | null;
  // Gives the single selected clip an EXTEND GRABBER (Select / Draw): a
  // vertical bar at the centre of the visible timeline, inside the clip,
  // that moves the clip's right end (drag right = longer, left = shorter)
  // even when that end is off-screen (see getClipExtendHandle). The
  // predicate is the host's veto per clip. One gesture = one undo entry.
  clipExtend?: (clipId: string) => boolean;
  // The least the grabber moves the end per px of drag, in beats. Zoomed out
  // the end follows the pointer 1:1; zoomed in (fewer beats per px) the
  // grabber never gets slower than this, so a far end stays within reach.
  // Default 0: always 1:1.
  clipExtendMinBeatsPerPx?: number;
  // The pointer moved over the overview lane: the beat under it (floored),
  // or null when it left the lane. Called only when that value changes.
  onOverviewHover?: (beat: number | null) => void;
  // A host that creates objects through its own flow (e.g. an editor that
  // adds only on "Save"). With this set the Draw tool never creates a clip
  // on empty space: a double-click asks at once; a drag previews the range
  // (dashed, on the lane it would take) and asks on release; a plain click
  // does nothing. Nothing is added unless the host adds it.
  onCreateRequest?: (request: PlaylistCreateRequest) => void;
  // What a plain (notched) mouse wheel scrolls. "time" (default, FL
  // parity): the timeline, Shift / the track headers scroll the rows.
  // "rows": the rows, like any document (Shift, a tilt wheel or the wheel
  // over the ruler / overview lane move time). Zoom and trackpad pan are
  // the same in both.
  mouseWheel?: "time" | "rows";

  // --- Host semantics. Every default keeps FL parity; a host declares
  // what its gestures mean (docs/fl-playlist-parity-spec.md).

  // What the Slice tool (release) and Insert cut. "all" (default, FL):
  // every clip crossing the time. "target": the clip pressed on (or the
  // selection it belongs to); Insert cuts the selection; Shift (held on
  // release / with Insert) cuts every clip at that time.
  sliceScope?: "all" | "target";
  // Text of the slice guide's tooltip while dragging (e.g. "Partir Sueldo
  // el 23 dic"); called only when the snapped time or the targets change.
  describeSlice?: (clipIds: readonly string[], time: number) => string | null;
  // The Delete tool (and the right-button sweeps) mark what they touch and
  // delete it all on release, in one step, instead of at once.
  deferDelete?: boolean;
  // Clips the gesture in progress will affect (null when it ends). Called
  // only when that set changes, never per move: e.g. to highlight them.
  onPendingChange?: (pending: PlaylistPendingClips | null) => void;
  // A destructive edit was committed (delete / slice / keyboard move).
  onEdit?: (event: PlaylistEditEvent) => void;
  // Escape puts any tool other than Select back to Select.
  escapeSelectsTool?: boolean;
  // CSS cursor per tool over the timeline (default: each tool's own).
  toolCursors?: Partial<Record<PlaylistToolId, string>>;
  // Arrow-key moves of the selection: the burst of presses is ONE undo
  // entry (a gesture, so the host's effect pill shows) and a tooltip names
  // the move ("Gasto: 24 nov → 27 nov") until it settles this many ms.
  // 0 / absent: plain nudges (one undo entry each, no tooltip).
  nudgeFeedbackMs?: number;
  // Tooltip text of a keyboard move (default "label: from → to").
  describeNudge?: (info: PlaylistNudgeInfo) => string;
  // Hovering a clip this long (ms) shows its info card (a "clip" tooltip;
  // the renderer asks getClipInfo for its lines); a tap shows it at once
  // on touch. Escape closes it. Absent: no card.
  hoverCardDelayMs?: number;
  // Hover-time indicator: while the pointer rests over the timeline columns
  // (ruler, overview lane, rows) and no gesture runs, state.hoverTime holds
  // the beat cell under it — the renderer draws a faint line there and names
  // the day on the ruler. It replaces the floating time tooltip of the ruler
  // / lane hover, which covered the curve next to the pointer.
  hoverTimeIndicator?: boolean;
  // With onCreateRequest: a click (no drag) on empty space also asks the
  // host — Select and Draw alike — at the cell under the pointer (not
  // snapped: the cell the hover line names), with the press point and the
  // lane a new clip would take (`point`, `lane`), so the host can ask "what
  // goes here?" at that spot. A click that clears a selection only clears
  // it; Ctrl / Shift clicks never ask. The second press of a double-click
  // asks again with `clickCount: 2`.
  clickToCreate?: boolean;
  // Names of the track header buttons, shown as a tooltip on hover.
  trackButtonHints?: PlaylistTrackButtonHints;
  // Extra px of hit area around each track header button (see hit-test).
  trackButtonSlop?: number;
  // The level handle is the visible grip only (24 px wide, taller for a
  // coarse pointer), and a drag from it that starts mostly horizontal
  // moves the clip instead of changing its level (axis lock).
  clipLevelGrip?: boolean;
  // Alt+← / Alt+→ moved the keyboard focus (the selection) to this clip.
  onClipFocus?: (clipId: string) => void;
}

// Keyboard object roving (Alt+← / Alt+→): clips in date order, then row,
// then lane. O(n log n) per key press — never per frame.
function clipsInDateOrder(
  state: import("../playlist-core").PlaylistState,
): import("../playlist-core").PlaylistClip[] {
  const rowOf = new Map<string, number>();
  state.tracks.forEach((track, index) => rowOf.set(track.id, index));
  return [...state.clips].sort(
    (a, b) =>
      a.start - b.start ||
      (rowOf.get(a.trackId) ?? 0) - (rowOf.get(b.trackId) ?? 0) ||
      (a.lane ?? 0) - (b.lane ?? 0),
  );
}

function hitClipId(hit: PlaylistHit): string | null {
  switch (hit.kind) {
    case "clip":
    case "resize-left":
    case "resize-right":
    case "clip-level":
    case "clip-extend":
    case "automation-body":
      return hit.clip.id;
    default:
      return null;
  }
}

function sameIdSet(a: ReadonlySet<string>, b: readonly string[]): boolean {
  if (a.size !== b.length) return false;
  for (const id of b) if (!a.has(id)) return false;
  return true;
}

function isTrackButtonHit(hit: PlaylistHit): boolean {
  return (
    hit.kind === "track-mute-button" ||
    hit.kind === "track-solo-button" ||
    hit.kind === "track-lock-button" ||
    hit.kind === "track-reorder-handle"
  );
}

type PlaylistInteractionHost = HTMLElement & {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
};

const TOOL_HOTKEYS: Readonly<Record<string, PlaylistToolId>> = {
  P: "draw",
  B: "paint",
  D: "delete",
  T: "mute",
  S: "slip",
  C: "slice",
  E: "select",
  Z: "zoom",
};

function resolvePoint(
  host: HTMLElement,
  event: MouseEvent | PointerEvent | WheelEvent,
): PlaylistPoint {
  const rect = host.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function setCursor(
  host: HTMLElement,
  hit: PlaylistHit | null,
  active: ActiveGesture | null,
  toolId: PlaylistToolId,
  // Host cursors per tool (PlaylistInteractionOptions.toolCursors).
  cursors?: Partial<Record<PlaylistToolId, string>>,
): void {
  if (active?.kind === "pan" || active?.kind === "clip-drag") {
    host.style.cursor = "grabbing";
    return;
  }

  if (active?.kind === "clip-resize" || active?.kind === "clip-extend") {
    host.style.cursor = "ew-resize";
    return;
  }

  if (active?.kind === "clip-level") {
    host.style.cursor = "ns-resize";
    return;
  }

  if (active?.kind === "scrollbar-zoom") {
    host.style.cursor = "ew-resize";
    return;
  }

  if (active?.kind === "automation-point-drag") {
    host.style.cursor = "grabbing";
    return;
  }

  if (active?.kind === "play-position-drag") {
    host.style.cursor = "ew-resize";
    return;
  }

  if (active?.kind === "scrollbar-horizontal") {
    host.style.cursor = "ew-resize";
    return;
  }

  if (active?.kind === "scrollbar-vertical") {
    host.style.cursor = "ns-resize";
    return;
  }

  if (
    active?.kind === "paint-drag" ||
    active?.kind === "delete-drag" ||
    active?.kind === "mute-drag" ||
    active?.kind === "slip-drag" ||
    active?.kind === "slice-drag"
  ) {
    host.style.cursor = (cursors?.[toolId] ?? getTool(toolId).cursor);
    return;
  }

  if (active?.kind === "track-resize") {
    host.style.cursor = "ns-resize";
    return;
  }

  if (active?.kind === "track-reorder") {
    host.style.cursor = "grabbing";
    return;
  }

  if (active?.kind === "marker-drag") {
    host.style.cursor = "grabbing";
    return;
  }

  if (!hit) {
    host.style.cursor = "default";
    return;
  }

  // Universal hits override tool cursors.
  if (hit.kind === "scrollbar-horizontal") {
    host.style.cursor = hit.edge ? "ew-resize" : hit.onThumb ? "grab" : "pointer";
    return;
  }

  if (hit.kind === "scrollbar-vertical") {
    host.style.cursor = "ns-resize";
    return;
  }

  if (hit.kind === "play-position-marker" || hit.kind === "ruler") {
    host.style.cursor = "ew-resize";
    return;
  }

  if (hit.kind === "marker") {
    host.style.cursor = "grab";
    return;
  }

  if (hit.kind === "track-header") {
    host.style.cursor = "default";
    return;
  }

  if (
    hit.kind === "track-mute-button" ||
    hit.kind === "track-solo-button" ||
    hit.kind === "track-lock-button"
  ) {
    host.style.cursor = "pointer";
    return;
  }

  if (hit.kind === "track-resize-handle") {
    host.style.cursor = "ns-resize";
    return;
  }

  if (hit.kind === "track-reorder-handle") {
    host.style.cursor = "grab";
    return;
  }

  // The extend grabber (only offered to Select / Draw).
  if (hit.kind === "clip-extend") {
    host.style.cursor = "ew-resize";
    return;
  }

  // The level handle (top edge of a clip) for Select / Draw.
  if (hit.kind === "clip-level" && (toolId === "select" || toolId === "draw")) {
    host.style.cursor = "ns-resize";
    return;
  }

  // Timeline area (clip / automation / empty): cursor follows the active tool.
  if (toolId === "select") {
    if (hit.kind === "resize-left" || hit.kind === "resize-right") {
      host.style.cursor = "ew-resize";
      return;
    }
    if (hit.kind === "automation-point" || hit.kind === "clip") {
      host.style.cursor = "grab";
      return;
    }
    if (hit.kind === "automation-body") {
      host.style.cursor = "crosshair";
      return;
    }
    host.style.cursor = "default";
    return;
  }

  host.style.cursor = (cursors?.[toolId] ?? getTool(toolId).cursor);
}

function selectClipsInMarquee(core: PlaylistCore, additive: boolean): void {
  const presentation = core.getPresentation();
  const marquee = presentation.state.marquee;

  if (!marquee) {
    return;
  }

  const rect = normalizeRect({
    x: marquee.start.x,
    y: marquee.start.y,
    width: marquee.current.x - marquee.start.x,
    height: marquee.current.y - marquee.start.y,
  });
  const clipIds = presentation.clipViews
    .filter((view) => rectsIntersect(rect, view.rect))
    .map((view) => view.clip.id);

  core.setClipSelection(clipIds, { additive });
}

function segmentIntersectsRect(
  from: PlaylistPoint,
  to: PlaylistPoint,
  rect: PlaylistRect,
): boolean {
  const minX = rect.x;
  const maxX = rect.x + rect.width;
  const minY = rect.y;
  const maxY = rect.y + rect.height;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let t0 = 0;
  let t1 = 1;
  let p = -dx;
  let q = from.x - minX;
  if (p === 0) {
    if (q < 0) return false;
  } else {
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  p = dx;
  q = maxX - from.x;
  if (p === 0) {
    if (q < 0) return false;
  } else {
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  p = -dy;
  q = from.y - minY;
  if (p === 0) {
    if (q < 0) return false;
  } else {
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  p = dy;
  q = maxY - from.y;
  if (p === 0) {
    if (q < 0) return false;
  } else {
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

function clipIdsTouchedBySegment(
  core: PlaylistCore,
  from: PlaylistPoint,
  to: PlaylistPoint,
  seen: Set<string>,
  skipAutomation: boolean,
): string[] {
  const ids: string[] = [];
  for (const view of core.getPresentation().visibleClipViews) {
    if (seen.has(view.clip.id)) continue;
    // RMB sweeps started from Draw/Paint/Mute must not eat automation clips:
    // a direct RMB there adds a control point, so wiping one mid-sweep would
    // contradict the very gesture the user is performing. The Delete tool
    // deletes everything, and passes skipAutomation = false.
    if (skipAutomation && view.clip.type === "automation") continue;
    if (!segmentIntersectsRect(from, to, view.rect)) continue;
    seen.add(view.clip.id);
    ids.push(view.clip.id);
  }
  return ids;
}

// F7 eyedropper: paint the current selection with `sourceClipId`'s colour, or
// just that clip when nothing is selected.
function pickColorFrom(core: PlaylistCore, sourceClipId: string): void {
  const state = core.getState();
  const source = state.clips.find((clip) => clip.id === sourceClipId);
  if (!source) return;
  const selected = state.selection.clipIds;
  if (selected.length > 0) {
    core.beginGesture();
    for (const id of selected) {
      core.setClipColor(id, source.color);
    }
    core.endGesture();
    return;
  }
  core.setClipColor(source.id, source.color);
}

// Pump the three F3 overlays (snap line / drop ghost / time tooltip) from a
// single call site so the gesture handlers stay focused on their primary
// mutations. `preview` may be null when the gesture only emits a snap/time
// tooltip (play-position-drag). `tooltipTime` overrides the time shown in
// the tooltip — used by play-position-drag where the meaningful time is the
// playhead, not the inferred-from-preview value.
function emitDragOverlays(
  core: PlaylistCore,
  state: import("../playlist-core").PlaylistState,
  point: PlaylistPoint,
  altKey: boolean,
  preview:
    | import("../playlist-core").PlaylistDragPreview
    | null
    | undefined,
  tooltipTime?: number,
): void {
  const snapActive = state.snap.mode !== "none" && !altKey;
  const snapTimeValue =
    preview && preview.kind === "clip-move"
      ? preview.previewStart
      : preview && preview.kind === "clip-resize"
        ? preview.edge === "right"
          ? preview.previewStart + preview.previewDuration
          : preview.previewStart
        : preview && preview.kind === "marker"
          ? preview.previewTime
          : tooltipTime ?? 0;
  core.setSnapHint({ time: snapTimeValue, visible: snapActive });
  if (preview !== undefined) {
    core.setDragPreview(preview);
  }
  const tooltipBeats = tooltipTime ?? snapTimeValue;
  // A right edge is an exclusive end: name the last unit it still covers.
  const rightEdge = preview?.kind === "clip-resize" && preview.edge === "right";
  core.setTooltip({
    kind: "time",
    text: rightEdge ? core.formatEndTime(tooltipBeats) : core.formatTime(tooltipBeats),
    anchor: point,
    time: rightEdge ? core.endTooltipBeat(tooltipBeats) : tooltipBeats,
  });
}

function clearDragOverlays(core: PlaylistCore): void {
  core.clearSnapHint();
  core.clearDragPreview();
  core.clearTooltip();
}

function setHoverFromHit(core: PlaylistCore, hit: PlaylistHit): void {
  if (hit.kind === "clip" || hit.kind === "automation-body" || hit.kind === "clip-level") {
    core.setHover({ kind: "clip", clipId: hit.clip.id });
    return;
  }

  if (hit.kind === "resize-left") {
    core.setHover({ kind: "resize-left", clipId: hit.clip.id });
    return;
  }

  if (hit.kind === "resize-right") {
    core.setHover({ kind: "resize-right", clipId: hit.clip.id });
    return;
  }

  if (hit.kind === "clip-extend") {
    core.setHover({ kind: "clip-extend", clipId: hit.clip.id });
    return;
  }

  if (hit.kind === "automation-point") {
    core.setHover({
      kind: "automation-point",
      clipId: hit.clip.id,
      pointId: hit.pointId,
    });
    return;
  }

  if (hit.kind === "marker") {
    core.setHover({ kind: "marker", markerId: hit.markerId });
    return;
  }

  if (hit.kind === "play-position-marker" || hit.kind === "ruler") {
    core.setHover(null);
    return;
  }

  // The header's own buttons (and the row divider) belong to the row: the
  // buttons only show on a hovered row, so hovering one must keep them.
  if (
    hit.kind === "track-header" ||
    hit.kind === "track-mute-button" ||
    hit.kind === "track-solo-button" ||
    hit.kind === "track-lock-button" ||
    hit.kind === "track-reorder-handle"
  ) {
    core.setHover({
      kind: "track",
      trackId: getTrackIdByIndex(core.getState(), hit.trackIndex),
    });
    return;
  }

  core.setHover(null);
}

// Track / clip / background context menus are rendered as HTML overlays in
// the React shell now; the controller just routes RMB events to the right
// open* helper on PlaylistCore.

// Double-click window when the browser does not report a click count.
const DOUBLE_CLICK_MS = 500;
const DOUBLE_CLICK_SLOP_PX = 5;

export function createPlaylistInteractionController(
  host: PlaylistInteractionHost,
  core: PlaylistCore,
  options: PlaylistInteractionOptions = {},
): PlaylistInteractionController {
  const metrics = core.metrics;
  let activeGesture: ActiveGesture | null = null;
  const onClipLevelDrag = options.onClipLevelDrag;
  const onOverviewHover = options.onOverviewHover;
  const onCreateRequest = options.onCreateRequest;
  const wheelScrollsRows = options.mouseWheel === "rows";
  // Host semantics (read once).
  const toolCursors = options.toolCursors;
  const sliceTargeted = options.sliceScope === "target";
  const deferDelete = options.deferDelete === true;
  const onPendingChange = options.onPendingChange;
  const onEdit = options.onEdit;
  const nudgeFeedbackMs = Math.max(0, options.nudgeFeedbackMs ?? 0);
  const hoverCardDelayMs = options.hoverCardDelayMs;
  const hoverTimeIndicator = options.hoverTimeIndicator === true;
  const clickToCreate = options.clickToCreate === true;
  // The press that may become a click-to-create (plain fields: no
  // allocation per pointerdown).
  let createPressX = 0;
  let createPressY = 0;
  let createPressCount = 0;
  let createPressAsks = false;
  const trackButtonHints = options.trackButtonHints;
  const levelGrip = options.clipLevelGrip === true;
  // A coarse pointer (touch) gets a 24 px level grip; read once.
  const coarsePointer =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;

  // Labels of clips by id, read before they change (delete / slice).
  const labelsOf = (ids: readonly string[]): string[] => {
    const wanted = new Set(ids);
    const labels: string[] = [];
    for (const clip of core.getState().clips) if (wanted.has(clip.id)) labels.push(clip.label);
    return labels;
  };

  // Pending set reported to the host (onPendingChange): only on change.
  let pendingKind: PlaylistPendingClips["kind"] | null = null;
  let pendingIds: ReadonlySet<string> = new Set<string>();
  const reportPending = (kind: PlaylistPendingClips["kind"] | null, ids: readonly string[]): void => {
    if (!onPendingChange) return;
    if (kind === null || ids.length === 0) {
      if (pendingKind === null) return;
      pendingKind = null;
      pendingIds = new Set<string>();
      onPendingChange(null);
      return;
    }
    if (kind === pendingKind && sameIdSet(pendingIds, ids)) return;
    pendingKind = kind;
    pendingIds = new Set(ids);
    onPendingChange({ kind, clipIds: pendingIds });
  };

  // What a slice at the guide would cut: with sliceScope "target", the
  // pressed clip (or the selection it belongs to), else the selection;
  // Shift (or the FL default scope) = every clip crossing the time.
  const sliceTargets = (
    gesture: Extract<ActiveGesture, { kind: "slice-drag" }>,
    time: number,
    all: boolean,
  ): string[] => {
    const state = core.getState();
    let only: Set<string> | null = null;
    if (sliceTargeted && !all) {
      const selected = state.selection.clipIds;
      const target = gesture.targetClipId ?? null;
      only = new Set(
        target === null ? selected : selected.includes(target) ? selected : [target],
      );
    }
    const locked = new Set<string>();
    for (const track of state.tracks) if (track.locked === true) locked.add(track.id);
    const ids: string[] = [];
    for (const clip of state.clips) {
      if (only !== null && !only.has(clip.id)) continue;
      if (clip.noSlice === true || locked.has(clip.trackId)) continue;
      if (time > clip.start + 1e-6 && time < clip.start + clip.duration - 1e-6) ids.push(clip.id);
    }
    return ids;
  };

  const commitSlice = (time: number, ids: readonly string[] | undefined): void => {
    const only = ids ? new Set(ids) : null;
    const cut = sliceTargetsAll(time).filter((id) => only === null || only.has(id));
    if (cut.length === 0) return;
    const labels = labelsOf(cut);
    const newClipIds = core.sliceClipsAtTime(time, ids);
    if (newClipIds.length > 0) {
      onEdit?.({ kind: "slice", time, clipIds: cut, labels, newClipIds });
    }
  };
  const sliceTargetsAll = (time: number): string[] => {
    const state = core.getState();
    const locked = new Set<string>();
    for (const track of state.tracks) if (track.locked === true) locked.add(track.id);
    return state.clips
      .filter(
        (clip) =>
          clip.noSlice !== true &&
          !locked.has(clip.trackId) &&
          time > clip.start + 1e-6 &&
          time < clip.start + clip.duration - 1e-6,
      )
      .map((clip) => clip.id);
  };

  // Keyboard moves (arrows) of the selection, as one gesture per burst
  // (nudgeFeedbackMs): one undo entry, the host's effect pill under a
  // tooltip naming the move, reported once it settles.
  let nudge: {
    primaryId: string;
    clipIds: string[];
    labels: string[];
    fromStart: number;
    fromTrack: number;
    timer: ReturnType<typeof setTimeout> | null;
  } | null = null;
  const trackIndexOfClip = (clipId: string): number => {
    const state = core.getState();
    const clip = state.clips.find((candidate) => candidate.id === clipId);
    return clip ? state.tracks.findIndex((track) => track.id === clip.trackId) : -1;
  };
  const closeNudge = (): void => {
    const session = nudge;
    if (!session) return;
    nudge = null;
    if (session.timer !== null) clearTimeout(session.timer);
    const tooltip = core.getState().tooltip;
    if (tooltip && tooltip.kind === "hint") core.clearTooltip();
    core.endGesture();
    const clip = core.getState().clips.find((candidate) => candidate.id === session.primaryId);
    if (!clip) return;
    const deltaTracks = trackIndexOfClip(clip.id) - session.fromTrack;
    if (Math.abs(clip.start - session.fromStart) < 1e-9 && deltaTracks === 0) return;
    onEdit?.({
      kind: "nudge",
      clipIds: session.clipIds,
      labels: session.labels,
      fromStart: session.fromStart,
      toStart: clip.start,
      deltaTracks,
    });
  };
  const showNudgeTooltip = (): void => {
    const session = nudge;
    if (!session) return;
    const state = core.getState();
    const clip = state.clips.find((candidate) => candidate.id === session.primaryId);
    if (!clip) return;
    const info: PlaylistNudgeInfo = {
      clipId: clip.id,
      label: clip.label,
      fromStart: session.fromStart,
      toStart: clip.start,
      deltaTracks: trackIndexOfClip(clip.id) - session.fromTrack,
    };
    const text = options.describeNudge
      ? options.describeNudge(info)
      : `${clip.label}: ${core.formatTime(session.fromStart)} → ${core.formatTime(clip.start)}`;
    const view = core.getPresentation().clipViewsById.get(clip.id);
    const anchor = view
      ? { x: Math.max(metrics.trackHeaderWidth, view.rect.x), y: view.rect.y }
      : { x: metrics.trackHeaderWidth + 12, y: getTracksTop(metrics) + 24 };
    core.setTooltip({ kind: "hint", text, anchor });
  };

  // Tooltip text of the slice guide, recomputed only when it changes.
  let sliceLabel = "";

  // Info card of a hovered clip (hoverCardDelayMs): one timer, armed when
  // the hovered clip changes (never per move), cleared on leave / press.
  let hoverCardClipId: string | null = null;
  let hoverCardTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverCardPoint: PlaylistPoint = { x: 0, y: 0 };
  const cancelHoverCard = (): void => {
    if (hoverCardTimer !== null) {
      clearTimeout(hoverCardTimer);
      hoverCardTimer = null;
    }
    hoverCardClipId = null;
  };
  const clearCardTooltip = (): void => {
    const tooltip = core.getState().tooltip;
    if (tooltip && (tooltip.kind === "clip" || tooltip.kind === "hint")) core.clearTooltip();
  };
  const showClipCard = (clipId: string, point: PlaylistPoint): void => {
    const clip = core.getState().clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;
    core.setTooltip({ kind: "clip", text: clip.label, anchor: { ...point }, clipId });
  };

  // Lane of row `trackIndex` under screen `y` for a dragged clip, and the
  // free lane that row opens (stacked lanes, lanes.ts). A row with other
  // clips offers its lanes plus one empty lane below them (index = the
  // lanes it had when the gesture started); an empty row, or one holding
  // only the dragged clips, just its own lanes. Per-row facts are cached on
  // the gesture (clips outside the drag don't change during it): O(n) once
  // per row hovered, O(1) per move.
  const dragLaneTarget = (
    state: import("../playlist-core").PlaylistState,
    gesture: Extract<ActiveGesture, { kind: "clip-drag" }>,
    trackIndex: number,
    y: number,
  ): { lane: number; freeLane: { trackIndex: number; lane: number } | null } => {
    const track = state.tracks[trackIndex];
    if (!track) return { lane: 0, freeLane: null };
    const cache = (gesture.trackInfo ??= new Map<string, ClipDragTrackInfo>());
    let info = cache.get(track.id);
    if (!info) {
      const dragged = new Set(gesture.originals.map((clip) => clip.id));
      const base = core.getGestureBase() ?? state;
      const baseTrack = base.tracks.find((candidate) => candidate.id === track.id);
      info = {
        hasOthers: state.clips.some(
          (clip) => clip.trackId === track.id && !dragged.has(clip.id),
        ),
        baseLanes: baseTrack ? getTrackLaneCount(baseTrack) : 1,
      };
      cache.set(track.id, info);
    }
    const laneHeight = getTrackLaneHeight(track, metrics);
    const top = core.getPresentation().trackIndexToScreenY(trackIndex);
    const lastLane = info.hasOthers ? info.baseLanes : getTrackLaneCount(track) - 1;
    return {
      lane: clamp(Math.floor((y - top) / laneHeight), 0, Math.max(0, lastLane)),
      freeLane: info.hasOthers ? { trackIndex, lane: info.baseLanes } : null,
    };
  };

  // Lane a new clip [start, end) would take in row `trackIndex`: the first
  // one free at those times from the top, else a new one below (as the
  // lane layout places a fresh clip).
  const creationLane = (
    state: import("../playlist-core").PlaylistState,
    trackIndex: number,
    start: number,
    end: number,
  ): number => {
    const track = state.tracks[trackIndex];
    if (!track) return 0;
    const lanes = getTrackLaneCount(track);
    for (let lane = 0; lane < lanes; lane += 1) {
      const busy = state.clips.some(
        (clip) =>
          clip.trackId === track.id &&
          (clip.lane ?? 0) === lane &&
          clip.start < end &&
          start < clip.start + clip.duration,
      );
      if (!busy) return lane;
    }
    return lanes;
  };
  const extendMinBeatsPerPx = Math.max(0, options.clipExtendMinBeatsPerPx ?? 0);
  const hitOptions = {
    clipLevel: onClipLevelDrag !== undefined,
    clipExtend: options.clipExtend,
    clipLevelGrip: levelGrip
      ? { height: coarsePointer ? 24 : CLIP_LEVEL_GRIP_FINE_PX }
      : undefined,
    trackButtonSlop: options.trackButtonSlop,
  };
  // The right button ignores the thin track chrome (divisor, row buttons):
  // a press on a row line still opens the menu of what is under it.
  const menuHitOptions = { ...hitOptions, trackChrome: false };
  const hitAt = (point: PlaylistPoint, opts = hitOptions): PlaylistHit =>
    hitTestPlaylist(core.getPresentation(), point, metrics, opts);
  // Viewport motion (smooth wheel, zoom, momentum, edge auto-scroll).
  const navigator = createViewportNavigator(core, {
    reducedMotion: prefersReducedMotion,
  });
  const classifyWheel = createWheelClassifier();
  // Hold Space to pan with the left button (tap Space still plays).
  let spaceHeld = false;
  let spacePanned = false;
  // Pan velocity: the last few pointer samples, preallocated (no per-move
  // allocation), read on release for the momentum fling.
  const PAN_SAMPLES = 6;
  const panT = new Float64Array(PAN_SAMPLES);
  const panX = new Float64Array(PAN_SAMPLES);
  const panY = new Float64Array(PAN_SAMPLES);
  let panCount = 0;
  let panHead = 0;
  const recordPan = (point: PlaylistPoint, time: number): void => {
    panT[panHead] = time;
    panX[panHead] = point.x;
    panY[panHead] = point.y;
    panHead = (panHead + 1) % PAN_SAMPLES;
    if (panCount < PAN_SAMPLES) panCount += 1;
  };
  const panVelocity = (now: number): { vx: number; vy: number } => {
    if (panCount < 2) return { vx: 0, vy: 0 };
    const newest = (panHead - 1 + PAN_SAMPLES) % PAN_SAMPLES;
    // Oldest sample inside the last 100 ms.
    let oldest = newest;
    for (let i = 1; i < panCount; i += 1) {
      const index = (newest - i + PAN_SAMPLES) % PAN_SAMPLES;
      if (now - panT[index]! > 100) break;
      oldest = index;
    }
    const dt = (panT[newest]! - panT[oldest]!) / 1000;
    // A pause before release means no momentum.
    if (dt <= 0 || now - panT[newest]! > 80) return { vx: 0, vy: 0 };
    return {
      vx: (panX[newest]! - panX[oldest]!) / dt,
      vy: (panY[newest]! - panY[oldest]!) / dt,
    };
  };
  // Last pointermove of the active gesture (edge auto-scroll re-applies it).
  let lastGestureMove: PointerEvent | null = null;
  const timelineWidthOf = (state: ReturnType<PlaylistCore["getState"]>): number =>
    Math.max(1, state.viewport.width - metrics.trackHeaderWidth - metrics.scrollbarSize);
  const verticalRoom = (state: ReturnType<PlaylistCore["getState"]>): number =>
    getVerticalScrollableRange(state, metrics, core.getLayoutOptions()) - state.viewport.scrollY;

  // Last beat reported to onOverviewHover (null = outside the lane).
  let overviewBeat: number | null = null;
  const reportOverviewHover = (beat: number | null): void => {
    if (beat === overviewBeat) return;
    overviewBeat = beat;
    onOverviewHover?.(beat);
  };

  host.style.touchAction = "none";
  host.style.userSelect = "none";

  // F8: pinch-zoom + long-press + momentum scroll for touch input. The
  // tracker only kicks in when `event.pointerType === "touch"`; mouse
  // remains untouched. When a tracker handler returns true the event
  // has been consumed (e.g. mid-pinch update) and the controller skips
  // its normal handling.
  const touchTracker = createTouchTracker(host, core, metrics, () =>
    core.getPresentation(),
  );

  // Click counting for double-click. Modern Chromium reports
  // `PointerEvent.detail === 0` on pointerdown (only mouse/click events carry
  // the click count), so `event.detail === 2` alone never fired there. When
  // the browser reports a count we trust it; otherwise we count primary
  // presses that land within DOUBLE_CLICK_MS and DOUBLE_CLICK_SLOP_PX of the
  // previous one. Plain mutable fields — no allocation per pointerdown.
  //
  // A press that turned into a drag (moved more than DOUBLE_CLICK_SLOP_PX
  // while held) is never the first half of a double-click: press-drag-release
  // then press again at the release point must start a fresh count, or a
  // quick second slip/move would read as "open". `pressHeld` / `pressDragged`
  // are plain booleans flipped in pointerdown / pointermove / pointerup.
  let lastPressTime = Number.NEGATIVE_INFINITY;
  let lastPressX = 0;
  let lastPressY = 0;
  let lastPressCount = 0;
  let pressHeld = false;
  let pressDragged = false;
  const pressClickCount = (event: PointerEvent, point: PlaylistPoint): number => {
    const afterDrag = pressDragged;
    pressDragged = false;
    if (event.button !== 0) {
      pressHeld = false;
      lastPressCount = 0;
      return 0;
    }
    pressHeld = true;
    if (afterDrag) {
      lastPressCount = 1;
    } else if (event.detail > 0) {
      lastPressCount = event.detail;
    } else {
      const near =
        Math.abs(point.x - lastPressX) <= DOUBLE_CLICK_SLOP_PX &&
        Math.abs(point.y - lastPressY) <= DOUBLE_CLICK_SLOP_PX;
      lastPressCount =
        near && event.timeStamp - lastPressTime <= DOUBLE_CLICK_MS
          ? lastPressCount + 1
          : 1;
    }
    lastPressTime = event.timeStamp;
    lastPressX = point.x;
    lastPressY = point.y;
    return lastPressCount;
  };

  const handlePointerDown = (event: PointerEvent): void => {
    host.focus();
    // A new press always takes over: no glide / momentum fights the hand.
    navigator.stop();
    // …and closes a keyboard move in progress, the info card / hint.
    closeNudge();
    cancelHoverCard();
    clearCardTooltip();

    const state = core.getState();
    const point = resolvePoint(host, event);
    const rawHit = hitAt(point, event.button === 2 ? menuHitOptions : hitOptions);
    const clickCount = pressClickCount(event, point);
    createPressX = point.x;
    createPressY = point.y;
    createPressCount = clickCount;
    // A click that clears a selection only clears it; Ctrl / Shift add to it.
    createPressAsks =
      clickToCreate &&
      event.button === 0 &&
      !(event.ctrlKey || event.metaKey || event.shiftKey) &&
      state.selection.clipIds.length === 0 &&
      state.selection.automationPointIds.length === 0;
    // The level handle belongs to Select / Draw; every other tool sees the
    // clip itself.
    const levelTool = core.getState().tool === "select" || core.getState().tool === "draw";
    const hit: PlaylistHit =
      (rawHit.kind === "clip-level" && (!levelTool || event.button !== 0)) ||
      (rawHit.kind === "clip-extend" && event.button !== 0)
        ? { kind: "clip", clip: rawHit.clip, clipId: rawHit.clipId }
        : rawHit;

    // Any new pointerdown cancels in-flight inertia before further
    // dispatch; the user clearly wants a fresh gesture.
    touchTracker.cancelInertia();
    if (touchTracker.handlePointerDown(event, point, hit)) {
      event.preventDefault();
      return;
    }

    if (state.contextMenu) {
      // The HTML menu overlay handles its own outside-click, but suppress the
      // first LMB on the canvas so it doesn't act through the menu.
      core.closeContextMenu();
      if (event.button === 0) {
        event.preventDefault();
        return;
      }
    }

    // Middle button, or Space held + left button: the hand (pan).
    if (event.button === 1 || (spaceHeld && event.button === 0)) {
      if (spaceHeld) spacePanned = true;
      panCount = 0;
      recordPan(point, event.timeStamp);
      activeGesture = {
        kind: "pan",
        pointerId: event.pointerId,
        startPoint: point,
        startScrollX: state.viewport.scrollX,
        startScrollY: state.viewport.scrollY,
      };
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool, toolCursors);
      event.preventDefault();
      return;
    }

    // Inert chrome (overview lane header cell): no tool, no menu.
    if (hit.kind === "chrome") {
      event.preventDefault();
      return;
    }

    if (event.button === 2) {
      if (state.tool === "zoom") {
        zoomToolApplyOut({ core, metrics, point, hit, event });
        event.preventDefault();
        return;
      }
      if (hit.kind === "track-header") {
        core.openTrackContextMenu(hit.trackIndex, point);
        event.preventDefault();
        return;
      }

      if (hit.kind === "marker") {
        core.openMarkerContextMenu(hit.markerId, point);
        event.preventDefault();
        return;
      }

      if (hit.kind === "automation-point") {
        core.removeAutomationPoint(hit.clip.id, hit.pointId);
        event.preventDefault();
        return;
      }

      // Draw, Paint and Mute tools: RMB on clips deletes; drag keeps deleting.
      //
      // Automation clips are excluded by CLIP TYPE, not by hit kind: FL
      // documents RMB over an automation clip as "add control point", and the
      // branch below owns it. Filtering only `automation-body` would still let
      // an RMB on the clip's title bar or on its 8 px resize edges delete the
      // whole envelope. The sweep carries `skipAutomation` for the same reason.
      // Deleting an automation clip goes through the Delete tool or the
      // context menu.
      if (
        (state.tool === "draw" ||
          state.tool === "paint" ||
          state.tool === "mute") &&
        (hit.kind === "clip" ||
          hit.kind === "resize-left" ||
          hit.kind === "resize-right") &&
        hit.clip.type !== "automation"
      ) {
        const deletedClipIds = new Set<string>([hit.clip.id]);
        core.beginGesture();
        if (deferDelete) reportPending("delete", [hit.clip.id]);
        else core.deleteClips([hit.clip.id]);
        activeGesture = {
          kind: "delete-drag",
          pointerId: event.pointerId,
          lastPoint: { ...point },
          deletedClipIds,
          skipAutomation: true,
          deferred: deferDelete,
        };
        host.setPointerCapture?.(event.pointerId);
        setCursor(host, hit, activeGesture, state.tool, toolCursors);
        event.preventDefault();
        return;
      }

      // RMB anywhere on an automation clip (body, title or edges) adds a
      // control point with Draw/Paint/Mute active.
      if (
        (state.tool === "draw" ||
          state.tool === "paint" ||
          state.tool === "mute") &&
        (hit.kind === "clip" ||
          hit.kind === "resize-left" ||
          hit.kind === "resize-right") &&
        hit.clip.type === "automation"
      ) {
        const next = automationPointFromScreen(state, hit.clip, point, metrics);
        core.addAutomationPoint(
          hit.clip.id,
          core.snapTime(next.time, event.altKey, state),
          next.value,
        );
        event.preventDefault();
        return;
      }

      if (hit.kind === "automation-body") {
        const next = automationPointFromScreen(state, hit.clip, point, metrics);
        core.addAutomationPoint(
          hit.clip.id,
          core.snapTime(next.time, event.altKey, state),
          next.value,
        );
        event.preventDefault();
        return;
      }

      // Select / Slip / Slice: RMB opens a context menu. Slip and Slice have
      // no distinct right-button gesture, so they share select's menu here.
      if (state.tool === "select" || state.tool === "slip" || state.tool === "slice") {
        if (
          hit.kind === "clip" ||
          hit.kind === "resize-left" ||
          hit.kind === "resize-right"
        ) {
          core.openClipContextMenu(hit.clip.id, point);
          event.preventDefault();
          return;
        }
        if (hit.kind === "empty") {
          const time = Math.max(
            0,
            core.snapTime(screenXToTime(state, point.x, metrics), event.altKey, state),
          );
          const trackIndex = screenYToTrackIndex(state, point.y, metrics);
          core.openBackgroundContextMenu(time, trackIndex, point);
          event.preventDefault();
          return;
        }
      }

      return;
    }

    if (event.button !== 0) {
      return;
    }

    if (hit.kind === "scrollbar-horizontal") {
      const track = getHorizontalScrollbarRect(state, metrics);
      let thumb = getHorizontalScrollbarThumbRect(state, metrics);
      const scrollableRange = getHorizontalScrollableRange(state, metrics);
      const px = state.viewport.pxPerBeat;
      // The track maps the whole addressable extent (frozen for this press).
      const beatsPerPx =
        getHorizontalContentExtent(state, metrics) / px / Math.max(1, track.width);
      const width = timelineWidthOf(state);
      // Double-click on the thumb: see everything.
      if (hit.onThumb && clickCount === 2) {
        const end = Math.max(core.getContentEndTime(), width / px);
        navigator.showRange(0, end * 1.02);
        event.preventDefault();
        return;
      }
      // Thumb ends: zoom by stretching the visible window.
      if (hit.edge) {
        const startBeat = state.viewport.scrollX / px;
        const endBeat = (state.viewport.scrollX + width) / px;
        activeGesture = {
          kind: "scrollbar-zoom",
          pointerId: event.pointerId,
          edge: hit.edge,
          fixedBeat: hit.edge === "start" ? endBeat : startBeat,
          trackX: track.x,
          beatsPerPx,
        };
        host.setPointerCapture?.(event.pointerId);
        setCursor(host, hit, activeGesture, state.tool, toolCursors);
        event.preventDefault();
        return;
      }
      // Track outside the thumb: glide there (centred), no jump.
      if (!hit.onThumb) {
        navigator.reveal((point.x - track.x) * beatsPerPx, { align: "center" });
        event.preventDefault();
        return;
      }
      // Click on the track outside the thumb: page-jump so the thumb lands
      // under the cursor, then start a drag from that new origin. Matches
      // the standard browser scrollbar behaviour.
      let startScrollX = state.viewport.scrollX;
      let anchorPoint = point;
      if (!hit.onThumb) {
        const travelInit = Math.max(1, track.width - thumb.width);
        const ratio = clamp(
          (point.x - track.x - thumb.width / 2) / travelInit,
          0,
          1,
        );
        startScrollX = Math.max(0, ratio * scrollableRange);
        core.updateViewport({ scrollX: startScrollX });
        thumb = getHorizontalScrollbarThumbRect(core.getState(), metrics);
        anchorPoint = { x: thumb.x + thumb.width / 2, y: point.y };
      }
      const travel = Math.max(1, track.width - thumb.width);
      activeGesture = {
        kind: "scrollbar-horizontal",
        pointerId: event.pointerId,
        startPoint: anchorPoint,
        startScrollX,
        scrollableRange,
        travel,
      };
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool, toolCursors);
      event.preventDefault();
      return;
    }

    if (hit.kind === "scrollbar-vertical") {
      const layout = core.getLayoutOptions();
      const track = getVerticalScrollbarRect(state, metrics);
      let thumb = getVerticalScrollbarThumbRect(state, metrics, layout);
      const scrollableRange = getVerticalScrollableRange(state, metrics, layout);
      let startScrollY = state.viewport.scrollY;
      let anchorPoint = point;
      if (!hit.onThumb) {
        const travelInit = Math.max(1, track.height - thumb.height);
        const ratio = clamp(
          (point.y - track.y - thumb.height / 2) / travelInit,
          0,
          1,
        );
        startScrollY = Math.max(0, ratio * scrollableRange);
        core.updateViewport({ scrollY: startScrollY });
        thumb = getVerticalScrollbarThumbRect(core.getState(), metrics, layout);
        anchorPoint = { x: point.x, y: thumb.y + thumb.height / 2 };
      }
      const travel = Math.max(1, track.height - thumb.height);
      activeGesture = {
        kind: "scrollbar-vertical",
        pointerId: event.pointerId,
        startPoint: anchorPoint,
        startScrollY,
        scrollableRange,
        travel,
      };
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool, toolCursors);
      event.preventDefault();
      return;
    }

    if (hit.kind === "track-mute-button") {
      core.toggleTrackMute(hit.trackIndex);
      event.preventDefault();
      return;
    }

    if (hit.kind === "track-solo-button") {
      core.toggleTrackSolo(hit.trackIndex);
      event.preventDefault();
      return;
    }

    if (hit.kind === "track-lock-button") {
      core.toggleTrackLock(hit.trackIndex);
      event.preventDefault();
      return;
    }

    if (hit.kind === "track-resize-handle") {
      // The row is lanes x one lane height: the handle sizes one lane.
      const resized = state.tracks[hit.trackIndex];
      const startHeight = resized
        ? getTrackLaneHeight(resized, metrics)
        : getTrackHeightByIndex(state, hit.trackIndex, metrics);
      activeGesture = {
        kind: "track-resize",
        pointerId: event.pointerId,
        trackIndex: hit.trackIndex,
        startY: point.y,
        startHeight,
      };
      core.beginGesture();
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool, toolCursors);
      event.preventDefault();
      return;
    }

    if (hit.kind === "track-reorder-handle") {
      activeGesture = {
        kind: "track-reorder",
        pointerId: event.pointerId,
        fromIndex: hit.trackIndex,
        currentIndex: hit.trackIndex,
      };
      core.beginGesture();
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool, toolCursors);
      event.preventDefault();
      return;
    }

    if (hit.kind === "track-header") {
      core.setSelection({ clipIds: [], automationPointIds: [] });
      event.preventDefault();
      return;
    }

    if (hit.kind === "marker") {
      const marker = state.markers.find((m) => m.id === hit.markerId);
      if (marker) {
        activeGesture = {
          kind: "marker-drag",
          pointerId: event.pointerId,
          markerId: marker.id,
          startTime: marker.time,
          startPointerTime: screenXToTime(state, point.x, metrics),
        };
        core.beginGesture();
        host.setPointerCapture?.(event.pointerId);
        setCursor(host, hit, activeGesture, state.tool, toolCursors);
        event.preventDefault();
        return;
      }
    }

    if (hit.kind === "clip-level" && onClipLevelDrag && event.button === 0) {
      activeGesture = {
        kind: "clip-level",
        pointerId: event.pointerId,
        clipId: hit.clipId,
        startY: point.y,
        startX: point.x,
        // Grip mode decides the axis on the first moves (axis lock).
        vertical: !levelGrip,
      };
      core.setClipSelection([hit.clipId]);
      core.beginGesture();
      if (!levelGrip) {
        const text = onClipLevelDrag({ clipId: hit.clipId, phase: "start", deltaY: 0 });
        if (text) core.setTooltip({ kind: "time", text, anchor: point });
      }
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool, toolCursors);
      event.preventDefault();
      return;
    }

    if (hit.kind === "clip-extend" && event.button === 0) {
      activeGesture = {
        kind: "clip-extend",
        pointerId: event.pointerId,
        clipId: hit.clipId,
        startPointerTime: screenXToTime(state, point.x, metrics),
        originalEnd: hit.clip.start + hit.clip.duration,
        travelled: 0,
        grabOffsetX: hit.x - point.x,
      };
      core.beginGesture();
      core.setDragPreview({
        kind: "clip-resize",
        clipId: hit.clipId,
        edge: "right",
        previewStart: hit.clip.start,
        previewDuration: hit.clip.duration,
        handleX: hit.x,
      });
      core.setTooltip({
        kind: "time",
        text: core.formatEndTime(hit.clip.start + hit.clip.duration),
        anchor: point,
        time: core.endTooltipBeat(hit.clip.start + hit.clip.duration),
      });
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool, toolCursors);
      event.preventDefault();
      return;
    }

    if (hit.kind === "play-position-marker" || hit.kind === "ruler") {
      core.setPlayPosition(
        core.snapTime(screenXToTime(state, point.x, metrics), event.altKey, state),
      );
      activeGesture = {
        kind: "play-position-drag",
        pointerId: event.pointerId,
      };
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool, toolCursors);
      event.preventDefault();
      return;
    }

    // F4: double-click on a clip emits a host-level CustomEvent so the
    // React shell can open a clip-detail modal. We bubble through DOM
    // rather than holding modal state in the playlist-core because the
    // modal's contents are a shell concern (the financial engine modal
    // will replace this stub later).
    //
    // Only for the tools whose FL double-click means "open": Select, Draw
    // and Paint. Zoom, Mute, Slip, Slice and Delete act on EVERY press
    // (click-click-click zooms 3 times, two clicks mute then unmute), so
    // their second press must reach the tool instead of opening a modal.
    if (
      clickCount === 2 &&
      (state.tool === "select" ||
        state.tool === "draw" ||
        state.tool === "paint") &&
      (hit.kind === "clip" || hit.kind === "automation-body")
    ) {
      const evt = new CustomEvent("playlist-clip-open", {
        detail: { clipId: hit.clip.id },
        bubbles: true,
      });
      host.dispatchEvent(evt);
      event.preventDefault();
      return;
    }

    // F13: the eyedropper no longer lives on a pointer modifier at all — see
    // `pickColorUnderCursor` and the "I" hotkey. Every Alt/Shift combination
    // over a clip now reaches the active tool, which is what FL expects:
    // Alt = move without snap, Shift = clone, Alt+Shift = clone without snap.

    // Delegate timeline-area hits to the active tool.
    //
    // The undo gesture opens BEFORE the tool runs: a pointer-down that
    // already changes the document (paint stamps a clip, Shift clones the
    // selection, Delete / Mute act on the clicked clip, Draw double-click
    // creates one) must share ONE undo entry with the drag that follows and
    // with any host follow-up a microtask folds in through core.amend.
    // Pushing the creating dispatch on its own let one Ctrl+Z revert only
    // the drag + fix-ups (R2-BRIDGE-1). A gesture records an entry only when
    // something undoable was dispatched, so selection clicks / marquee
    // starts stay out of the history. Closed right away unless the tool
    // returned a document-mutating drag, which pointerup closes.
    const tool = getTool(state.tool);
    core.beginGesture();
    let gesture: ActiveGesture | null = null;
    try {
      gesture = tool.onPointerDown({
        core,
        metrics,
        point,
        hit,
        event,
        clickCount,
        onCreateRequest,
        deferDelete,
      });
    } finally {
      if (!gesture || !gestureMutatesDoc(gesture)) {
        core.endGesture();
      }
    }
    if (gesture) {
      activeGesture = gesture;
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool, toolCursors);
      if (gesture.kind === "delete-drag" && gesture.deferred) {
        reportPending("delete", [...gesture.deletedClipIds]);
      }
    }
    event.preventDefault();
  };

  function gestureMutatesDoc(gesture: ActiveGesture): boolean {
    return (
      gesture.kind === "clip-drag" ||
      gesture.kind === "clip-resize" ||
      gesture.kind === "clip-create-drag" ||
      gesture.kind === "automation-point-drag" ||
      gesture.kind === "paint-drag" ||
      gesture.kind === "delete-drag" ||
      gesture.kind === "mute-drag" ||
      gesture.kind === "slip-drag" ||
      gesture.kind === "marker-drag"
    );
  }

  // Edge auto-scroll: while a drag sits within EDGE_ZONE px of the
  // timeline's edges, the view glides that way (faster closer to the edge)
  // and the drag is re-applied at the same pointer every frame, so a clip
  // can be carried months away without letting go.
  const EDGE_ZONE = 44;
  const EDGE_MAX_SPEED = 1400; // px/s
  const edgeSpeed = (distanceIntoZone: number): number => {
    const t = Math.min(1, Math.max(0, distanceIntoZone / EDGE_ZONE));
    return EDGE_MAX_SPEED * t * t;
  };
  const updateEdgeScroll = (gesture: ActiveGesture, point: PlaylistPoint): void => {
    const horizontal =
      gesture.kind === "clip-drag" ||
      gesture.kind === "clip-resize" ||
      gesture.kind === "clip-extend" ||
      gesture.kind === "clip-create-drag" ||
      gesture.kind === "marquee" ||
      gesture.kind === "paint-drag" ||
      gesture.kind === "slip-drag" ||
      gesture.kind === "marker-drag" ||
      gesture.kind === "automation-point-drag" ||
      gesture.kind === "play-position-drag";
    const vertical =
      gesture.kind === "clip-drag" || gesture.kind === "marquee" || gesture.kind === "paint-drag";
    if (!horizontal) return;
    const state = core.getState();
    const left = metrics.trackHeaderWidth;
    const right = state.viewport.width - metrics.scrollbarSize;
    let vx = 0;
    if (point.x > right - EDGE_ZONE) vx = edgeSpeed(point.x - (right - EDGE_ZONE));
    else if (point.x < left + EDGE_ZONE && state.viewport.scrollX > 0) {
      vx = -edgeSpeed(left + EDGE_ZONE - point.x);
    }
    let vy = 0;
    if (vertical) {
      const top = getTracksTop(metrics);
      const bottom = state.viewport.height - getHorizontalScrollbarHeight(metrics);
      if (point.y > bottom - EDGE_ZONE && verticalRoom(state) > 0.5) {
        vy = edgeSpeed(point.y - (bottom - EDGE_ZONE)) * 0.6;
      } else if (point.y < top + EDGE_ZONE && point.y > top - 8 && state.viewport.scrollY > 0) {
        vy = -edgeSpeed(top + EDGE_ZONE - point.y) * 0.6;
      }
    }
    navigator.setEdgeScroll(vx, vy, reapplyGestureMove);
  };
  const reapplyGestureMove = (): void => {
    if (activeGesture && lastGestureMove) handlePointerMove(lastGestureMove);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    const state = core.getState();
    const point = resolvePoint(host, event);
    if (activeGesture && activeGesture.pointerId === event.pointerId) {
      lastGestureMove = event;
      // A drag has its own guides (snap line, time tooltip): no hover line.
      if (hoverTimeIndicator) core.setHoverTime(null);
      updateEdgeScroll(activeGesture, point);
    }

    if (
      pressHeld &&
      !pressDragged &&
      (Math.abs(point.x - lastPressX) > DOUBLE_CLICK_SLOP_PX ||
        Math.abs(point.y - lastPressY) > DOUBLE_CLICK_SLOP_PX)
    ) {
      pressDragged = true;
    }

    // F8: let the touch tracker consume mid-pinch updates so the
    // controller's gesture branches don't fight the zoom math.
    if (touchTracker.handlePointerMove(event, point)) {
      event.preventDefault();
      return;
    }

    if (!activeGesture) {
      const hit = hitAt(point);
      setHoverFromHit(core, hit);
      // Info card: armed when the hovered clip changes (mouse / pen only;
      // a tap shows it on touch), so a steady hover costs nothing.
      const overClip = hitClipId(hit);
      if (hoverCardDelayMs !== undefined && event.pointerType !== "touch") {
        if (overClip !== hoverCardClipId) {
          cancelHoverCard();
          if (overClip !== null) {
            hoverCardClipId = overClip;
            hoverCardPoint = point;
            hoverCardTimer = setTimeout(() => {
              hoverCardTimer = null;
              if (activeGesture || hoverCardClipId !== overClip) return;
              showClipCard(overClip, hoverCardPoint);
            }, hoverCardDelayMs);
          }
        } else if (overClip !== null && hoverCardTimer !== null) {
          // Still waiting: the card opens where the pointer rests.
          hoverCardPoint = point;
        }
      }
      if (onOverviewHover) {
        const inLane =
          hit.kind === "ruler" &&
          point.y > metrics.rulerHeight &&
          point.y <= getTracksTop(metrics);
        reportOverviewHover(
          inLane ? Math.max(0, Math.floor(screenXToTime(state, point.x, metrics))) : null,
        );
      }
      // Hover-time indicator: the beat cell under the pointer over the
      // timeline columns (SET_HOVER_TIME is idempotent: one notify per cell).
      if (hoverTimeIndicator) {
        const viewport = state.viewport;
        const overTimeline =
          point.x >= metrics.trackHeaderWidth &&
          point.x < viewport.width - metrics.scrollbarSize &&
          point.y >= 0 &&
          point.y < viewport.height - getHorizontalScrollbarHeight(metrics) &&
          hit.kind !== "scrollbar-horizontal" &&
          hit.kind !== "scrollbar-vertical";
        core.setHoverTime(overTimeline ? screenXToTime(state, point.x, metrics) : null);
      }
      // F3: hover on the ruler emits a B.B.T tooltip; everywhere else the
      // tooltip is cleared. setTooltip short-circuits when the value
      // doesn't change, so calling clearTooltip every pointermove is free
      // when no tooltip was active. With the hover-time indicator the ruler
      // names the day itself: no tooltip over the curve.
      if (!hoverTimeIndicator && (hit.kind === "ruler" || hit.kind === "play-position-marker")) {
        const tooltipBeats = Math.max(
          0,
          screenXToTime(state, point.x, metrics),
        );
        core.setTooltip({
          kind: "time",
          text: core.formatTime(tooltipBeats),
          anchor: point,
          time: tooltipBeats,
        });
      } else if (trackButtonHints && isTrackButtonHit(hit)) {
        // What the header button does, anchored under the button (a fixed
        // anchor: SET_TOOLTIP stays idempotent while the pointer rests).
        const row = core
          .getPresentation()
          .trackRowsByIndex.get((hit as { trackIndex: number }).trackIndex);
        const track = row?.track;
        let text: string | undefined;
        let rect = row?.reorderHandleRect;
        if (hit.kind === "track-mute-button") {
          text = trackButtonHints.mute[track?.muted === true ? 1 : 0];
          rect = row?.buttons.mute;
        } else if (hit.kind === "track-solo-button") {
          text = trackButtonHints.solo[track?.soloed === true ? 1 : 0];
          rect = row?.buttons.solo;
        } else if (hit.kind === "track-lock-button") {
          text = trackButtonHints.lock[track?.locked === true ? 1 : 0];
          rect = row?.buttons.lock;
        } else {
          text = trackButtonHints.reorder;
        }
        if (text && rect) {
          core.setTooltip({
            kind: "hint",
            text,
            anchor: { x: rect.x - 4, y: rect.y + rect.height + 30 },
          });
        } else {
          core.clearTooltip();
        }
      } else {
        // The info card stays while the pointer is over its clip.
        const tooltip = state.tooltip;
        const keepCard =
          tooltip !== null &&
          tooltip.kind === "clip" &&
          overClip !== null &&
          tooltip.clipId === overClip;
        if (!keepCard) core.clearTooltip();
      }
      setCursor(host, hit, null, state.tool, toolCursors);
      return;
    }

    if (activeGesture.pointerId !== event.pointerId) {
      return;
    }

    const gesture = activeGesture;

    if (gesture.kind === "clip-level") {
      if (!gesture.vertical) {
        // Axis lock: decided on the first 6 px. Mostly horizontal = a plain
        // move of the clip (what a press on its body does); vertical = the
        // host level drag.
        const dx = point.x - gesture.startX;
        const dy = point.y - gesture.startY;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) {
          event.preventDefault();
          return;
        }
        if (Math.abs(dx) > Math.abs(dy)) {
          const clip = state.clips.find((candidate) => candidate.id === gesture.clipId);
          const drag = clip
            ? getTool("select").onPointerDown({
                core,
                metrics,
                point: { x: gesture.startX, y: gesture.startY },
                hit: { kind: "clip", clip, clipId: clip.id },
                // The press modifiers are not a clone / toggle here.
                event: {
                  pointerId: event.pointerId,
                  ctrlKey: false,
                  metaKey: false,
                  shiftKey: false,
                  altKey: event.altKey,
                  detail: 1,
                } as PointerEvent,
                clickCount: 1,
              })
            : null;
          if (drag && drag.kind === "clip-drag") {
            activeGesture = drag;
            setCursor(host, null, drag, state.tool, toolCursors);
            handlePointerMove(event);
          } else {
            event.preventDefault();
          }
          return;
        }
        gesture.vertical = true;
        const first = onClipLevelDrag?.({
          clipId: gesture.clipId,
          phase: "start",
          deltaY: 0,
          fine: event.shiftKey,
        });
        if (first) core.setTooltip({ kind: "time", text: first, anchor: point });
      }
      const text = onClipLevelDrag?.({
        clipId: gesture.clipId,
        phase: "move",
        deltaY: gesture.startY - point.y,
        fine: event.shiftKey,
      });
      if (text) core.setTooltip({ kind: "time", text, anchor: point });
      else core.clearTooltip();
      event.preventDefault();
      return;
    }

    if (gesture.kind === "pan") {
      recordPan(point, event.timeStamp);
      core.updateViewport({
        scrollX: gesture.startScrollX - (point.x - gesture.startPoint.x),
        scrollY: gesture.startScrollY - (point.y - gesture.startPoint.y),
      });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "scrollbar-zoom") {
      const width = timelineWidthOf(state);
      const minSpan = width / metrics.maxPxPerBeat;
      const maxSpan = width / metrics.minPxPerBeat;
      const beat = Math.max(0, (point.x - gesture.trackX) * gesture.beatsPerPx);
      let start: number;
      let end: number;
      if (gesture.edge === "end") {
        start = gesture.fixedBeat;
        end = Math.min(start + maxSpan, Math.max(start + minSpan, beat));
      } else {
        end = gesture.fixedBeat;
        start = Math.max(0, Math.max(end - maxSpan, Math.min(end - minSpan, beat)));
      }
      const pxPerBeat = width / Math.max(minSpan, end - start);
      core.updateViewport({ pxPerBeat, scrollX: start * pxPerBeat });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "marquee") {
      core.setMarquee({ start: gesture.startPoint, current: point });
      selectClipsInMarquee(core, gesture.additive);
      event.preventDefault();
      return;
    }

    if (gesture.kind === "clip-drag") {
      const primary = gesture.originals.find(
        (clip) => clip.id === gesture.primaryClipId,
      );

      if (!primary) {
        return;
      }

      const currentTime = screenXToTime(state, point.x, metrics);
      const rawPrimaryStart =
        primary.start + (currentTime - gesture.startPointerTime);
      const primaryStart = core.snapTime(rawPrimaryStart, event.altKey, state);
      const deltaTime = primaryStart - primary.start;
      const currentTrackIndex = screenYToTrackIndex(state, point.y, metrics);
      const trackDelta = currentTrackIndex - gesture.startTrackIndex;
      // +Infinity with virtual tracks; the last real track otherwise, so
      // the ghost never shows a drop on a row that is only background.
      const maxTrack = Math.max(0, core.maxTrackIndex());
      const targetTrackIndex = clamp(gesture.startTrackIndex + trackDelta, 0, maxTrack);
      // Stacked lanes (lanes.ts): the primary clip goes to the lane under
      // the pointer; a row with other clips opens one extra, empty lane
      // below its lanes (the free lane) to stack at the same time as them.
      const target = dragLaneTarget(state, gesture, targetTrackIndex, point.y);
      const allMoves = gesture.originals.map((clip) => ({
        id: clip.id,
        start: clip.start + deltaTime,
        trackIndex: clamp(clip.trackIndex + trackDelta, 0, maxTrack),
        lane: clip.id === gesture.primaryClipId ? target.lane : clip.lane,
      }));

      core.moveClips(allMoves);
      emitDragOverlays(core, state, point, event.altKey, {
        kind: "clip-move",
        primaryClipId: gesture.primaryClipId,
        previewTrackIndex: targetTrackIndex,
        previewStart: primaryStart,
        allMoves,
        freeLane: target.freeLane,
      });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "clip-resize") {
      const time = core.snapTime(
        screenXToTime(state, point.x, metrics),
        event.altKey,
        state,
      );
      // stretchEnabled === false keeps state.stretchMode false already; the
      // explicit check makes "no gesture enters stretch-resize" local.
      if (state.stretchMode && core.stretchEnabled) {
        core.stretchResizeClip(gesture.clipId, gesture.edge, time);
      } else {
        core.resizeClip(gesture.clipId, gesture.edge, time);
      }
      const clipAfter = core
        .getState()
        .clips.find((c) => c.id === gesture.clipId);
      if (clipAfter) {
        emitDragOverlays(core, state, point, event.altKey, {
          kind: "clip-resize",
          clipId: gesture.clipId,
          edge: gesture.edge,
          previewStart: clipAfter.start,
          previewDuration: clipAfter.duration,
        });
      }
      event.preventDefault();
      return;
    }

    if (gesture.kind === "clip-extend") {
      const clip = state.clips.find((c) => c.id === gesture.clipId);
      if (!clip) {
        event.preventDefault();
        return;
      }
      // Relative: the end moves by the time the pointer travelled (scroll
      // included, so edge auto-scroll keeps carrying it), sped up when
      // zoomed in (clipExtendMinBeatsPerPx). Accumulated move by move so a
      // zoom change mid-drag never re-scales what was already travelled.
      const pointerTime = screenXToTime(state, point.x, metrics);
      const gain = Math.max(1, extendMinBeatsPerPx * state.viewport.pxPerBeat);
      gesture.travelled += (pointerTime - gesture.startPointerTime) * gain;
      gesture.startPointerTime = pointerTime;
      const end = Math.max(
        clip.start + metrics.minClipDuration,
        core.snapTime(gesture.originalEnd + gesture.travelled, event.altKey, state),
      );
      core.resizeClip(gesture.clipId, "right", end);
      const after = core.getState().clips.find((c) => c.id === gesture.clipId) ?? clip;
      emitDragOverlays(
        core,
        state,
        point,
        event.altKey,
        {
          kind: "clip-resize",
          clipId: gesture.clipId,
          edge: "right",
          previewStart: after.start,
          previewDuration: after.duration,
          handleX: point.x + gesture.grabOffsetX,
        },
        after.start + after.duration,
      );
      event.preventDefault();
      return;
    }

    if (gesture.kind === "clip-create-drag" && gesture.hostCreate) {
      const endTime = core.snapTime(screenXToTime(state, point.x, metrics), event.altKey, state);
      const minEnd = gesture.startSnappedStart + metrics.minClipDuration;
      if (endTime <= minEnd && gesture.hostCreate.end === null) {
        event.preventDefault();
        return;
      }
      const end = Math.max(endTime, minEnd);
      gesture.hostCreate.end = end;
      const duration = end - gesture.startSnappedStart;
      emitDragOverlays(
        core,
        state,
        point,
        event.altKey,
        {
          kind: "clip-create",
          trackIndex: gesture.startTrackIndex,
          lane: creationLane(state, gesture.startTrackIndex, gesture.startSnappedStart, end),
          previewStart: gesture.startSnappedStart,
          previewDuration: duration,
        },
        end,
      );
      event.preventDefault();
      return;
    }

    if (gesture.kind === "clip-create-drag") {
      // Draw-tool drag from empty space. We only commit a clip once the
      // cursor has crossed minClipDuration past the snapped start so a
      // micro-drag (single-click bounce) doesn't leave a stray clip behind.
      // After creation, every subsequent move adjusts the right edge.
      const rawTime = screenXToTime(state, point.x, metrics);
      const endTime = core.snapTime(rawTime, event.altKey, state);
      const minEnd = gesture.startSnappedStart + metrics.minClipDuration;
      if (endTime <= minEnd && gesture.createdClipId === null) {
        event.preventDefault();
        return;
      }
      const effectiveEnd = Math.max(endTime, minEnd);
      if (gesture.createdClipId === null) {
        const id = core.createClip({
          trackIndex: gesture.startTrackIndex,
          start: gesture.startSnappedStart,
          duration: effectiveEnd - gesture.startSnappedStart,
          type: gesture.template.type,
          label: gesture.template.label,
          color: gesture.template.color,
          sourceId: gesture.template.sourceId,
        });
        gesture.createdClipId = id;
        core.setSelection({ clipIds: [id], automationPointIds: [] });
      } else {
        core.resizeClip(gesture.createdClipId, "right", effectiveEnd);
      }
      emitDragOverlays(core, state, point, event.altKey, {
        kind: "clip-resize",
        clipId: gesture.createdClipId ?? "",
        edge: "right",
        previewStart: gesture.startSnappedStart,
        previewDuration: effectiveEnd - gesture.startSnappedStart,
      });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "slip-drag") {
      const currentTime = screenXToTime(state, point.x, metrics);
      const deltaScreen = currentTime - gesture.startPointerTime;
      // contentOffset is measured in content beats; one screen beat equals
      // stretchRatio content beats, and the slip moves the content opposite
      // to the cursor (drag right = content shifts left under the window).
      const nextOffset =
        gesture.startContentOffset - deltaScreen * gesture.startStretchRatio;
      core.setClipContentOffset(gesture.clipId, nextOffset);
      // Live feedback near the cursor. The clip also paints a persistent ↻
      // badge, but the tooltip tracks the value mid-drag the same way
      // clip-move / resize show a B.B.T tooltip.
      core.setTooltip({
        kind: "offset",
        text: `↻ ${nextOffset.toFixed(2).replace(/\.?0+$/, "")}`,
        anchor: point,
      });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "slice-drag") {
      gesture.currentPoint = { ...point };
      const snapped = core.snapTime(
        Math.max(0, screenXToTime(state, point.x, metrics)),
        event.altKey,
        state,
      );
      // Reuse the snap-indicator vertical line as the slice guide (a thin
      // full-height line at the cut), plus a B.B.T tooltip. No dedicated
      // presentation field needed; both clear on release via
      // clearDragOverlays. `visible` stays true regardless of snap mode —
      // this marks where the cut lands, it's not just a snap hint.
      core.setSnapHint({ time: snapped, visible: true });
      // What the cut will split (host scope): named in the tooltip and
      // reported as pending, only when the time or the scope changes.
      const all = !sliceTargeted || event.shiftKey;
      if (gesture.lastTime !== snapped || gesture.lastAll !== all) {
        gesture.lastTime = snapped;
        gesture.lastAll = all;
        const targets = sliceTargets(gesture, snapped, all);
        reportPending("slice", targets);
        sliceLabel = options.describeSlice ? options.describeSlice(targets, snapped) ?? "" : "";
      }
      core.setTooltip({
        kind: "time",
        text: sliceLabel || core.formatTime(snapped),
        anchor: point,
        time: snapped,
      });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "automation-point-drag") {
      const clip = state.clips.find(
        (candidate) => candidate.id === gesture.clipId,
      );

      if (!clip || clip.type !== "automation") {
        return;
      }

      const next = automationPointFromScreen(state, clip, point, metrics);
      core.moveAutomationPoint(
        gesture.clipId,
        gesture.pointId,
        event.ctrlKey
          ? gesture.originalTime
          : core.snapTime(next.time, event.altKey, state),
        event.shiftKey ? gesture.originalValue : next.value,
      );
      event.preventDefault();
      return;
    }

    if (gesture.kind === "play-position-drag") {
      const snapped = core.snapTime(
        screenXToTime(state, point.x, metrics),
        event.altKey,
        state,
      );
      core.setPlayPosition(snapped);
      emitDragOverlays(core, state, point, event.altKey, null, snapped);
      event.preventDefault();
      return;
    }

    if (gesture.kind === "marker-drag") {
      const currentTime = screenXToTime(state, point.x, metrics);
      const raw = gesture.startTime + (currentTime - gesture.startPointerTime);
      const snapped = core.snapTime(Math.max(0, raw), event.altKey, state);
      core.updateMarker(gesture.markerId, { time: snapped });
      emitDragOverlays(
        core,
        state,
        point,
        event.altKey,
        {
          kind: "marker",
          markerId: gesture.markerId,
          previewTime: snapped,
        },
        snapped,
      );
      event.preventDefault();
      return;
    }

    if (gesture.kind === "scrollbar-horizontal") {
      const delta =
        ((point.x - gesture.startPoint.x) / gesture.travel) *
        gesture.scrollableRange;
      core.updateViewport({
        scrollX: Math.max(0, gesture.startScrollX + delta),
      });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "scrollbar-vertical") {
      const delta =
        ((point.y - gesture.startPoint.y) / gesture.travel) *
        gesture.scrollableRange;
      core.updateViewport({
        scrollY: Math.max(0, gesture.startScrollY + delta),
      });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "paint-drag") {
      const trackIndex = screenYToTrackIndex(state, point.y, metrics);
      const start = Math.max(
        0,
        core.snapTime(screenXToTime(state, point.x, metrics), event.altKey, state),
      );
      if (
        trackIndex !== gesture.lastTrackIndex ||
        start !== gesture.lastSnappedStart
      ) {
        // Brush stroke: interpolate every snapped cell along the path so a
        // fast pointermove can't skip cells (canon §3 brush pattern).
        const path = interpolateBrushPath(
          {
            trackIndex: gesture.lastTrackIndex,
            start: gesture.lastSnappedStart,
          },
          { trackIndex, start },
          gesture.snapStep,
        );
        // Collect every new cell in the stroke, then create them all in a
        // single CREATE_CLIPS_BATCH dispatch. Canon §3.7: one move event,
        // one notify, one render — regardless of how many cells were
        // filled. Drop the first entry (previous frame already painted it).
        const toCreate: { trackIndex: number; start: number }[] = [];
        const currentState = core.getState();
        for (let i = 1; i < path.length; i += 1) {
          const cell = path[i]!;
          if (gesture.occupied.has(cell.trackIndex, cell.start, currentState)) {
            continue;
          }
          // Pre-mark as occupied so a self-overlapping stroke doesn't try
          // to enqueue the same cell twice.
          gesture.occupied.add(cell.trackIndex, cell.start, currentState);
          toCreate.push(cell);
        }
        if (toCreate.length > 0) {
          core.createClips(
            toCreate.map((cell) => ({
              trackIndex: cell.trackIndex,
              start: cell.start,
              duration: gesture.duration,
              type: gesture.type,
              label: gesture.label,
              color: gesture.color,
              sourceId: gesture.sourceId,
            })),
          );
        }
        gesture.lastTrackIndex = trackIndex;
        gesture.lastSnappedStart = start;
      }
      event.preventDefault();
      return;
    }

    if (gesture.kind === "delete-drag") {
      const ids = clipIdsTouchedBySegment(
        core,
        gesture.lastPoint,
        point,
        gesture.deletedClipIds,
        gesture.skipAutomation === true,
      );
      if (ids.length > 0) {
        // Deferred: only marked (the set only grows: one report per new clip).
        if (gesture.deferred) reportPending("delete", [...gesture.deletedClipIds]);
        else core.deleteClips(ids);
      }
      gesture.lastPoint = { ...point };
      event.preventDefault();
      return;
    }

    if (gesture.kind === "mute-drag") {
      const ids = clipIdsTouchedBySegment(
        core,
        gesture.lastPoint,
        point,
        gesture.touchedClipIds,
        false,
      );
      if (ids.length > 0) {
        core.setClipsMuted(ids, gesture.muted);
      }
      gesture.lastPoint = { ...point };
      event.preventDefault();
      return;
    }

    if (gesture.kind === "track-resize") {
      const dy = point.y - gesture.startY;
      const resized = state.tracks[gesture.trackIndex];
      const lanes = resized ? getTrackLaneCount(resized) : 1;
      core.setTrackHeight(gesture.trackIndex, gesture.startHeight + dy / lanes);
      event.preventDefault();
      return;
    }

    if (gesture.kind === "track-reorder") {
      const targetIndex = screenYToTrackIndex(state, point.y, metrics);
      if (targetIndex !== gesture.currentIndex) {
        core.reorderTrack(gesture.currentIndex, targetIndex);
        gesture.currentIndex = targetIndex;
        gesture.fromIndex = targetIndex;
      }
      event.preventDefault();
    }
  };

  const endGesture = (event: PointerEvent): void => {
    pressHeld = false;
    // F8: capture the kind of the gesture that's about to end so the
    // touch tracker can decide whether to start momentum scroll (only
    // pan / scrollbar gestures qualify).
    const endingGestureWasPanLike =
      activeGesture !== null &&
      (activeGesture.kind === "pan" ||
        activeGesture.kind === "scrollbar-horizontal" ||
        activeGesture.kind === "scrollbar-vertical");

    if (touchTracker.handlePointerUp(event, endingGestureWasPanLike)) {
      // The tracker consumed the up (e.g. tail end of a pinch). Don't
      // run the controller's gesture finalisation logic for this event.
      event.preventDefault();
      return;
    }

    if (!activeGesture || activeGesture.pointerId !== event.pointerId) {
      return;
    }

    navigator.setEdgeScroll(0, 0);
    lastGestureMove = null;
    if (activeGesture.kind === "pan") {
      // Throw the view: momentum from the release velocity.
      const { vx, vy } = panVelocity(event.timeStamp);
      navigator.fling(vx, verticalRoom(core.getState()) > 0.5 ? vy : 0);
    }

    if (activeGesture.kind === "marquee") {
      core.setMarquee(null);
    }

    // Host-owned creation: the previewed range becomes a request (the host
    // decides what, if anything, is added). Asked after the overlays clear.
    let createRequest: PlaylistCreateRequest | null =
      activeGesture.kind === "clip-create-drag" &&
      activeGesture.hostCreate &&
      activeGesture.hostCreate.end !== null
        ? {
            trackIndex: activeGesture.startTrackIndex,
            start: activeGesture.startSnappedStart,
            duration: activeGesture.hostCreate.end - activeGesture.startSnappedStart,
            templateClipId: activeGesture.hostCreate.templateClipId,
            point: { x: createPressX, y: createPressY },
            lane: creationLane(
              core.getState(),
              activeGesture.startTrackIndex,
              activeGesture.startSnappedStart,
              activeGesture.hostCreate.end,
            ),
            clickCount: 1,
          }
        : null;
    // Click-to-create: a click (no drag) on empty space — Select's marquee
    // that never grew, Draw's create that never reached a length.
    if (
      createRequest === null &&
      onCreateRequest &&
      clickToCreate &&
      !pressDragged &&
      ((activeGesture.kind === "marquee" && createPressAsks) ||
        (activeGesture.kind === "clip-create-drag" &&
          activeGesture.hostCreate !== undefined &&
          activeGesture.hostCreate.end === null))
    ) {
      const state = core.getState();
      const trackIndex = screenYToTrackIndex(state, createPressY, metrics);
      const start = Math.max(0, Math.floor(screenXToTime(state, createPressX, metrics)));
      createRequest = {
        trackIndex,
        start,
        duration: null,
        templateClipId:
          activeGesture.kind === "clip-create-drag"
            ? (activeGesture.hostCreate?.templateClipId ?? null)
            : null,
        point: { x: createPressX, y: createPressY },
        lane: creationLane(state, trackIndex, start, start + 1),
        clickCount: createPressCount,
      };
    }

    if (activeGesture.kind === "clip-level") {
      const point = resolvePoint(host, event);
      // Grip mode: a press that never proved vertical started nothing.
      if (activeGesture.vertical) {
        onClipLevelDrag?.({
          clipId: activeGesture.clipId,
          phase: "end",
          deltaY: activeGesture.startY - point.y,
          fine: event.shiftKey,
        });
      }
      core.endGesture();
    }

    if (activeGesture.kind === "slice-drag") {
      const state = core.getState();
      // Snap the slice point to the active grid (Alt bypasses snap). The
      // guide line + tooltip are cleared by clearDragOverlays below.
      const time = core.snapTime(
        Math.max(
          0,
          screenXToTime(state, activeGesture.currentPoint.x, metrics),
        ),
        event.altKey,
        state,
      );
      if (time > 0) {
        // Host scope "target": the pressed clip / selection (Shift: all).
        const all = !sliceTargeted || event.shiftKey;
        commitSlice(time, all ? undefined : sliceTargets(activeGesture, time, false));
      }
      sliceLabel = "";
      reportPending(null, []);
    }

    // Delete sweep: deferred = delete everything marked now (inside the
    // gesture, one undo entry); either way the host hears what went.
    if (activeGesture.kind === "delete-drag") {
      const marked = [...activeGesture.deletedClipIds];
      if (activeGesture.deferred) {
        const labelById = new Map<string, string>();
        for (const clip of core.getState().clips) labelById.set(clip.id, clip.label);
        const ids = marked.filter((id) => labelById.has(id));
        if (ids.length > 0) core.deleteClips(ids);
        const after = new Set(core.getState().clips.map((clip) => clip.id));
        const gone = ids.filter((id) => !after.has(id));
        reportPending(null, []);
        if (gone.length > 0) {
          onEdit?.({
            kind: "delete",
            clipIds: gone,
            labels: gone.map((id) => labelById.get(id) ?? ""),
          });
        }
      } else if (marked.length > 0 && onEdit) {
        onEdit({ kind: "delete", clipIds: marked, labels: [] });
      }
    }

    if (
      activeGesture.kind === "clip-drag" ||
      activeGesture.kind === "clip-resize" ||
      activeGesture.kind === "clip-extend" ||
      activeGesture.kind === "clip-create-drag" ||
      activeGesture.kind === "automation-point-drag" ||
      activeGesture.kind === "paint-drag" ||
      activeGesture.kind === "delete-drag" ||
      activeGesture.kind === "mute-drag" ||
      activeGesture.kind === "track-resize" ||
      activeGesture.kind === "track-reorder" ||
      activeGesture.kind === "slip-drag" ||
      activeGesture.kind === "marker-drag"
    ) {
      core.endGesture();
    }

    // F3: every gesture that emitted overlay state during the drag must
    // clear it on release. play-position-drag isn't undoable so it's not
    // in the list above, but it still sets snap/tooltip.
    clearDragOverlays(core);

    const tappedClipId =
      hoverCardDelayMs !== undefined &&
      event.pointerType === "touch" &&
      !pressDragged &&
      activeGesture.kind === "clip-drag"
        ? activeGesture.primaryClipId
        : null;
    activeGesture = null;
    host.releasePointerCapture?.(event.pointerId);
    setCursor(host, hitAt(resolvePoint(host, event)), null, core.getState().tool, toolCursors);
    if (createRequest) onCreateRequest?.(createRequest);
    if (tappedClipId !== null) showClipCard(tappedClipId, resolvePoint(host, event));
  };

  // Pointer wheel / trackpad.
  //   - Pinch (trackpad) or Ctrl/Cmd/Alt + wheel: zoom at the pointer —
  //     proportional and immediate for a trackpad, smooth steps for a
  //     notched wheel.
  //   - Trackpad two-finger swipe: free 2-D pan, 1:1 with the fingers;
  //     with no tracks to scroll, vertical swipes move time too.
  //   - Mouse wheel (options.mouseWheel): "time" — TIME (the main axis of
  //     an infinite timeline), smooth and accelerating (notches accumulate
  //     on the glide target); Shift + wheel, or the wheel over the track
  //     headers, scrolls the tracks. "rows" — the rows; Shift + wheel, or
  //     the wheel over the ruler / overview lane (they don't scroll
  //     vertically), moves time. A tilt wheel (deltaX) always moves time.
  const zoomImmediate = (factor: number, screenX: number): void => {
    const state = core.getState();
    const anchorTime = screenXToTime(state, screenX, metrics);
    const pxPerBeat = clamp(
      state.viewport.pxPerBeat * factor,
      metrics.minPxPerBeat,
      metrics.maxPxPerBeat,
    );
    core.updateViewport({
      pxPerBeat,
      scrollX: Math.max(0, anchorTime * pxPerBeat - (screenX - metrics.trackHeaderWidth)),
    });
  };

  const handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const state = core.getState();
    const point = resolvePoint(host, event);
    const device = classifyWheel(event);
    const width = timelineWidthOf(state);
    const scale = wheelDeltaScale(event.deltaMode, width);
    const dx = event.deltaX * scale;
    const dy = event.deltaY * scale;
    const anchorX = Math.max(point.x, metrics.trackHeaderWidth);

    if (event.ctrlKey || event.metaKey || event.altKey) {
      const delta = dy !== 0 ? dy : dx;
      if (device === "trackpad") {
        navigator.stop();
        zoomImmediate(Math.exp(-delta * 0.01), anchorX);
      } else {
        navigator.zoomBy(Math.pow(1.25, -delta / 100), anchorX);
      }
      return;
    }

    const room = verticalRoom(state) > 0.5 || state.viewport.scrollY > 0.5;
    const overHeaders = point.x < metrics.trackHeaderWidth && point.y > getTracksTop(metrics);

    if (device === "trackpad") {
      navigator.stop();
      let sx = dx;
      let sy = dy;
      if (!room && !overHeaders) {
        sx += sy;
        sy = 0;
      }
      core.updateViewport({
        scrollX: Math.max(0, state.viewport.scrollX + sx),
        scrollY: Math.max(0, state.viewport.scrollY + sy),
      });
      return;
    }

    const notch = dy !== 0 ? dy : dx;
    if (wheelScrollsRows) {
      // Shift arrives as deltaX on some platforms (Windows Chrome): either
      // way it means time; so does a tilt wheel, the bands above the rows
      // and the horizontal scrollbar under them (the navigator: it scrolls
      // the way it points).
      const overRows =
        point.y > getTracksTop(metrics) &&
        point.y < state.viewport.height - getHorizontalScrollbarHeight(metrics);
      if (!event.shiftKey && dx === 0 && overRows && room) {
        navigator.scrollBy(0, notch);
        return;
      }
    } else if ((event.shiftKey || overHeaders) && room && dx === 0) {
      navigator.scrollBy(0, notch);
      return;
    }
    // One notch (100 units) ≈ 15% of the timeline width, at least 90 px.
    const step = Math.max(90, width * 0.15) / 100;
    navigator.scrollBy(notch * step, 0);
  };

  // Brings a clip into view: its day (glide) and its row.
  const revealClip = (clipId: string): void => {
    const state = core.getState();
    const clip = state.clips.find((candidate) => candidate.id === clipId);
    if (!clip) return;
    navigator.reveal(clip.start, { align: "nearest", margin: 96 });
    const index = state.tracks.findIndex((track) => track.id === clip.trackId);
    if (index < 0) return;
    const top = getTrackTopByIndex(state, index, metrics);
    const height = getTrackHeightByIndex(state, index, metrics);
    const visible = Math.max(
      1,
      state.viewport.height - getTracksTop(metrics) - getHorizontalScrollbarHeight(metrics),
    );
    const scrollY = state.viewport.scrollY;
    if (top < scrollY) navigator.scrollTo({ scrollY: Math.max(0, top - 8) });
    else if (top + height > scrollY + visible) {
      navigator.scrollTo({ scrollY: Math.max(0, top + height - visible + 8) });
    }
  };

  // Alt+← / Alt+→: the keyboard focus (= the selection) walks the clips in
  // date order; with nothing selected it starts at the playhead. At an end
  // it stays (and is reported again, so a screen reader hears where it is).
  const focusAdjacentClip = (dir: 1 | -1): void => {
    const state = core.getState();
    const ordered = clipsInDateOrder(state);
    if (ordered.length === 0) return;
    const current = state.selection.clipIds[0];
    const index = current ? ordered.findIndex((clip) => clip.id === current) : -1;
    let next: number;
    if (index >= 0) {
      next = Math.max(0, Math.min(ordered.length - 1, index + dir));
    } else {
      const time = state.playPosition.time;
      if (dir > 0) {
        next = ordered.findIndex((clip) => clip.start >= time - 1e-9);
        if (next < 0) next = ordered.length - 1;
      } else {
        next = 0;
        for (let i = ordered.length - 1; i >= 0; i -= 1) {
          if (ordered[i]!.start < time) {
            next = i;
            break;
          }
        }
      }
    }
    const clip = ordered[next]!;
    core.setClipSelection([clip.id]);
    revealClip(clip.id);
    options.onClipFocus?.(clip.id);
  };

  // Shift+F10 / the Menu key: the menu of the selected clip (at the clip),
  // else the background menu at the playhead on the first row.
  const openMenuFromKeyboard = (): void => {
    const state = core.getState();
    const width = state.viewport.width;
    const clampX = (x: number) =>
      Math.max(metrics.trackHeaderWidth + 4, Math.min(width - 240, x));
    const clampY = (y: number) =>
      Math.max(getTracksTop(metrics) + 4, Math.min(state.viewport.height - 40, y));
    const id = state.selection.clipIds[0];
    if (id) {
      revealClip(id);
      const view = core.getPresentation().clipViewsById.get(id);
      const point = view
        ? {
            x: clampX(Math.max(metrics.trackHeaderWidth, view.rect.x) + 16),
            y: clampY(view.rect.y + view.rect.height - 4),
          }
        : { x: clampX(metrics.trackHeaderWidth + 24), y: clampY(getTracksTop(metrics) + 24) };
      core.openClipContextMenu(id, point);
      return;
    }
    const time = Math.max(0, Math.floor(state.playPosition.time));
    const point = {
      x: clampX(core.getPresentation().timeToScreenX(time)),
      y: clampY(getTracksTop(metrics) + 24),
    };
    core.openBackgroundContextMenu(time, 0, point);
  };

  const isArrowKey = (key: string): boolean =>
    key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";

  const handleKeyDown = (event: KeyboardEvent): void => {
    const cmd = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    // A keyboard move burst goes on only with more arrows (a bare modifier
    // press — e.g. Shift for ×4 — doesn't end it); anything else settles it
    // first (one undo entry, reported), then does its own thing.
    if (
      nudge &&
      !(isArrowKey(event.key) && !event.altKey) &&
      event.key !== "Shift" &&
      event.key !== "Control" &&
      event.key !== "Meta" &&
      event.key !== "Alt"
    ) {
      closeNudge();
    }

    if (event.key === "Escape") {
      let handled = false;
      const tooltip = core.getState().tooltip;
      if (tooltip && (tooltip.kind === "clip" || tooltip.kind === "hint")) {
        cancelHoverCard();
        core.clearTooltip();
        handled = true;
      } else if (options.escapeSelectsTool && core.getState().tool !== "select") {
        core.setTool("select");
        // The tool's cursor goes with it (the next move refines it).
        if (!activeGesture) host.style.cursor = "default";
        handled = true;
      }
      if (handled) event.preventDefault();
      return;
    }

    // Keyboard objects: Alt+← / Alt+→ walk them (before the nudge arrows:
    // Alt+arrow used to nudge too). Enter opens the selected one, like a
    // double-click; Shift+F10 / Menu opens its menu.
    if (
      event.altKey &&
      !cmd &&
      !event.shiftKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      focusAdjacentClip(event.key === "ArrowRight" ? 1 : -1);
      event.preventDefault();
      return;
    }

    if (event.key === "Enter" && !cmd && !event.altKey && !event.shiftKey) {
      const ids = core.getState().selection.clipIds;
      if (ids.length === 1) {
        host.dispatchEvent(
          new CustomEvent("playlist-clip-open", { detail: { clipId: ids[0] }, bubbles: true }),
        );
        event.preventDefault();
      }
      return;
    }

    if (
      event.key === "ContextMenu" ||
      (event.key === "F10" && event.shiftKey && !cmd && !event.altKey)
    ) {
      openMenuFromKeyboard();
      event.preventDefault();
      return;
    }

    if (cmd && key === "z") {
      if (event.shiftKey) {
        core.redo();
      } else {
        core.undo();
      }
      event.preventDefault();
      return;
    }

    if (cmd && key === "y") {
      core.redo();
      event.preventDefault();
      return;
    }

    if (cmd && !event.shiftKey && key === "a") {
      core.selectAllClips();
      event.preventDefault();
      return;
    }

    if (cmd && !event.shiftKey && key === "d") {
      core.deselectAll();
      event.preventDefault();
      return;
    }

    if (!cmd && event.shiftKey && (event.key === "I" || event.key === "i")) {
      core.invertClipSelection();
      event.preventDefault();
      return;
    }

    if (!cmd && event.altKey && key === "m") {
      core.setClipsMuted(core.getState().selection.clipIds, !event.shiftKey);
      event.preventDefault();
      return;
    }

    if (cmd && !event.shiftKey && key === "c") {
      core.copyToClipboard();
      event.preventDefault();
      return;
    }

    if (cmd && !event.shiftKey && key === "x") {
      core.cutSelection();
      event.preventDefault();
      return;
    }

    if (cmd && !event.shiftKey && key === "v") {
      core.pasteClipboard();
      event.preventDefault();
      return;
    }

    if (cmd && !event.shiftKey && key === "b") {
      core.duplicateSelectionRight();
      event.preventDefault();
      return;
    }

    // Shift+C: FL Studio select-all-similar (every clip with the same source).
    if (!cmd && event.shiftKey && key === "c") {
      const focused = core.getState().selection.clipIds[0];
      if (focused) {
        core.selectAllSimilarClips(focused);
      }
      event.preventDefault();
      return;
    }

    if (event.key === "Backspace") {
      // FL Studio: Backspace toggles global snap None ↔ last mode.
      core.toggleSnapNone();
      event.preventDefault();
      return;
    }

    if (event.key === "Delete") {
      const before = core.getState();
      const selected = before.selection.clipIds;
      const labelById = new Map<string, string>();
      if (onEdit && selected.length > 0) {
        for (const clip of before.clips) labelById.set(clip.id, clip.label);
      }
      core.removeSelected();
      if (onEdit && selected.length > 0) {
        const after = new Set(core.getState().clips.map((clip) => clip.id));
        const gone = selected.filter((id) => labelById.has(id) && !after.has(id));
        if (gone.length > 0) {
          onEdit({ kind: "delete", clipIds: gone, labels: gone.map((id) => labelById.get(id)!) });
        }
      }
      event.preventDefault();
      return;
    }

    // Space: hold to pan with the left button (the hand); a plain tap
    // plays / pauses on release.
    if (event.code === "Space") {
      if (!event.repeat && !spaceHeld) {
        spaceHeld = true;
        spacePanned = false;
        if (!activeGesture) host.style.cursor = "grab";
      }
      event.preventDefault();
      return;
    }

    // Navigation keys (all animated; reduced motion jumps).
    if (!cmd && !event.altKey) {
      const state = core.getState();
      const width = timelineWidthOf(state);
      const playX = state.playPosition.time * state.viewport.pxPerBeat - state.viewport.scrollX;
      const zoomAnchor =
        metrics.trackHeaderWidth + (playX >= 0 && playX <= width ? playX : width / 2);
      if (event.key === "PageDown" || event.key === "PageUp") {
        const dir = event.key === "PageDown" ? 1 : -1;
        if (event.shiftKey) navigator.scrollBy(0, dir * (state.viewport.height - getTracksTop(metrics)) * 0.85);
        else navigator.scrollBy(dir * width * 0.85, 0);
        event.preventDefault();
        return;
      }
      if (!event.shiftKey && (event.key === "+" || event.key === "=")) {
        navigator.zoomBy(1.6, zoomAnchor);
        event.preventDefault();
        return;
      }
      if (!event.shiftKey && (event.key === "-" || event.key === "_")) {
        navigator.zoomBy(1 / 1.6, zoomAnchor);
        event.preventDefault();
        return;
      }
      if (event.key === "+" && event.shiftKey) {
        navigator.zoomBy(1.6, zoomAnchor);
        event.preventDefault();
        return;
      }
      if (!event.shiftKey && event.key === "0") {
        const end = Math.max(core.getContentEndTime(), width / state.viewport.pxPerBeat);
        navigator.showRange(0, end * 1.02);
        event.preventDefault();
        return;
      }
    }

    // Insert: slice every visible clip at the playhead (FL). With the host
    // scope "target": the selection only; Shift+Insert = every clip.
    if (event.key === "Insert") {
      const state = core.getState();
      const time = state.playPosition.time;
      if (sliceTargeted && !event.shiftKey) {
        if (state.selection.clipIds.length > 0) commitSlice(time, state.selection.clipIds);
      } else {
        commitSlice(time, undefined);
      }
      event.preventDefault();
      return;
    }

    // F6: Ctrl+G groups the selected clips; Ctrl+Shift+G ungroups.
    if (cmd && !event.altKey && key === "g") {
      if (event.shiftKey) {
        core.ungroupSelection();
      } else {
        core.groupSelection();
      }
      event.preventDefault();
      return;
    }

    // FL Studio marker hotkeys.
    if (event.altKey && event.shiftKey && !cmd && key === "t") {
      core.addTimeSignatureMarker(core.getState().playPosition.time);
      event.preventDefault();
      return;
    }
    if (event.altKey && !event.shiftKey && !cmd && key === "t") {
      core.addMarker({ time: core.getState().playPosition.time });
      event.preventDefault();
      return;
    }
    // F13: FL binds the auto-named marker to Ctrl+T, but Chrome, Firefox and
    // Edge all reserve Ctrl+T for "new tab" and the page cannot cancel it —
    // the binding was unreachable in a browser. Ctrl+M is free in all three.
    // Declared divergence, see docs/fl-playlist-parity-spec.md.
    if (cmd && !event.shiftKey && !event.altKey && key === "m") {
      core.addAutoNamedMarker(core.getState().playPosition.time);
      event.preventDefault();
      return;
    }

    // F5: arrow keys nudge the selection (or the playhead when nothing is
    // selected). Modifier scaling matches FL Studio: Shift = ×4 step,
    // Ctrl/Meta = 1 bar.
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown"
    ) {
      const horizontal =
        event.key === "ArrowLeft" || event.key === "ArrowRight";
      const dir =
        event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      const hasSelection = core.getState().selection.clipIds.length > 0;
      // Host feedback: a burst of moves is one gesture with a tooltip.
      const nudgeWithFeedback = (deltaBeats: number, deltaTracks: number): void => {
        if (nudgeFeedbackMs <= 0) {
          core.nudgeSelection(deltaBeats, deltaTracks);
          return;
        }
        if (!nudge) {
          const state = core.getState();
          const ids = [...state.selection.clipIds];
          const primary = state.clips.find((clip) => clip.id === ids[0]);
          if (!primary) return;
          core.beginGesture();
          nudge = {
            primaryId: primary.id,
            clipIds: ids,
            labels: labelsOf(ids),
            fromStart: primary.start,
            fromTrack: trackIndexOfClip(primary.id),
            timer: null,
          };
        }
        const session = nudge;
        core.nudgeSelection(deltaBeats, deltaTracks);
        revealClip(session.primaryId);
        showNudgeTooltip();
        if (session.timer !== null) clearTimeout(session.timer);
        session.timer = setTimeout(closeNudge, nudgeFeedbackMs);
      };
      if (horizontal) {
        const step = cmd ? metrics.beatsPerBar : event.shiftKey ? 4 : 1;
        if (hasSelection) {
          nudgeWithFeedback(dir * step, 0);
        } else {
          core.nudgePlayPositionBy(dir * step);
          // Keep the playhead in sight as it walks.
          navigator.reveal(core.getState().playPosition.time, { align: "nearest", margin: 96 });
        }
      } else {
        // Vertical arrows only make sense with a selection.
        if (hasSelection) {
          nudgeWithFeedback(0, dir);
        }
      }
      event.preventDefault();
      return;
    }

    // FL Studio transport hotkeys.
    if (event.key === "Home" && !cmd && !event.altKey && !event.shiftKey) {
      core.setPlayPosition(0);
      navigator.scrollTo({ scrollX: 0 });
      event.preventDefault();
      return;
    }
    if (event.key === "End" && !cmd && !event.altKey && !event.shiftKey) {
      core.jumpToEnd();
      navigator.reveal(core.getState().playPosition.time, { align: "nearest", margin: 96 });
      event.preventDefault();
      return;
    }
    if (!cmd && !event.altKey && !event.shiftKey && key === "l") {
      core.toggleTransportMode();
      event.preventDefault();
      return;
    }
    if (!cmd && !event.altKey && !event.shiftKey && key === "r") {
      core.toggleTransportRecording();
      event.preventDefault();
      return;
    }

    // F7 eyedropper, rebound in F13: hover a clip and press I to paint the
    // current selection with its colour.
    //
    // It used to be Alt+click, then briefly Alt+Shift+click. Both were wrong:
    // any pointer-modifier binding here swallows an FL drag gesture whole
    // (Alt = move without snap, Shift = clone, Alt+Shift = clone without
    // snap), because the branch returned before the tool dispatch. Hover+key
    // collides with nothing and is stable in every browser.
    if (!cmd && !event.altKey && !event.shiftKey && key === "i") {
      const hover = core.getState().hover;
      if (hover && hover.kind === "clip") {
        pickColorFrom(core, hover.clipId);
        event.preventDefault();
      }
      return;
    }

    // Shift+M: toggle FL Studio's stretch mode (resize stretches content).
    if (
      !cmd &&
      event.shiftKey &&
      !event.altKey &&
      (event.key === "M" || event.key === "m")
    ) {
      core.toggleStretchMode();
      event.preventDefault();
      return;
    }

    // Tool hotkeys (P/B/D/T/S/C/E/Z) — only when no modifier is held.
    if (!cmd && !event.altKey && !event.shiftKey && event.key.length === 1) {
      const tool = TOOL_HOTKEYS[event.key.toUpperCase()];
      if (tool) {
        core.setTool(tool);
        event.preventDefault();
      }
    }
  };

  const preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  const handleKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== "Space" || !spaceHeld) return;
    spaceHeld = false;
    if (!spacePanned) {
      core.setPlayPositionRunning(!core.getState().playPosition.isRunning);
    }
    spacePanned = false;
    if (!activeGesture) host.style.cursor = "";
    event.preventDefault();
  };

  // A hover tooltip (date of the ruler / lane, info card, button hint) only
  // lives while the pointer is over the canvas: leaving it — e.g. onto a
  // menu or popover in a portal over the canvas, or a dialog's backdrop —
  // must not leave it painted (it lingered as an empty-looking box under
  // the blurred backdrop until the next move). The label of a keyboard
  // move in progress stays.
  const clearHoverTooltip = (): void => {
    const tooltip = core.getState().tooltip;
    if (!tooltip) return;
    if (nudge && tooltip.kind === "hint") return;
    core.clearTooltip();
  };

  const handleBlur = (): void => {
    spaceHeld = false;
    spacePanned = false;
    closeNudge();
    cancelHoverCard();
    if (!activeGesture) clearHoverTooltip();
  };

  const handlePointerLeave = (): void => {
    cancelHoverCard();
    core.setHoverTime(null);
    if (activeGesture) return;
    reportOverviewHover(null);
    clearHoverTooltip();
    core.setHover(null);
  };

  const handlePointerCancel = (event: PointerEvent): void => {
    touchTracker.handlePointerCancel(event);
    endGesture(event);
  };

  host.addEventListener("pointerdown", handlePointerDown);
  host.addEventListener("pointermove", handlePointerMove);
  host.addEventListener("pointerup", endGesture);
  host.addEventListener("pointercancel", handlePointerCancel);
  host.addEventListener("pointerleave", handlePointerLeave);
  host.addEventListener("wheel", handleWheel, { passive: false });
  host.addEventListener("keydown", handleKeyDown);
  host.addEventListener("keyup", handleKeyUp);
  host.addEventListener("blur", handleBlur);
  host.addEventListener("contextmenu", preventContextMenu);

  return {
    navigator,
    destroy() {
      activeGesture = null;
      closeNudge();
      cancelHoverCard();
      navigator.destroy();
      host.style.cursor = "";
      touchTracker.destroy();
      host.removeEventListener("pointerdown", handlePointerDown);
      host.removeEventListener("pointermove", handlePointerMove);
      host.removeEventListener("pointerup", endGesture);
      host.removeEventListener("pointercancel", handlePointerCancel);
      host.removeEventListener("pointerleave", handlePointerLeave);
      host.removeEventListener("wheel", handleWheel);
      host.removeEventListener("keydown", handleKeyDown);
      host.removeEventListener("keyup", handleKeyUp);
      host.removeEventListener("blur", handleBlur);
      host.removeEventListener("contextmenu", preventContextMenu);
    },
  };
}
