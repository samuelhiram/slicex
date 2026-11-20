// The table's corner control: a pad above the line names. Press it and drag
// — the pointer hides (pointer lock) — and the table follows the hand:
//   up / down     every event line taller / shorter (all together);
//   left / right  the timeline zooms out / in (the left edge stays put).
// Arrow keys do the same in steps. One drag = one undo step (the rows'
// heights; the zoom is a view). It reads the visible span and the lines'
// height. The height is the plan's (its saved layout: rowHeight).
import * as React from "react";
import type { PlaylistCore } from "@slicex/canvas";
import { describeSpanDays, useVisibleDays } from "./NavControls";

// How far the hand goes for an effect: zoom ×e every ~170 px; 1 px of
// height per 2.5 px; keys: ×1.25 zoom, 8 px of height.
const ZOOM_PER_PX = 0.006;
const HEIGHT_PER_PX = 0.4;
const KEY_ZOOM = 1.25;
const KEY_HEIGHT = 8;

/**
 * Zoom to `pxPerBeat` (clamped to the metrics), keeping the day at the
 * timeline's left edge where it is.
 */
export function zoomKeepingLeft(core: PlaylistCore, pxPerBeat: number): void {
  const { viewport } = core.getState();
  const px = Math.min(core.metrics.maxPxPerBeat, Math.max(core.metrics.minPxPerBeat, pxPerBeat));
  if (!(px > 0) || px === viewport.pxPerBeat) return;
  const leftBeat = viewport.scrollX / viewport.pxPerBeat;
  core.updateViewport({ pxPerBeat: px, scrollX: leftBeat * px });
}

/** The lines' height (the default; the pad keeps every row on it). */
function useRowHeight(core: PlaylistCore): number {
  const [height, setHeight] = React.useState(core.metrics.trackHeight);
  React.useEffect(() => {
    const sync = () => setHeight(core.metrics.trackHeight);
    sync();
    const sub = core.subscribe(sync);
    return () => sub.unsubscribe();
  }, [core]);
  return height;
}

interface Drag {
  pointerId: number;
  basePx: number;
  baseHeight: number;
  dx: number;
  dy: number;
  lastX: number;
  lastY: number;
  frame: number;
}

export function ZoomPad({ core }: { core: PlaylistCore }) {
  const { from, to } = useVisibleDays(core);
  const height = useRowHeight(core);
  const [dragging, setDragging] = React.useState(false);
  const padRef = React.useRef<HTMLButtonElement | null>(null);
  const dragRef = React.useRef<Drag | null>(null);
  const hintId = React.useId();

  // The hand's travel so far, applied: the zoom from the press, the lines'
  // height from the press.
  const apply = React.useCallback(
    (drag: Drag) => {
      zoomKeepingLeft(core, drag.basePx * Math.exp(drag.dx * ZOOM_PER_PX));
      core.setAllTrackHeights(drag.baseHeight - drag.dy * HEIGHT_PER_PX);
    },
    [core],
  );

  // Once per frame while the hand moves.
  const flush = React.useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.frame = 0;
    apply(drag);
  }, [apply]);

  const finish = React.useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.frame !== 0) cancelAnimationFrame(drag.frame);
    apply(drag);
    core.endGesture();
    setDragging(false);
    const pad = padRef.current;
    if (pad?.hasPointerCapture?.(drag.pointerId)) pad.releasePointerCapture(drag.pointerId);
    if (typeof document !== "undefined" && document.pointerLockElement === pad) {
      document.exitPointerLock?.();
    }
  }, [core, apply]);

  // Losing the lock (Escape, another window) ends the drag too.
  React.useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onLockChange = () => {
      if (dragRef.current && document.pointerLockElement !== padRef.current) finish();
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => document.removeEventListener("pointerlockchange", onLockChange);
  }, [finish]);

  // A drag cut short by unmount closes its undo step.
  React.useEffect(() => () => finish(), [finish]);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    const pad = event.currentTarget;
    pad.focus();
    core.beginGesture();
    dragRef.current = {
      pointerId: event.pointerId,
      basePx: core.getState().viewport.pxPerBeat,
      baseHeight: core.metrics.trackHeight,
      dx: 0,
      dy: 0,
      lastX: event.clientX,
      lastY: event.clientY,
      frame: 0,
    };
    setDragging(true);
    pad.setPointerCapture?.(event.pointerId);
    // The pointer hides and never hits a screen edge; refused (or not
    // offered): the capture keeps the drag, the pointer just stays visible.
    try {
      const request = pad.requestPointerLock?.() as unknown;
      if (request && typeof (request as Promise<void>).catch === "function") {
        (request as Promise<void>).catch(() => {});
      }
    } catch {
      // no pointer lock here
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const locked = typeof document !== "undefined" && document.pointerLockElement === padRef.current;
    // Locked, the pointer stands still: its travel is movementX / Y.
    const moveX = locked ? event.movementX : event.clientX - drag.lastX;
    const moveY = locked ? event.movementY : event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.dx += moveX || 0;
    drag.dy += moveY || 0;
    if (drag.frame === 0) drag.frame = requestAnimationFrame(flush);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const zoom = core.getState().viewport.pxPerBeat;
    switch (event.key) {
      case "ArrowLeft":
        zoomKeepingLeft(core, zoom / KEY_ZOOM);
        break;
      case "ArrowRight":
        zoomKeepingLeft(core, zoom * KEY_ZOOM);
        break;
      case "ArrowUp":
        core.setAllTrackHeights(core.metrics.trackHeight + KEY_HEIGHT);
        break;
      case "ArrowDown":
        core.setAllTrackHeights(core.metrics.trackHeight - KEY_HEIGHT);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const span = describeSpanDays(to - from);
  return (
    <div className="fin-zoompad-cell">
      <button
        ref={padRef}
        type="button"
        className="fin-zoompad"
        data-dragging={dragging ? "true" : undefined}
        aria-label="Zoom y alto de las líneas"
        aria-describedby={hintId}
        title="Arrástralo: ← → zoom · ↑ ↓ alto de las líneas (también con las flechas)"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={() => {
          // With the lock on, the capture may drop: the lock change ends it.
          if (typeof document === "undefined" || document.pointerLockElement !== padRef.current) finish();
        }}
        onKeyDown={onKeyDown}
      >
        <svg className="fin-zoompad__icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 2.5v15M2.5 10h15" />
          <path d="m7.5 5 2.5-2.5L12.5 5M7.5 15l2.5 2.5 2.5-2.5M5 7.5 2.5 10 5 12.5M15 7.5l2.5 2.5-2.5 2.5" />
        </svg>
        <span className="fin-zoompad__read" aria-hidden="true">
          <span className="fin-zoompad__span">{span}</span>
          <span className="fin-zoompad__height">Alto {Math.round(height)}</span>
        </span>
        <span id={hintId} className="fin-sr-only">
          Visible: {span}. Alto de las líneas: {Math.round(height)} píxeles. Flechas izquierda y derecha para el
          zoom; arriba y abajo para el alto.
        </span>
      </button>
    </div>
  );
}
