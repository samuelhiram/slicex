import {
  automationPointFromScreen,
  clamp,
  getHorizontalScrollableRange,
  getHorizontalScrollbarRect,
  getHorizontalScrollbarThumbRect,
  getTrackHeightByIndex,
  getHorizontalContentExtent,
  getTrackIdByIndex,
  getTracksTop,
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
import type { ActiveGesture } from "./gesture-types";
import {
  createViewportNavigator,
  createWheelClassifier,
  wheelDeltaScale,
  type ViewportNavigator,
} from "./navigator";
import { hitTestPlaylist, type PlaylistHit } from "./hit-test";
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
    host.style.cursor = getTool(toolId).cursor;
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

  host.style.cursor = getTool(toolId).cursor;
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

  if (hit.kind === "track-header") {
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
  const extendMinBeatsPerPx = Math.max(0, options.clipExtendMinBeatsPerPx ?? 0);
  const hitOptions = {
    clipLevel: onClipLevelDrag !== undefined,
    clipExtend: options.clipExtend,
  };
  // The right button ignores the thin track chrome (divisor, row buttons):
  // a press on a row line still opens the menu of what is under it.
  const menuHitOptions = { ...hitOptions, trackChrome: false };
  const hitAt = (point: PlaylistPoint, opts = hitOptions): PlaylistHit =>
    hitTestPlaylist(core.getPresentation(), point, metrics, opts);
  // Viewport motion (smooth wheel, zoom, momentum, edge auto-scroll).
  const navigator = createViewportNavigator(core, {
    reducedMotion: () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
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

    const state = core.getState();
    const point = resolvePoint(host, event);
    const rawHit = hitAt(point, event.button === 2 ? menuHitOptions : hitOptions);
    const clickCount = pressClickCount(event, point);
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
      setCursor(host, hit, activeGesture, state.tool);
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
        core.deleteClips([hit.clip.id]);
        activeGesture = {
          kind: "delete-drag",
          pointerId: event.pointerId,
          lastPoint: { ...point },
          deletedClipIds,
          skipAutomation: true,
        };
        host.setPointerCapture?.(event.pointerId);
        setCursor(host, hit, activeGesture, state.tool);
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
        setCursor(host, hit, activeGesture, state.tool);
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
      setCursor(host, hit, activeGesture, state.tool);
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
      setCursor(host, hit, activeGesture, state.tool);
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
      const startHeight = getTrackHeightByIndex(state, hit.trackIndex, metrics);
      activeGesture = {
        kind: "track-resize",
        pointerId: event.pointerId,
        trackIndex: hit.trackIndex,
        startY: point.y,
        startHeight,
      };
      core.beginGesture();
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool);
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
      setCursor(host, hit, activeGesture, state.tool);
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
        setCursor(host, hit, activeGesture, state.tool);
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
      };
      core.setClipSelection([hit.clipId]);
      core.beginGesture();
      const text = onClipLevelDrag({ clipId: hit.clipId, phase: "start", deltaY: 0 });
      if (text) core.setTooltip({ kind: "time", text, anchor: point });
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool);
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
      setCursor(host, hit, activeGesture, state.tool);
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
      setCursor(host, hit, activeGesture, state.tool);
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
      });
    } finally {
      if (!gesture || !gestureMutatesDoc(gesture)) {
        core.endGesture();
      }
    }
    if (gesture) {
      activeGesture = gesture;
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool);
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
      const bottom = state.viewport.height - metrics.scrollbarSize;
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
      if (onOverviewHover) {
        const inLane =
          hit.kind === "ruler" &&
          point.y > metrics.rulerHeight &&
          point.y <= getTracksTop(metrics);
        reportOverviewHover(
          inLane ? Math.max(0, Math.floor(screenXToTime(state, point.x, metrics))) : null,
        );
      }
      // F3: hover on the ruler emits a B.B.T tooltip; everywhere else the
      // tooltip is cleared. setTooltip short-circuits when the value
      // doesn't change, so calling clearTooltip every pointermove is free
      // when no tooltip was active.
      if (hit.kind === "ruler" || hit.kind === "play-position-marker") {
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
      } else {
        core.clearTooltip();
      }
      setCursor(host, hit, null, state.tool);
      return;
    }

    if (activeGesture.pointerId !== event.pointerId) {
      return;
    }

    const gesture = activeGesture;

    if (gesture.kind === "clip-level") {
      const text = onClipLevelDrag?.({
        clipId: gesture.clipId,
        phase: "move",
        deltaY: gesture.startY - point.y,
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
      const allMoves = gesture.originals.map((clip) => ({
        id: clip.id,
        start: clip.start + deltaTime,
        trackIndex: clamp(clip.trackIndex + trackDelta, 0, maxTrack),
      }));

      core.moveClips(allMoves);
      emitDragOverlays(core, state, point, event.altKey, {
        kind: "clip-move",
        primaryClipId: gesture.primaryClipId,
        previewTrackIndex: clamp(
          gesture.startTrackIndex + trackDelta,
          0,
          maxTrack,
        ),
        previewStart: primaryStart,
        allMoves,
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
      core.setTooltip({
        kind: "time",
        text: core.formatTime(snapped),
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
        core.deleteClips(ids);
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
      core.setTrackHeight(gesture.trackIndex, gesture.startHeight + dy);
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

    if (activeGesture.kind === "clip-level") {
      const point = resolvePoint(host, event);
      onClipLevelDrag?.({
        clipId: activeGesture.clipId,
        phase: "end",
        deltaY: activeGesture.startY - point.y,
      });
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
        core.sliceClipsAtTime(time);
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

    activeGesture = null;
    host.releasePointerCapture?.(event.pointerId);
    setCursor(host, hitAt(resolvePoint(host, event)), null, core.getState().tool);
  };

  // Pointer wheel / trackpad.
  //   - Pinch (trackpad) or Ctrl/Cmd/Alt + wheel: zoom at the pointer —
  //     proportional and immediate for a trackpad, smooth steps for a
  //     notched wheel.
  //   - Trackpad two-finger swipe: free 2-D pan, 1:1 with the fingers;
  //     with no tracks to scroll, vertical swipes move time too.
  //   - Mouse wheel: TIME (the main axis of an infinite timeline), smooth
  //     and accelerating (notches accumulate on the glide target). Shift +
  //     wheel, or the wheel over the track headers, scrolls the tracks.
  //     A tilt wheel (deltaX) moves time.
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
    if ((event.shiftKey || overHeaders) && room && dx === 0) {
      navigator.scrollBy(0, notch);
      return;
    }
    // One notch (100 units) ≈ 15% of the timeline width, at least 90 px.
    const step = Math.max(90, width * 0.15) / 100;
    navigator.scrollBy(notch * step, 0);
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    const cmd = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

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
      core.removeSelected();
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

    // Insert: slice every visible clip at the playhead.
    if (event.key === "Insert") {
      core.sliceClipsAtTime(core.getState().playPosition.time);
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
      if (horizontal) {
        const step = cmd ? metrics.beatsPerBar : event.shiftKey ? 4 : 1;
        if (hasSelection) {
          core.nudgeSelection(dir * step, 0);
        } else {
          core.nudgePlayPositionBy(dir * step);
          // Keep the playhead in sight as it walks.
          navigator.reveal(core.getState().playPosition.time, { align: "nearest", margin: 96 });
        }
      } else {
        // Vertical arrows only make sense with a selection.
        if (hasSelection) {
          core.nudgeSelection(0, dir);
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

  const handleBlur = (): void => {
    spaceHeld = false;
    spacePanned = false;
  };

  const handlePointerLeave = (): void => {
    if (!activeGesture) reportOverviewHover(null);
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
