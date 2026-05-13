// F8 — Touch refinement.
//
// Pulls the three touch-specific concerns out of the controller: pinch
// zoom, long-press → context menu, and momentum scroll. The controller
// invokes the tracker at the same lifecycle points it has for mouse
// (pointerdown / pointermove / pointerup / pointercancel) but only when
// `event.pointerType === "touch"`. Each handler returns `true` to mean
// "consumed — abort the controller's normal handling for this event".
//
// Patterns:
//   - Pinch zoom uses the same math as Ctrl+wheel: pxPerBeat scales,
//     scrollX is recomputed so the cursor's anchorTime stays put. The
//     dispatch goes through `core.updateViewport` which already has the
//     §4 canon idempotency short-circuit.
//   - Long-press starts a setTimeout on touch-down; it cancels if the
//     finger moves more than the LONG_PRESS_MAX_MOVE_PX threshold or
//     lifts before LONG_PRESS_MS. On fire, it opens the matching
//     contextmenu via hitTestPlaylist.
//   - Inertia samples 60ms of velocity into a ring buffer; when the
//     last touch lifts AND the active gesture was pan/scrollbar, it
//     starts a rAF tick that decays the scroll delta by 0.95 per frame
//     until it falls below SETTLE_EPSILON. Any new pointerdown cancels.
//
// Canon §3.11: the inertia rAF is started/stopped on demand. No idle
// tick runs when there's nothing to decay.
import {
  screenXToTime,
  type PlaylistCore,
  type PlaylistMetrics,
  type PlaylistPoint,
} from "../playlist-core";
import { hitTestPlaylist, type PlaylistHit } from "./hit-test";

export interface TouchTrackerHost {
  getBoundingClientRect: () => { left: number; top: number };
}

export interface TouchTracker {
  handlePointerDown(event: PointerEvent, point: PlaylistPoint, hit: PlaylistHit | null): boolean;
  handlePointerMove(event: PointerEvent, point: PlaylistPoint): boolean;
  handlePointerUp(event: PointerEvent, gestureWasPanLike: boolean): boolean;
  handlePointerCancel(event: PointerEvent): void;
  /**
   * Called by the controller when any pointerdown arrives (mouse or
   * touch). Any active inertia tick is cancelled — a new gesture always
   * wins over decaying motion. Returns false (not "consumed") so the
   * controller proceeds with normal handling.
   */
  cancelInertia(): void;
  destroy(): void;
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_MAX_MOVE_PX = 6;
const VELOCITY_WINDOW_MS = 60;
const INERTIA_DECAY = 0.95;
const SETTLE_EPSILON = 0.02;

interface ActiveTouch {
  point: PlaylistPoint;
  // High-resolution timestamp used for both long-press and velocity.
  downAt: number;
}

interface PinchState {
  startDist: number;
  startPxPerBeat: number;
  anchorTime: number;
}

interface VelocitySample {
  vx: number;
  vy: number;
  t: number;
}

function distance(a: PlaylistPoint, b: PlaylistPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function midpoint(a: PlaylistPoint, b: PlaylistPoint): PlaylistPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function createTouchTracker(
  host: TouchTrackerHost,
  core: PlaylistCore,
  metrics: PlaylistMetrics,
  getPresentation: () => ReturnType<PlaylistCore["getPresentation"]>,
): TouchTracker {
  const activeTouches = new Map<number, ActiveTouch>();
  let pinch: PinchState | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressOrigin: PlaylistPoint | null = null;
  let longPressPointerId: number | null = null;
  // Velocity ring buffer. Captures last ~60ms of (dx, dy) between
  // pointermoves. Drained when the last touch lifts.
  let lastMovePoint: PlaylistPoint | null = null;
  let lastMoveTime = 0;
  const velocitySamples: VelocitySample[] = [];
  let inertiaFrameId = 0;
  let inertiaVx = 0;
  let inertiaVy = 0;

  function clearLongPress(): void {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressOrigin = null;
    longPressPointerId = null;
  }

  function fireLongPress(point: PlaylistPoint): void {
    const presentation = getPresentation();
    const hit = hitTestPlaylist(presentation, point, metrics);
    const state = core.getState();
    // Route to the matching context-menu opener so the React shell renders
    // the right menu (track / clip / marker / background).
    if (hit.kind === "clip" || hit.kind === "automation-body") {
      core.openClipContextMenu(hit.clip.id, point);
      return;
    }
    if (hit.kind === "track-header") {
      core.openTrackContextMenu(hit.trackIndex, point);
      return;
    }
    if (hit.kind === "marker") {
      core.openMarkerContextMenu(hit.markerId, point);
      return;
    }
    if (hit.kind === "empty") {
      const time = Math.max(0, screenXToTime(state, point.x, metrics));
      // We don't have a screenYToTrackIndex import here; the presentation
      // exposes it as a closure for exactly this case.
      const trackIndex = presentation.screenYToTrackIndex(point.y);
      core.openBackgroundContextMenu(time, trackIndex, point);
    }
  }

  function applyPinch(p1: PlaylistPoint, p2: PlaylistPoint): void {
    if (!pinch) return;
    const dist = Math.max(1, distance(p1, p2));
    const factor = dist / pinch.startDist;
    const pxPerBeat = Math.max(
      metrics.minPxPerBeat,
      Math.min(metrics.maxPxPerBeat, pinch.startPxPerBeat * factor),
    );
    const mid = midpoint(p1, p2);
    const timelineX = mid.x - metrics.trackHeaderWidth;
    const scrollX = pinch.anchorTime * pxPerBeat - timelineX;
    core.updateViewport({ pxPerBeat, scrollX });
  }

  function recordVelocity(point: PlaylistPoint, now: number): void {
    if (lastMovePoint !== null) {
      const dt = now - lastMoveTime;
      if (dt > 0) {
        velocitySamples.push({
          vx: (point.x - lastMovePoint.x) / dt,
          vy: (point.y - lastMovePoint.y) / dt,
          t: now,
        });
        // Drop stale samples (>60ms).
        while (
          velocitySamples.length > 0 &&
          now - velocitySamples[0]!.t > VELOCITY_WINDOW_MS
        ) {
          velocitySamples.shift();
        }
      }
    }
    lastMovePoint = point;
    lastMoveTime = now;
  }

  function stopInertia(): void {
    if (inertiaFrameId !== 0 && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(inertiaFrameId);
    }
    inertiaFrameId = 0;
    inertiaVx = 0;
    inertiaVy = 0;
  }

  function inertiaTick(now: number): void {
    if (Math.abs(inertiaVx) + Math.abs(inertiaVy) < SETTLE_EPSILON) {
      stopInertia();
      return;
    }
    const state = core.getState();
    // Convert pixels-per-ms → pixels-per-frame at ~16.67ms.
    const dt = 16.67;
    core.updateViewport({
      scrollX: Math.max(0, state.viewport.scrollX - inertiaVx * dt),
      scrollY: Math.max(0, state.viewport.scrollY - inertiaVy * dt),
    });
    inertiaVx *= INERTIA_DECAY;
    inertiaVy *= INERTIA_DECAY;
    inertiaFrameId = requestAnimationFrame(inertiaTick);
    void now;
  }

  function startInertia(): void {
    if (velocitySamples.length === 0) return;
    // Average velocity across the window — gives a smoother release than
    // the very last sample, which can be noisy on near-zero-motion flicks.
    let vx = 0;
    let vy = 0;
    for (const s of velocitySamples) {
      vx += s.vx;
      vy += s.vy;
    }
    vx /= velocitySamples.length;
    vy /= velocitySamples.length;
    if (Math.abs(vx) + Math.abs(vy) < SETTLE_EPSILON) return;
    inertiaVx = vx;
    inertiaVy = vy;
    if (typeof requestAnimationFrame === "undefined") return;
    inertiaFrameId = requestAnimationFrame(inertiaTick);
  }

  return {
    handlePointerDown(event, point, hit) {
      stopInertia();
      if (event.pointerType !== "touch") return false;
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      activeTouches.set(event.pointerId, { point: { ...point }, downAt: now });
      lastMovePoint = { ...point };
      lastMoveTime = now;
      velocitySamples.length = 0;

      // Two-finger pinch: start zoom + cancel any single-touch long-press.
      if (activeTouches.size === 2) {
        clearLongPress();
        const points = Array.from(activeTouches.values()).map((t) => t.point);
        const state = core.getState();
        const mid = midpoint(points[0]!, points[1]!);
        pinch = {
          startDist: Math.max(1, distance(points[0]!, points[1]!)),
          startPxPerBeat: state.viewport.pxPerBeat,
          anchorTime: screenXToTime(state, mid.x, metrics),
        };
        return true; // consumed — controller skips its normal handling.
      }

      // First touch: arm long-press timer.
      if (activeTouches.size === 1) {
        longPressOrigin = { ...point };
        longPressPointerId = event.pointerId;
        if (typeof setTimeout !== "undefined") {
          longPressTimer = setTimeout(() => {
            longPressTimer = null;
            if (longPressOrigin) fireLongPress(longPressOrigin);
          }, LONG_PRESS_MS);
        }
        // Don't consume — let the controller start its normal gesture
        // (pan, drag, etc.). Long-press fires asynchronously alongside.
        void hit;
      }
      return false;
    },

    handlePointerMove(event, point) {
      if (event.pointerType !== "touch") return false;
      const existing = activeTouches.get(event.pointerId);
      if (!existing) return false;
      existing.point = { ...point };

      // Long-press cancel by movement.
      if (
        longPressPointerId === event.pointerId &&
        longPressOrigin !== null &&
        distance(point, longPressOrigin) > LONG_PRESS_MAX_MOVE_PX
      ) {
        clearLongPress();
      }

      // Two-finger pinch update.
      if (pinch && activeTouches.size === 2) {
        const points = Array.from(activeTouches.values()).map((t) => t.point);
        applyPinch(points[0]!, points[1]!);
        return true;
      }

      // Single-touch velocity sampling for later inertia release.
      if (activeTouches.size === 1) {
        const now =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        recordVelocity(point, now);
      }
      return false;
    },

    handlePointerUp(event, gestureWasPanLike) {
      if (event.pointerType !== "touch") return false;
      activeTouches.delete(event.pointerId);
      clearLongPress();
      if (activeTouches.size < 2 && pinch) {
        pinch = null;
        // Consume the up so the controller doesn't end a "phantom"
        // gesture that never began under it.
        return true;
      }
      if (activeTouches.size === 0 && gestureWasPanLike) {
        startInertia();
      }
      return false;
    },

    handlePointerCancel(event) {
      activeTouches.delete(event.pointerId);
      clearLongPress();
      if (activeTouches.size < 2) pinch = null;
      stopInertia();
    },

    cancelInertia() {
      stopInertia();
    },

    destroy() {
      activeTouches.clear();
      clearLongPress();
      stopInertia();
      pinch = null;
    },
  };
}
