import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
} from "../src/playlist-core";
import { playlistReducer } from "../src/playlist-core/reducer";
import { DEFAULT_PLAYLIST_METRICS } from "../src/playlist-core/types";

const M = DEFAULT_PLAYLIST_METRICS;

describe("perf factory — CREATE_CLIPS_BATCH collapses N inserts into 1 dispatch", () => {
  it("reducer adds every entry in a single pass and materialises virtuals", () => {
    const s0 = createDemoPlaylistState();
    const targetTrack = s0.tracks.length + 3; // virtual
    const entries = Array.from({ length: 12 }, (_, i) => ({
      clip: {
        id: `gen-${i}`,
        type: "audio" as const,
        trackId: "ignored",
        start: i * 4,
        duration: 4,
        label: `g${i}`,
        color: "#fff",
      },
      trackIndex: targetTrack,
    }));
    const s1 = playlistReducer(
      s0,
      { type: "CREATE_CLIPS_BATCH", entries },
      M,
    );
    expect(s1.clips.length).toBe(s0.clips.length + 12);
    expect(s1.tracks.length).toBeGreaterThanOrEqual(targetTrack + 1);
    const newTrackId = s1.tracks[targetTrack]!.id;
    expect(
      s1.clips.filter((c) => c.id.startsWith("gen-")).every(
        (c) => c.trackId === newTrackId,
      ),
    ).toBe(true);
  });

  it("CREATE_CLIPS_BATCH with empty entries is a no-op (no allocation)", () => {
    const s0 = createDemoPlaylistState();
    const s1 = playlistReducer(
      s0,
      { type: "CREATE_CLIPS_BATCH", entries: [] },
      M,
    );
    expect(s1).toBe(s0);
  });

  it("core.createClips produces N ids and only one subscriber notification", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    let notifyCount = 0;
    const sub = core.subscribe(() => {
      notifyCount += 1;
    });
    try {
      const ids = core.createClips(
        Array.from({ length: 25 }, (_, i) => ({
          trackIndex: 0,
          start: 200 + i * 4,
          duration: 4,
          type: "pattern" as const,
          label: "p",
          color: "#fff",
        })),
      );
      expect(ids.length).toBe(25);
      expect(notifyCount).toBe(1);
    } finally {
      sub.unsubscribe();
    }
  });

  it("core.createClips skips locked tracks", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.toggleTrackLock(0);
    const ids = core.createClips([
      {
        trackIndex: 0,
        start: 500,
        duration: 4,
        type: "pattern",
        label: "p",
        color: "#fff",
      },
      {
        trackIndex: 1,
        start: 500,
        duration: 4,
        type: "pattern",
        label: "p",
        color: "#fff",
      },
    ]);
    expect(ids.length).toBe(1);
    expect(
      core
        .getState()
        .clips.filter((c) => c.start === 500 && c.trackId === core.getState().tracks[0]!.id),
    ).toEqual([]);
  });

  it("core.createClips is a single undo step", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = core.getState().clips.length;
    core.createClips([
      { trackIndex: 0, start: 600, duration: 4, type: "pattern" },
      { trackIndex: 0, start: 604, duration: 4, type: "pattern" },
      { trackIndex: 0, start: 608, duration: 4, type: "pattern" },
    ]);
    expect(core.getState().clips.length).toBe(before + 3);
    core.undo();
    expect(core.getState().clips.length).toBe(before);
  });
});

describe("perf factory — batch dispatch fast path", () => {
  it("500 createClips entries dispatch in under 30 ms", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const t0 = performance.now();
    core.createClips(
      Array.from({ length: 500 }, (_, i) => ({
        trackIndex: 0,
        start: 1000 + i * 4,
        duration: 4,
        type: "pattern",
        label: "x",
        color: "#fff",
      })),
    );
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(30);
  });
});
