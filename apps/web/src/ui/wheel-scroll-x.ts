// Sideways strips (the header metrics, the tool bar) scroll horizontally
// with a hidden scrollbar. A plain mouse wheel only sends deltaY, so on
// their own they would ignore it: this maps the vertical wheel to sideways
// scrolling, only while the strip can still move that way (at either end
// the wheel is left alone). Trackpads / Shift+wheel already send deltaX.
import * as React from "react";

const LINE_PX = 16;

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface ScrollStrip {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

/** New scrollLeft for a vertical wheel over a sideways strip, or null (leave it). */
export function wheelScrollLeft(strip: ScrollStrip, event: WheelLike): number | null {
  if (event.ctrlKey || event.metaKey || event.deltaX !== 0 || event.deltaY === 0) return null;
  const max = strip.scrollWidth - strip.clientWidth;
  if (max <= 0) return null;
  const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? strip.clientWidth : 1;
  const next = Math.min(max, Math.max(0, strip.scrollLeft + event.deltaY * unit));
  return Math.abs(next - strip.scrollLeft) < 0.5 ? null : next;
}

/**
 * Lets the mouse wheel scroll a sideways strip. Returns a callback ref, so
 * it follows the element even when it mounts / remounts later.
 */
export function useWheelScrollX(): (el: HTMLElement | null) => void {
  const detach = React.useRef<(() => void) | null>(null);
  return React.useCallback((el: HTMLElement | null) => {
    detach.current?.();
    detach.current = null;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const next = wheelScrollLeft(el, event);
      if (next === null) return;
      el.scrollLeft = next;
      event.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    detach.current = () => el.removeEventListener("wheel", onWheel);
  }, []);
}
