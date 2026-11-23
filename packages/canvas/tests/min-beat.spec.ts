// viewport.minBeat (PlaylistCore.setMinBeat): a host with a past to show
// (e.g. a plan's remembered balances) lets the scroll and the playhead go
// back before beat 0. The past is read-only: clips never start before 0.
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  createPlaylistPresentation,
  DEFAULT_PLAYLIST_METRICS,
  getHorizontalScrollbarThumbRect,
  getMinScrollX,
  snapTime,
} from "../src/playlist-core";

const M = DEFAULT_PLAYLIST_METRICS;

function setup() {
  const core = createPlaylistCore(createDemoPlaylistState(), { metrics: M });
  core.setViewportSize(1200, 700);
  core.updateViewport({ pxPerBeat: 20, scrollX: 0 });
  return core;
}

describe("viewport.minBeat — a past left of beat 0", () => {
  it("by default nothing comes before beat 0", () => {
    const core = setup();
    core.updateViewport({ scrollX: -500 });
    core.setPlayPosition(-3);
    core.setHoverTime(-2);
    expect(core.getState().viewport.scrollX).toBe(0);
    expect(core.getState().playPosition.time).toBe(0);
    expect(core.getState().hoverTime).toBe(0);
  });

  it("with a past, the scroll, the playhead and the hover reach back to it — not further", () => {
    const core = setup();
    core.setMinBeat(-6);
    expect(core.getState().viewport.minBeat).toBe(-6);
    core.updateViewport({ scrollX: -60 });
    expect(core.getState().viewport.scrollX).toBe(-60);
    core.updateViewport({ scrollX: -500 });
    expect(core.getState().viewport.scrollX).toBe(-120);
    expect(getMinScrollX(core.getState())).toBe(-120);
    core.setPlayPosition(-4);
    expect(core.getState().playPosition.time).toBe(-4);
    core.setPlayPosition(-40);
    expect(core.getState().playPosition.time).toBe(-6);
    core.setHoverTime(-5.5);
    expect(core.getState().hoverTime).toBe(-6);
    // Zooming keeps the bound in beats.
    core.updateViewport({ pxPerBeat: 40, scrollX: -1000 });
    expect(core.getState().viewport.scrollX).toBe(-240);
  });

  it("is a view bound: no undo step, no notify when unchanged", () => {
    const core = setup();
    let notified = 0;
    core.subscribe(() => {
      notified += 1;
    });
    core.setMinBeat(-6);
    expect(notified).toBe(1);
    core.setMinBeat(-6);
    expect(notified).toBe(1);
    expect(core.canUndo()).toBe(false);
  });

  it("a shorter past pulls the view and the playhead back inside it", () => {
    const core = setup();
    core.setMinBeat(-10);
    core.updateViewport({ scrollX: -200 });
    core.setPlayPosition(-9);
    core.setMinBeat(-3);
    expect(core.getState().viewport.scrollX).toBe(-60);
    expect(core.getState().playPosition.time).toBe(-3);
    core.setMinBeat(0);
    expect(core.getState().viewport.minBeat).toBeUndefined();
    expect(core.getState().viewport.scrollX).toBe(0);
    expect(core.getState().playPosition.time).toBe(0);
  });

  it("the past is read-only: a clip moved or created there stays at beat 0", () => {
    const core = setup();
    core.setMinBeat(-10);
    const clip = core.getState().clips[0]!;
    core.moveClips([{ id: clip.id, start: -5, trackIndex: 0 }]);
    expect(core.getState().clips.find((candidate) => candidate.id === clip.id)!.start).toBe(0);
    // The snap reaches the past (the playhead's), the clips don't.
    expect(snapTime(-4.4, core.getState(), false, M)).toBeLessThan(0);
  });

  it("the ruler and the navigator start at the past", () => {
    const core = setup();
    core.setMinBeat(-8);
    core.updateViewport({ scrollX: -160 });
    const presentation = createPlaylistPresentation(core.getState(), M);
    expect(presentation.rulerTicks[0]!.beat).toBeLessThan(0);
    // The navigator's thumb sits at the track's start when the view is at the past's start.
    const thumb = getHorizontalScrollbarThumbRect(core.getState(), M);
    const track = presentation.scrollbars.horizontal.trackRect;
    expect(thumb.x).toBe(track.x);
  });
});
