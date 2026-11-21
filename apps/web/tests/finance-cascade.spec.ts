// One-time events are drawn as wide as their name (clipMinWidthPx), wider
// than their day: on a shared row their cards would cover the next object.
// The lanes keep the DRAWN cards apart — loading a plan, adding an item —
// cascading the one that comes after to a lane below.
import { describe, expect, it } from "vitest";
import type { FinancialDocument, FinancialItem } from "@slicex/core";
import { createPlaylistCore, type PlaylistCore, type PlaylistRect } from "@slicex/canvas";
import { FinancialBridge } from "../src/finance/financial-bridge";
import {
  FINANCE_PLAYLIST_METRICS,
  createFinancialPlaylistState,
  type FinancialTrackLayout,
} from "../src/finance/mapping";

const START = "2026-11-07";

const LOAN: FinancialItem = {
  id: "loan",
  kind: "loan",
  name: "Préstamo",
  paymentAmount: 7500,
  recurrence: { frequency: "monthly", startDate: "2026-12-15", endDate: "2027-05-15" },
};
const EXPENSE: FinancialItem = {
  id: "gasto",
  kind: "expense",
  name: "Gasto",
  amount: 3000,
  // Two weeks before the loan: apart in time (a one-time clip spans a
  // week), but its card — as wide as its name — reaches the loan when
  // zoomed out.
  recurrence: { frequency: "once", startDate: "2026-12-01", endDate: "2026-12-01" },
};

function makeDoc(items: FinancialItem[]): FinancialDocument {
  return {
    id: "t",
    name: "t",
    startDate: START,
    initialCash: 5000,
    minimumCashReserve: 1000,
    horizonMonths: 12,
    items,
  };
}

// The shell's wiring: the core asks the bridge how wide each card is drawn.
function setup(doc: FinancialDocument, layout: FinancialTrackLayout | null = null) {
  let bridge: FinancialBridge | null = null;
  const core = createPlaylistCore(createFinancialPlaylistState(doc, layout), {
    metrics: FINANCE_PLAYLIST_METRICS,
    stretchEnabled: false,
    clipMinWidthPx: (clip, height, titleHeight) => bridge?.clipMinWidth(clip.id, height, titleHeight) ?? 0,
  });
  core.setViewportSize(1600, 900);
  // Zoomed out: 6 px a day — a one-time card spans weeks.
  core.updateViewport({ pxPerBeat: 6, scrollX: 0, scrollY: 0 });
  bridge = new FinancialBridge(core, doc);
  core.relayoutLanes();
  return { core, bridge };
}

function rectOf(core: PlaylistCore, id: string): PlaylistRect {
  const view = core.getPresentation().visibleClipViews.find((candidate) => candidate.clip.id === id);
  expect(view).toBeDefined();
  return view!.rect;
}

function overlap(a: PlaylistRect, b: PlaylistRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("one-time cards never cover the next object on their row", () => {
  it("loading a plan where both share a row: the later one cascades below", () => {
    const doc = makeDoc([LOAN, EXPENSE]);
    const plain = createFinancialPlaylistState(doc);
    const row = plain.clips.find((clip) => clip.id === "loan")!.trackId;
    const layout: FinancialTrackLayout = {
      tracks: plain.tracks.map(({ lanes: _lanes, ...track }) => track),
      placement: { loan: row, gasto: row },
    };
    const { core } = setup(doc, layout);
    const state = core.getState();
    const gasto = state.clips.find((clip) => clip.id === "gasto")!;
    const loan = state.clips.find((clip) => clip.id === "loan")!;
    expect(gasto.trackId).toBe(loan.trackId);
    // The expense (1 dic) comes first: it keeps the top; the loan goes down.
    expect(gasto.lane ?? 0).toBe(0);
    expect(loan.lane ?? 0).toBe(1);
    expect(overlap(rectOf(core, "gasto"), rectOf(core, "loan"))).toBe(false);
  });

  it("adding a one-time item on a row right before another object: no card covers another", () => {
    const { core, bridge } = setup(makeDoc([LOAN]));
    const row = core.getState().tracks.findIndex(
      (track) => track.id === core.getState().clips.find((clip) => clip.id === "loan")!.trackId,
    );
    const id = bridge.addItem(EXPENSE, { trackIndex: row });
    const state = core.getState();
    const added = state.clips.find((clip) => clip.id === id)!;
    const loan = state.clips.find((clip) => clip.id === "loan")!;
    expect(added.trackId).toBe(loan.trackId);
    expect(added.lane ?? 0).not.toBe(loan.lane ?? 0);
    expect(overlap(rectOf(core, id), rectOf(core, "loan"))).toBe(false);
  });

  it("zoomed in, both fit side by side again (the cascade is only for touching cards)", () => {
    const doc = makeDoc([LOAN, EXPENSE]);
    const plain = createFinancialPlaylistState(doc);
    const row = plain.clips.find((clip) => clip.id === "loan")!.trackId;
    const { core } = setup(doc, {
      tracks: plain.tracks.map(({ lanes: _lanes, ...track }) => track),
      placement: { loan: row, gasto: row },
    });
    expect(core.getState().clips.find((clip) => clip.id === "loan")!.lane ?? 0).toBe(1);
    core.updateViewport({ pxPerBeat: 40, scrollX: 20 * 40 }); // both in sight
    expect(core.getState().clips.find((clip) => clip.id === "loan")!.lane ?? 0).toBe(0);
    expect(overlap(rectOf(core, "gasto"), rectOf(core, "loan"))).toBe(false);
  });
});
