// PlaylistLayoutOptions.clipMinWidthPx: a host's least DRAWN width per clip,
// whatever the zoom (one-time events as tags as wide as their text). The
// rect grows (hit-test and renderer follow); the time span does not.
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistState,
} from "../src/playlist-core";
import { hitTestPlaylist } from "../src/playlist-interaction";
import { clipTextWidthPx } from "../src/playlist-renderer-pixi";

const M = DEFAULT_PLAYLIST_METRICS;

function setup(minWidth?: number) {
  const base = createDemoPlaylistState();
  const state: PlaylistState = {
    ...base,
    clips: [
      { id: "tag", type: "pattern", trackId: base.tracks[0]!.id, start: 10, duration: 1, label: "Ingreso", color: "#46b871" },
      { id: "win", type: "pattern", trackId: base.tracks[1]!.id, start: 10, duration: 1, label: "Renta", color: "#46b871" },
    ],
    markers: [],
  };
  const core = createPlaylistCore(state, {
    metrics: M,
    ...(minWidth !== undefined ? { clipMinWidthPx: (clip) => (clip.id === "tag" ? minWidth : 0) } : {}),
  });
  core.setViewportSize(1200, 700);
  core.updateViewport({ pxPerBeat: 4, scrollX: 0, scrollY: 0 });
  return core;
}

describe("clipMinWidthPx", () => {
  it("zoomed out, the tag keeps its width; other clips keep their span", () => {
    const core = setup(90);
    const views = core.getPresentation().clipViewsById;
    expect(views.get("tag")!.rect.width).toBe(90);
    const px = core.getState().viewport.pxPerBeat;
    expect(px).toBeLessThan(90);
    expect(views.get("win")!.rect.width).toBe(px);
    expect(core.getState().clips.find((clip) => clip.id === "tag")!.duration).toBe(1);
    // Zoomed in past it: its span wins.
    core.updateViewport({ pxPerBeat: 200 });
    const zoomed = core.getState().viewport.pxPerBeat;
    expect(zoomed).toBeGreaterThan(90);
    expect(core.getPresentation().clipViewsById.get("tag")!.rect.width).toBe(zoomed);
  });

  it("the grown part is the clip to the pointer", () => {
    const core = setup(90);
    const rect = core.getPresentation().clipViewsById.get("tag")!.rect;
    const hit = hitTestPlaylist(core.getPresentation(), { x: rect.x + 60, y: rect.y + 10 }, M);
    expect(hit).toMatchObject({ kind: "clip", clipId: "tag" });
  });

  it("without it, the span alone", () => {
    const core = setup();
    expect(core.getPresentation().clipViewsById.get("tag")!.rect.width).toBe(core.getState().viewport.pxPerBeat);
  });

  it("clipTextWidthPx: room for the longer of the two lines, whole", () => {
    expect(clipTextWidthPx("Ingreso", "+$4,000")).toBe(Math.ceil(11 + 7 * 7.8 + 6 + 1));
    expect(clipTextWidthPx("Ingreso", "+$4,000 · único pago")).toBeGreaterThan(clipTextWidthPx("Ingreso", null));
  });
});
