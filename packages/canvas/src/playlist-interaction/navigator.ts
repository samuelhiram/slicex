// Viewport motion engine: smooth scroll / zoom, momentum and edge
// auto-scroll for an infinite timeline.
//
// Three exclusive motion modes, each driven by a rAF loop that runs ONLY
// while something moves (canon §3.5 / §3.11 — no idle tick):
//   - "target": exponential approach to a target (scrollX, scrollY,
//     pxPerBeat). Successive calls RETARGET (wheel notches accumulate on
//     the target, not on the current position, so fast scrolling speeds up
//     instead of stuttering). A zoom keeps one time fixed under one screen
//     x (the anchor) on every frame.
//   - "fling": momentum after a drag release (velocity decays like a
//     touch screen).
//   - "edge": continuous auto-scroll while a drag sits near an edge; after
//     every step the caller re-applies the drag at the last pointer.
// Every frame is ONE core.updateViewport (idempotent; the renderer
// coalesces). Without requestAnimationFrame (tests, SSR) or with reduced
// motion, targets apply at once and momentum is skipped.
import type { PlaylistCore } from "../playlist-core";

// The user asked the system for less motion. Shared by the controller's
// navigator and hosts that animate on their own (e.g. a morphing curve).
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface NavigatorScheduler {
  request: (callback: (time: number) => void) => number;
  cancel: (id: number) => void;
}

export interface ViewportNavigatorOptions {
  // Frame scheduler (tests inject a manual one). Defaults to rAF.
  scheduler?: NavigatorScheduler | null;
  // true → no animation (prefers-reduced-motion). Read on every call.
  reducedMotion?: () => boolean;
}

export interface ViewportNavigator {
  /** Smooth scroll by a delta (px). Accumulates on an animation in flight. */
  scrollBy(dx: number, dy: number): void;
  /** Smooth scroll to absolute scroll offsets (px). */
  scrollTo(target: { scrollX?: number; scrollY?: number }): void;
  /** Smooth zoom by `factor`, keeping the time under `screenX` fixed. */
  zoomBy(factor: number, screenX: number): void;
  /** Smooth zoom to `pxPerBeat`, keeping the time under `screenX` fixed. */
  zoomTo(pxPerBeat: number, screenX: number): void;
  /** Fit [fromBeat, toBeat] in the timeline width (animated). */
  showRange(fromBeat: number, toBeat: number): void;
  /**
   * Bring `beat` into view. "nearest" scrolls only when it is outside the
   * view (keeping `margin` px), "start" puts it `margin` px from the left,
   * "center" centres it.
   */
  reveal(beat: number, options?: { align?: "nearest" | "start" | "center"; margin?: number }): void;
  /** Momentum after a drag (px/s of CONTENT motion: scroll decreases for vx > 0). */
  fling(vx: number, vy: number): void;
  /**
   * Continuous auto-scroll (px/s of scroll); 0, 0 stops. `onStep` runs after
   * every applied step (re-apply the drag at the last pointer).
   */
  setEdgeScroll(vx: number, vy: number, onStep?: () => void): void;
  /** Stop any motion where it is. */
  stop(): void;
  isMoving(): boolean;
  destroy(): void;
}

// Time constants (s). Pan feels immediate but smooth; zoom a touch slower.
const PAN_TAU = 0.085;
const ZOOM_TAU = 0.1;
// Momentum decay (s), iOS-like.
const FLING_TAU = 0.325;
const FLING_MIN_SPEED = 20; // px/s
const SETTLE_PX = 0.5;
const SETTLE_LOG_ZOOM = 0.0015;
// A frame longer than this (tab in background) counts as this long.
const MAX_DT = 0.05;

type Mode = "idle" | "target" | "fling" | "edge";

function defaultScheduler(): NavigatorScheduler | null {
  if (typeof requestAnimationFrame === "undefined") return null;
  return {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (id) => cancelAnimationFrame(id),
  };
}

export function createViewportNavigator(
  core: PlaylistCore,
  options: ViewportNavigatorOptions = {},
): ViewportNavigator {
  const metrics = core.metrics;
  const scheduler =
    options.scheduler === undefined ? defaultScheduler() : options.scheduler;
  const reducedMotion = options.reducedMotion ?? (() => false);

  let mode: Mode = "idle";
  let frameId = 0;
  let lastTime = -1;
  let destroyed = false;

  // Target mode.
  let targetX = 0;
  let targetY = 0;
  let targetPx = 0;
  // Zoom anchor: this time stays under this timeline x (px from the
  // timeline's left edge). anchorActive false = plain pan.
  let anchorActive = false;
  let anchorBeat = 0;
  let anchorTimelineX = 0;
  // Range mode (showRange): the time at the left edge glides to rangeBeat
  // while the zoom glides to targetPx — pan and zoom in one motion.
  let rangeActive = false;
  let rangeBeat = 0;

  // Fling / edge mode.
  let vx = 0;
  let vy = 0;
  let edgeStep: (() => void) | null = null;

  const timelineWidth = (): number =>
    Math.max(1, core.getState().viewport.width - metrics.trackHeaderWidth - metrics.scrollbarSize);

  const clampPx = (px: number): number =>
    Math.min(metrics.maxPxPerBeat, Math.max(metrics.minPxPerBeat, px));

  const animate = (): boolean => scheduler !== null && !reducedMotion();

  function schedule(): void {
    if (frameId !== 0 || destroyed || scheduler === null) return;
    frameId = scheduler.request(tick);
  }

  function cancelFrame(): void {
    if (frameId !== 0 && scheduler) scheduler.cancel(frameId);
    frameId = 0;
    lastTime = -1;
  }

  function stop(): void {
    cancelFrame();
    mode = "idle";
    anchorActive = false;
    rangeActive = false;
    vx = 0;
    vy = 0;
    edgeStep = null;
  }

  // Seed the target from where the view is now (or keep the one in flight).
  function ensureTarget(): void {
    if (mode === "target") return;
    const viewport = core.getState().viewport;
    cancelFrame();
    mode = "target";
    targetX = viewport.scrollX;
    targetY = viewport.scrollY;
    targetPx = viewport.pxPerBeat;
    anchorActive = false;
    rangeActive = false;
  }

  // Leave anchor / range mode for a plain pan, keeping their scroll goal.
  function toPlainPan(): void {
    const px = clampPx(targetPx);
    if (anchorActive) targetX = targetScrollXForAnchor(px);
    else if (rangeActive) targetX = Math.max(0, rangeBeat * px);
    anchorActive = false;
    rangeActive = false;
  }

  function targetScrollXForAnchor(px: number): number {
    return Math.max(0, anchorBeat * px - anchorTimelineX);
  }

  function applyTargetNow(): void {
    const px = clampPx(targetPx);
    core.updateViewport({
      pxPerBeat: px,
      scrollX: anchorActive
        ? targetScrollXForAnchor(px)
        : rangeActive
          ? Math.max(0, rangeBeat * px)
          : Math.max(0, targetX),
      scrollY: Math.max(0, targetY),
    });
    mode = "idle";
    anchorActive = false;
    rangeActive = false;
  }

  function startTarget(): void {
    if (!animate()) {
      applyTargetNow();
      return;
    }
    schedule();
  }

  function tick(time: number): void {
    frameId = 0;
    if (destroyed || mode === "idle") return;
    const dt = lastTime < 0 ? 1 / 60 : Math.min(MAX_DT, Math.max(0, (time - lastTime) / 1000));
    lastTime = time;
    const viewport = core.getState().viewport;

    if (mode === "target") {
      const kPan = 1 - Math.exp(-dt / PAN_TAU);
      const kZoom = 1 - Math.exp(-dt / ZOOM_TAU);
      const goalPx = clampPx(targetPx);
      const logNow = Math.log(viewport.pxPerBeat);
      const logGoal = Math.log(goalPx);
      const zoomDone = Math.abs(logGoal - logNow) < SETTLE_LOG_ZOOM;
      const px = zoomDone ? goalPx : Math.exp(logNow + (logGoal - logNow) * kZoom);
      const goalX = anchorActive
        ? targetScrollXForAnchor(goalPx)
        : rangeActive
          ? Math.max(0, rangeBeat * goalPx)
          : Math.max(0, targetX);
      const goalY = Math.max(0, targetY);
      let scrollX: number;
      if (anchorActive) {
        scrollX = targetScrollXForAnchor(px);
      } else if (rangeActive) {
        const beatNow = viewport.scrollX / viewport.pxPerBeat;
        const beat = beatNow + (Math.max(0, rangeBeat) - beatNow) * kPan;
        scrollX = Math.abs(rangeBeat - beat) * px < SETTLE_PX ? Math.max(0, rangeBeat * px) : beat * px;
      } else {
        scrollX = viewport.scrollX + (goalX - viewport.scrollX) * kPan;
      }
      let scrollY = viewport.scrollY + (goalY - viewport.scrollY) * kPan;
      const xDone = Math.abs(goalX - scrollX) < SETTLE_PX;
      const yDone = Math.abs(goalY - scrollY) < SETTLE_PX;
      if (xDone) scrollX = goalX;
      if (yDone) scrollY = goalY;
      core.updateViewport({ pxPerBeat: px, scrollX, scrollY });
      // The core clamps (e.g. scrollY past the last track): settle on what
      // it accepted instead of chasing an unreachable target.
      const after = core.getState().viewport;
      const blockedY = !yDone && Math.abs(after.scrollY - scrollY) > SETTLE_PX;
      if (blockedY) targetY = after.scrollY;
      if (zoomDone && xDone && (yDone || blockedY)) {
        mode = "idle";
        anchorActive = false;
        rangeActive = false;
        lastTime = -1;
        return;
      }
      schedule();
      return;
    }

    if (mode === "fling") {
      const decay = Math.exp(-dt / FLING_TAU);
      const nextX = Math.max(0, viewport.scrollX - vx * dt);
      const nextY = Math.max(0, viewport.scrollY - vy * dt);
      core.updateViewport({ scrollX: nextX, scrollY: nextY });
      const after = core.getState().viewport;
      // Hitting a bound kills that axis' momentum.
      if (Math.abs(after.scrollX - nextX) > SETTLE_PX || after.scrollX <= 0) vx = 0;
      if (Math.abs(after.scrollY - nextY) > SETTLE_PX || after.scrollY <= 0) vy = 0;
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) < FLING_MIN_SPEED) {
        mode = "idle";
        lastTime = -1;
        return;
      }
      schedule();
      return;
    }

    if (mode === "edge") {
      if (vx === 0 && vy === 0) {
        mode = "idle";
        lastTime = -1;
        return;
      }
      core.updateViewport({
        scrollX: Math.max(0, viewport.scrollX + vx * dt),
        scrollY: Math.max(0, viewport.scrollY + vy * dt),
      });
      edgeStep?.();
      schedule();
    }
  }

  function scrollTo(target: { scrollX?: number; scrollY?: number }): void {
    ensureTarget();
    toPlainPan();
    if (target.scrollX !== undefined) targetX = Math.max(0, target.scrollX);
    if (target.scrollY !== undefined) targetY = Math.max(0, target.scrollY);
    startTarget();
  }

  function zoomTo(pxPerBeat: number, screenX: number): void {
    ensureTarget();
    const viewport = core.getState().viewport;
    const timelineX = Math.min(
      timelineWidth(),
      Math.max(0, screenX - metrics.trackHeaderWidth),
    );
    // The time under the pointer NOW (current, not target, geometry).
    anchorBeat = (viewport.scrollX + timelineX) / viewport.pxPerBeat;
    anchorTimelineX = timelineX;
    anchorActive = true;
    rangeActive = false;
    targetPx = clampPx(pxPerBeat);
    startTarget();
  }

  return {
    scrollBy(dx, dy) {
      ensureTarget();
      // Panning during a zoom / range move: freeze its scroll goal, then pan.
      toPlainPan();
      targetX = Math.max(0, targetX + dx);
      targetY = Math.max(0, targetY + dy);
      startTarget();
    },

    scrollTo,

    zoomBy(factor, screenX) {
      if (!(factor > 0)) return;
      ensureTarget();
      zoomTo(targetPx * factor, screenX);
    },

    zoomTo,

    showRange(fromBeat, toBeat) {
      const span = Math.max(1e-6, toBeat - fromBeat);
      ensureTarget();
      anchorActive = false;
      targetPx = clampPx(timelineWidth() / span);
      rangeBeat = Math.max(0, fromBeat);
      rangeActive = true;
      startTarget();
    },

    reveal(beat, revealOptions = {}) {
      const align = revealOptions.align ?? "nearest";
      const margin = revealOptions.margin ?? 64;
      const viewport = core.getState().viewport;
      const width = timelineWidth();
      const px = mode === "target" ? clampPx(targetPx) : viewport.pxPerBeat;
      const x = beat * px;
      const from =
        mode !== "target"
          ? viewport.scrollX
          : anchorActive
            ? targetScrollXForAnchor(px)
            : rangeActive
              ? rangeBeat * px
              : targetX;
      let next = from;
      if (align === "start") next = x - margin;
      else if (align === "center") next = x - width / 2;
      else if (x < from + margin) next = x - margin;
      else if (x > from + width - margin) next = x - width + margin;
      if (Math.abs(next - from) < SETTLE_PX && mode !== "target") return;
      scrollTo({ scrollX: Math.max(0, next) });
    },

    fling(flingVx, flingVy) {
      if (!animate() || Math.hypot(flingVx, flingVy) < FLING_MIN_SPEED * 4) return;
      cancelFrame();
      mode = "fling";
      anchorActive = false;
      rangeActive = false;
      vx = flingVx;
      vy = flingVy;
      schedule();
    },

    setEdgeScroll(edgeVx, edgeVy, onStep) {
      if (edgeVx === 0 && edgeVy === 0) {
        if (mode === "edge") stop();
        return;
      }
      if (scheduler === null) return;
      if (mode !== "edge") {
        cancelFrame();
        mode = "edge";
        anchorActive = false;
        rangeActive = false;
      }
      vx = edgeVx;
      vy = edgeVy;
      edgeStep = onStep ?? null;
      schedule();
    },

    stop,

    isMoving() {
      return mode !== "idle";
    },

    destroy() {
      stop();
      destroyed = true;
    },
  };
}

// --- Wheel input classification ------------------------------------------------

export type WheelDevice = "trackpad" | "mouse";

/**
 * Tells a precision trackpad (pixel deltas, small / fractional, often both
 * axes; pinch = ctrlKey) from a notched mouse wheel (line / page deltas or
 * big integer steps). Stateful: a trackpad stream keeps its classification
 * for a short burst so one large delta inside a fast swipe isn't
 * mistaken for a wheel notch.
 */
export function createWheelClassifier(): (event: {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  timeStamp: number;
}) => WheelDevice {
  let last: WheelDevice = "mouse";
  let lastTime = Number.NEGATIVE_INFINITY;
  return (event) => {
    let device: WheelDevice;
    if (event.deltaMode !== 0) {
      device = "mouse";
    } else {
      const ay = Math.abs(event.deltaY);
      const ax = Math.abs(event.deltaX);
      const fractional = !Number.isInteger(event.deltaY) || !Number.isInteger(event.deltaX);
      if (fractional || (ax > 0 && ay > 0) || (ax > 0 && ax < 50) || (ay > 0 && ay < 40)) {
        device = "trackpad";
      } else if (last === "trackpad" && event.timeStamp - lastTime < 120) {
        device = "trackpad";
      } else {
        device = "mouse";
      }
    }
    last = device;
    lastTime = event.timeStamp;
    return device;
  };
}

/** Pixels per wheel unit for the event's deltaMode (lines / pages). */
export function wheelDeltaScale(deltaMode: number, pageSize: number): number {
  if (deltaMode === 1) return 40;
  if (deltaMode === 2) return pageSize;
  return 1;
}
