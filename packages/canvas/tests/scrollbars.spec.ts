import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  getHorizontalContentExtent,
  getHorizontalScrollableRange,
  getHorizontalScrollbarRect,
  getHorizontalScrollbarThumbRect,
  getVerticalContentExtent,
  getVerticalScrollableRange,
  getVerticalScrollbarRect,
  getVerticalScrollbarThumbRect,
} from "../src/playlist-core";
import { DEFAULT_PLAYLIST_METRICS } from "../src/playlist-core/types";

const M = DEFAULT_PLAYLIST_METRICS;

function viewportState(overrides: Partial<{ width: number; height: number; scrollX: number; scrollY: number; pxPerBeat: number }>) {
  const base = createDemoPlaylistState();
  return {
    ...base,
    viewport: {
      ...base.viewport,
      width: overrides.width ?? 1200,
      height: overrides.height ?? 700,
      scrollX: overrides.scrollX ?? 0,
      scrollY: overrides.scrollY ?? 0,
      pxPerBeat: overrides.pxPerBeat ?? base.viewport.pxPerBeat,
    },
  };
}

describe("scrollbars — absolute position model", () => {
  it("thumb sits at the left edge of the track when scrollX = 0", () => {
    const state = viewportState({ scrollX: 0 });
    const track = getHorizontalScrollbarRect(state, M);
    const thumb = getHorizontalScrollbarThumbRect(state, M);
    expect(thumb.x).toBe(track.x);
  });

  it("thumb sits at the right edge of the track when scrollX = scrollableRange", () => {
    const baseState = viewportState({});
    const scrollable = getHorizontalScrollableRange(baseState, M);
    const state = { ...baseState, viewport: { ...baseState.viewport, scrollX: scrollable } };
    const track = getHorizontalScrollbarRect(state, M);
    const thumb = getHorizontalScrollbarThumbRect(state, M);
    const expectedRightEdge = track.x + track.width - thumb.width;
    expect(thumb.x).toBeCloseTo(expectedRightEdge, 1);
  });

  it("vertical thumb sits at the top when scrollY = 0", () => {
    const state = viewportState({ scrollY: 0 });
    const track = getVerticalScrollbarRect(state, M);
    const thumb = getVerticalScrollbarThumbRect(state, M);
    expect(thumb.y).toBe(track.y);
  });

  it("vertical thumb sits at the bottom edge when scrollY = scrollableRange", () => {
    const baseState = viewportState({});
    const scrollable = getVerticalScrollableRange(baseState, M);
    const state = { ...baseState, viewport: { ...baseState.viewport, scrollY: scrollable } };
    const track = getVerticalScrollbarRect(state, M);
    const thumb = getVerticalScrollbarThumbRect(state, M);
    expect(thumb.y).toBeCloseTo(track.y + track.height - thumb.height, 1);
  });

  it("horizontal extent grows when scrollX is past the content end", () => {
    const small = viewportState({ scrollX: 0 });
    const far = { ...small, viewport: { ...small.viewport, scrollX: 1_000_000 } };
    expect(getHorizontalContentExtent(far, M)).toBeGreaterThan(
      getHorizontalContentExtent(small, M),
    );
  });

  it("vertical extent grows when scrollY is past the materialised tracks", () => {
    const small = viewportState({ scrollY: 0 });
    const far = { ...small, viewport: { ...small.viewport, scrollY: 1_000_000 } };
    expect(getVerticalContentExtent(far, M)).toBeGreaterThan(
      getVerticalContentExtent(small, M),
    );
  });

  it("thumb width is proportional to viewport / extent and respects minimum", () => {
    const state = viewportState({});
    const track = getHorizontalScrollbarRect(state, M);
    const thumb = getHorizontalScrollbarThumbRect(state, M);
    expect(thumb.width).toBeGreaterThanOrEqual(M.scrollbarThumbMin);
    expect(thumb.width).toBeLessThanOrEqual(track.width);
  });
});

describe("scrollbars — via PlaylistCore.updateViewport", () => {
  it("setting scrollX = 0 lands the thumb at the left edge", () => {
    const core = createPlaylistCore(viewportState({ scrollX: 5_000 }));
    core.updateViewport({ scrollX: 0 });
    const state = core.getState();
    const track = getHorizontalScrollbarRect(state, M);
    const thumb = getHorizontalScrollbarThumbRect(state, M);
    expect(thumb.x).toBe(track.x);
  });

  it("setting scrollY = 0 lands the vertical thumb at the top", () => {
    const core = createPlaylistCore(viewportState({ scrollY: 5_000 }));
    core.updateViewport({ scrollY: 0 });
    const state = core.getState();
    const track = getVerticalScrollbarRect(state, M);
    const thumb = getVerticalScrollbarThumbRect(state, M);
    expect(thumb.y).toBe(track.y);
  });
});
