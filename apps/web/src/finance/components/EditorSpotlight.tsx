// The item editor's backdrop with a spotlight: the canvas behind blurs and
// dims, except the object being edited — a clear, unblurred window around it
// with a soft accent ring — so it is plain which object the form is about.
//
//   clipScreenRect   where a clip is drawn (client px), cut to the visible
//                    timeline; null when it is off-screen.
//   useClipSpotlight that rect, kept in step with the canvas (core notifies,
//                    coalesced to one measure per frame) and the window.
//   EditorSpotlight  the scrim (blur + dim, the hole cut with clip-path) and
//                    the ring. Rendered as the overlay's first child.
import * as React from "react";
import type { PlaylistCore } from "@slicex/canvas";

/** A rectangle in px (client coords for clipScreenRect, overlay-local for a hole). */
export interface SpotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Clear room between the object and the ring (px). */
export const SPOT_PAD = 6;
/** Corner radius of the hole and the ring (px). */
export const SPOT_RADIUS = 9;

/**
 * Where `clipId` is drawn on screen (client px), cut to the visible
 * timeline (never over the ruler or the line headers), or null when it is
 * not on screen. Reads the core's cached presentation: O(visible clips).
 */
export function clipScreenRect(core: PlaylistCore, host: HTMLElement, clipId: string): SpotRect | null {
  const presentation = core.getPresentation();
  const view = presentation.visibleClipViews.find((candidate) => candidate.clip.id === clipId);
  if (!view) return null;
  const area = presentation.layout.timelineRect;
  const left = Math.max(view.rect.x, area.x);
  const top = Math.max(view.rect.y, area.y);
  const right = Math.min(view.rect.x + view.rect.width, area.x + area.width);
  const bottom = Math.min(view.rect.y + view.rect.height, area.y + area.height);
  if (right - left < 1 || bottom - top < 1) return null;
  const box = host.getBoundingClientRect();
  return { x: box.left + left, y: box.top + top, width: right - left, height: bottom - top };
}

function sameRect(a: SpotRect | null, b: SpotRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

const nextFrame = (run: () => void): number =>
  typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : (setTimeout(run, 16) as unknown as number);
const cancelFrame = (id: number): void => {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else clearTimeout(id);
};

/**
 * The screen rect of `clipId` (clipScreenRect) while it is mounted: measured
 * before the first paint, then again — once per frame at most — when the
 * canvas notifies or the window resizes. Same rect, same object (no render).
 */
export function useClipSpotlight(
  core: PlaylistCore | null,
  getHost: (() => HTMLElement | null) | undefined,
  clipId: string | null,
): SpotRect | null {
  const [rect, setRect] = React.useState<SpotRect | null>(null);
  React.useLayoutEffect(() => {
    if (!core || !getHost || !clipId) {
      setRect(null);
      return undefined;
    }
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const host = getHost();
      const next = host ? clipScreenRect(core, host, clipId) : null;
      setRect((prev) => (sameRect(prev, next) ? prev : next));
    };
    const schedule = (): void => {
      if (frame === 0) frame = nextFrame(measure);
    };
    measure();
    const sub = core.subscribe(schedule);
    window.addEventListener("resize", schedule);
    return () => {
      sub.unsubscribe();
      window.removeEventListener("resize", schedule);
      if (frame !== 0) cancelFrame(frame);
    };
  }, [core, getHost, clipId]);
  return rect;
}

/**
 * The hole for `target` (client px) in an overlay at `box` (client px):
 * overlay-local, grown by SPOT_PAD, kept inside the overlay; null when
 * nothing of it is left. `cover` (overlay-local): the sheet. When it covers
 * the hole's whole height, the hole stops a little under its left edge (the
 * ring's end and corners hidden by it: the window reads as going on behind
 * the sheet) — and a hole wholly behind it is none.
 */
export function spotlightHole(box: SpotRect, target: SpotRect, cover: SpotRect | null = null): SpotRect | null {
  const left = Math.max(0, Math.round(target.x - box.x - SPOT_PAD));
  const top = Math.max(0, Math.round(target.y - box.y - SPOT_PAD));
  let right = Math.min(box.width, Math.round(target.x - box.x + target.width + SPOT_PAD));
  const bottom = Math.min(box.height, Math.round(target.y - box.y + target.height + SPOT_PAD));
  if (cover && cover.y <= top && cover.y + cover.height >= bottom && cover.x < right) {
    if (cover.x <= left) return null;
    right = Math.min(right, Math.round(cover.x + SPOT_RADIUS + SPOT_PAD));
  }
  if (right - left < 2 || bottom - top < 2) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A clip-path that covers a `width` × `height` box but `hole` (a rounded
 * rect): the outer rect and the hole in one path, even-odd.
 */
export function spotlightClipPath(width: number, height: number, hole: SpotRect, radius = SPOT_RADIUS): string {
  const r = Math.max(0, Math.min(radius, hole.width / 2, hole.height / 2));
  const x = hole.x;
  const y = hole.y;
  const x2 = hole.x + hole.width;
  const y2 = hole.y + hole.height;
  const arc = `A${r} ${r} 0 0 1`;
  return (
    `path(evenodd, "M0 0H${width}V${height}H0Z` +
    `M${x + r} ${y}H${x2 - r}${arc} ${x2} ${y + r}V${y2 - r}${arc} ${x2 - r} ${y2}` +
    `H${x + r}${arc} ${x} ${y2 - r}V${y + r}${arc} ${x + r} ${y}Z")`
  );
}

/**
 * The editor's backdrop: blur + dim over everything, but a clear window on
 * `target` (client px; null = no window) ringed in the accent colour. Sized
 * to its parent (the overlay), whose box it follows; `coverRef` is the sheet
 * in front (the window stops under it). Never takes a click.
 */
export function EditorSpotlight({
  target,
  coverRef,
}: {
  target: SpotRect | null;
  coverRef?: React.RefObject<HTMLElement | null>;
}) {
  const scrimRef = React.useRef<HTMLDivElement | null>(null);
  const [box, setBox] = React.useState<SpotRect | null>(null);
  const [cover, setCover] = React.useState<SpotRect | null>(null);
  React.useLayoutEffect(() => {
    const overlay = scrimRef.current?.parentElement;
    if (!overlay) return undefined;
    const measure = (): void => {
      const r = overlay.getBoundingClientRect();
      const next = { x: r.left, y: r.top, width: r.width, height: r.height };
      setBox((prev) => (sameRect(prev, next) ? prev : next));
      // The sheet's layout box (offset*: its slide-in transform aside).
      const sheet = coverRef?.current ?? null;
      const nextCover =
        sheet && sheet.offsetParent === overlay
          ? { x: sheet.offsetLeft, y: sheet.offsetTop, width: sheet.offsetWidth, height: sheet.offsetHeight }
          : null;
      setCover((prev) => (sameRect(prev, nextCover) ? prev : nextCover));
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(overlay);
    if (coverRef?.current) observer?.observe(coverRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [coverRef]);
  const hole = target && box ? spotlightHole(box, target, cover) : null;
  return (
    <>
      <div
        ref={scrimRef}
        className="fin-spotlight__scrim"
        data-hole={hole ? "true" : "false"}
        style={hole && box ? { clipPath: spotlightClipPath(box.width, box.height, hole) } : undefined}
        aria-hidden="true"
      />
      {hole ? (
        <div
          className="fin-spotlight__ring"
          style={{ left: hole.x, top: hole.y, width: hole.width, height: hole.height }}
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}
