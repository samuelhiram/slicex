// Every row's height at once (the shell's corner pad): the materialised rows
// and the default the endless rows take, in one undoable dispatch; an undo
// gives the whole table its height back; the core's metrics follow (the
// controller and the navigator share them).
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  getTrackHeightByIndex,
} from "../src/playlist-core";

function setup() {
  const base = createDemoPlaylistState();
  const state = { ...base, tracks: base.tracks.slice(0, 3).map((track, i) => (i === 1 ? { ...track, height: 120 } : track)) };
  return createPlaylistCore(state, { metrics: DEFAULT_PLAYLIST_METRICS });
}

describe("every row's height at once", () => {
  it("sets every materialised row and the endless rows' default; one undo step brings all back", () => {
    const core = setup();
    const before = core.metrics.trackHeight;
    core.setAllTrackHeights(50);
    const state = core.getState();
    expect(state.tracks.every((track) => track.height === 50)).toBe(true);
    expect(state.rowHeight).toBe(50);
    expect(core.metrics.trackHeight).toBe(50);
    // An endless row (past the materialised ones) takes it too.
    expect(getTrackHeightByIndex(state, 10, core.metrics)).toBe(50);
    expect(core.undo()).toBe(true);
    expect(core.metrics.trackHeight).toBe(before);
    expect(core.getState().tracks[1]!.height).toBe(120);
    expect(core.getState().rowHeight).toBeUndefined();
    expect(core.redo()).toBe(true);
    expect(core.metrics.trackHeight).toBe(50);
  });

  it("clamped to the metrics; the same height again changes nothing", () => {
    const core = setup();
    core.setAllTrackHeights(5);
    expect(core.metrics.trackHeight).toBe(DEFAULT_PLAYLIST_METRICS.trackMinHeight);
    const state = core.getState();
    core.setAllTrackHeights(DEFAULT_PLAYLIST_METRICS.trackMinHeight);
    expect(core.getState()).toBe(state);
  });

  it("a drag inside a gesture is ONE undo step", () => {
    const core = setup();
    core.beginGesture();
    for (const height of [80, 90, 100, 110]) core.setAllTrackHeights(height);
    core.endGesture();
    expect(core.metrics.trackHeight).toBe(110);
    core.undo();
    expect(core.metrics.trackHeight).toBe(DEFAULT_PLAYLIST_METRICS.trackHeight);
  });

  it("each core has its own metrics: another core keeps its height", () => {
    const a = setup();
    const b = setup();
    a.setAllTrackHeights(40);
    expect(b.metrics.trackHeight).toBe(DEFAULT_PLAYLIST_METRICS.trackHeight);
    expect(DEFAULT_PLAYLIST_METRICS.trackHeight).toBe(72);
  });

  it("a state that carries rowHeight starts with it (a saved layout)", () => {
    const base = createDemoPlaylistState();
    const core = createPlaylistCore({ ...base, rowHeight: 64 }, { metrics: DEFAULT_PLAYLIST_METRICS });
    expect(core.metrics.trackHeight).toBe(64);
  });

  it("setDefaultTrackHeight: a host preference for documents that set none (no undo step)", () => {
    const core = setup();
    core.setDefaultTrackHeight(96);
    expect(core.metrics.trackHeight).toBe(96);
    expect(core.canUndo()).toBe(false);
  });
});
