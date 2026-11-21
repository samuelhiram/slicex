// Row header layout by row height (presentation.ts buildTrackRow): the
// toggles never cover the subtitle, whatever height the row is resized to.
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  TRACK_HEADER_COMPACT_MIN_HEIGHT,
  TRACK_HEADER_FULL_MIN_HEIGHT,
  type PlaylistState,
} from "../src/playlist-core";
import { hitTestPlaylist } from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;
const SUBTITLE_TOP = 28;
const SUBTITLE_BOTTOM = 42; // 11 px text

function rowAt(height: number) {
  const base = createDemoPlaylistState();
  const state: PlaylistState = {
    ...base,
    tracks: [{ id: "t0", label: "Línea de evento", color: "#888888", height }],
    clips: [],
    viewport: { ...base.viewport, scrollX: 0, scrollY: 0, width: 1200, height: 700 },
  };
  const core = createPlaylistCore(state);
  return { core, row: core.getPresentation().trackRows[0]! };
}

describe("row header layout follows the row height", () => {
  it("full / compact / mini at the thresholds", () => {
    expect(rowAt(72).row.headerLayout).toBe("full");
    expect(rowAt(TRACK_HEADER_FULL_MIN_HEIGHT).row.headerLayout).toBe("full");
    expect(rowAt(TRACK_HEADER_FULL_MIN_HEIGHT - 1).row.headerLayout).toBe("compact");
    expect(rowAt(60).row.headerLayout).toBe("compact");
    expect(rowAt(TRACK_HEADER_COMPACT_MIN_HEIGHT).row.headerLayout).toBe("compact");
    expect(rowAt(TRACK_HEADER_COMPACT_MIN_HEIGHT - 1).row.headerLayout).toBe("mini");
  });

  it("the toggles never sit on the subtitle's line, at any height", () => {
    for (let height = M.trackMinHeight; height <= 120; height += 1) {
      const { row } = rowAt(height);
      const top = row.rowRect.y;
      for (const button of [row.buttons.mute, row.buttons.solo, row.buttons.lock, row.reorderHandleRect]) {
        const y0 = button.y - top;
        const y1 = y0 + button.height;
        // Inside the row…
        expect(y0).toBeGreaterThanOrEqual(0);
        expect(y1).toBeLessThanOrEqual(height);
        // …and off the subtitle band whenever a subtitle is drawn (not mini).
        if (row.headerLayout !== "mini") {
          expect(y1 <= SUBTITLE_TOP || y0 >= SUBTITLE_BOTTOM).toBe(true);
        }
      }
    }
  });

  it("compact rows put the toggles on the name's line, right-aligned before the grip", () => {
    const { row } = rowAt(60);
    const header = row.headerRect;
    expect(row.reorderHandleRect.x + row.reorderHandleRect.width).toBeLessThanOrEqual(
      header.x + header.width,
    );
    // Packed against the grip, 4 px apart, left of it.
    expect(row.buttons.lock.x + row.buttons.lock.width + 4).toBe(row.reorderHandleRect.x);
    expect(row.buttons.solo.x + row.buttons.solo.width + 4).toBe(row.buttons.lock.x);
    expect(row.buttons.mute.x).toBeGreaterThan(header.x + 30); // after the name's start
    // Centred on the name's line.
    expect(row.buttons.mute.y - row.rowRect.y + row.buttons.mute.height / 2).toBe(row.titleY + 8);
  });

  it("a click lands on the toggle where it is drawn (compact row)", () => {
    const { core, row } = rowAt(60);
    const b = row.buttons.mute;
    const hit = hitTestPlaylist(core.getPresentation(), { x: b.x + b.width / 2, y: b.y + b.height / 2 }, M);
    expect(hit.kind).toBe("track-mute-button");
  });
});
