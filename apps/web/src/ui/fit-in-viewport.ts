// Floating UI guard (menus, popovers, the command bar, context menus):
// whatever opens must be fully on screen. One pure placement rule + one
// hook, shared by every floating component so none of them can open with
// items out of reach:
//   - wider than the viewport → capped (max-width);
//   - taller than the viewport → capped (max-height) and scrollable;
//   - crossing an edge → shifted back inside (CSS `translate`, which
//     composes with any `transform` the component already uses).
import * as React from "react";

export interface FloatingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FloatingFit {
  /** Shift that brings the box inside (px). */
  dx: number;
  dy: number;
  /** Caps when the box can't fit as is (null = no cap needed). */
  maxWidth: number | null;
  maxHeight: number | null;
}

/** Margin kept from the viewport edges (px). */
export const FLOATING_MARGIN = 8;

function fitAxis(start: number, size: number, viewport: number, margin: number): number {
  const end = start + size;
  if (end > viewport - margin) {
    const shifted = viewport - margin - size;
    return Math.max(margin, shifted) - start;
  }
  if (start < margin) return margin - start;
  return 0;
}

/** How to move / cap `box` so it lies inside `viewport` (pure). */
export function fitInViewport(
  box: FloatingBox,
  viewport: { width: number; height: number },
  margin: number = FLOATING_MARGIN,
): FloatingFit {
  const roomX = Math.max(0, viewport.width - margin * 2);
  const roomY = Math.max(0, viewport.height - margin * 2);
  const maxWidth = box.width > roomX ? roomX : null;
  const maxHeight = box.height > roomY ? roomY : null;
  const width = maxWidth ?? box.width;
  const height = maxHeight ?? box.height;
  return {
    dx: fitAxis(box.left, width, viewport.width, margin),
    dy: fitAxis(box.top, height, viewport.height, margin),
    maxWidth,
    maxHeight,
  };
}

/** Applies fitInViewport to an element (measures, caps, shifts). */
export function fitElement(el: HTMLElement): void {
  el.style.translate = "";
  el.style.maxWidth = "";
  el.style.maxHeight = "";
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  let rect = el.getBoundingClientRect();
  // Width first: capping it can change the height.
  const first = fitInViewport(rect, viewport);
  if (first.maxWidth !== null) {
    el.style.maxWidth = `${first.maxWidth}px`;
    rect = el.getBoundingClientRect();
  }
  const fit = fitInViewport(rect, viewport);
  if (fit.maxHeight !== null) {
    el.style.maxHeight = `${fit.maxHeight}px`;
    el.style.overflowY = "auto";
  }
  if (fit.dx !== 0 || fit.dy !== 0) el.style.translate = `${fit.dx}px ${fit.dy}px`;
}

/**
 * Keeps the floating element in `ref` on screen while `active`: on open,
 * whenever `deps` change (e.g. a new anchor) and on window resize.
 */
export function useFitInViewport(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  deps: React.DependencyList = [],
): void {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return undefined;
    const apply = () => fitElement(el);
    apply();
    window.addEventListener("resize", apply);
    // Content can grow after open (e.g. suggestions): refit on size changes.
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    observer?.observe(el);
    return () => {
      window.removeEventListener("resize", apply);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps]);
}
