import { describe, expect, it } from "vitest";
import type { FinancialDocument, FinancialItem } from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import { FinancialBridge } from "../src/finance/financial-bridge";
import {
  createDemoFinancialDocument,
  expandFinancialEvents,
} from "@slicex/core";
import {
  FINANCE_PLAYLIST_METRICS,
  createFinancialPlaylistState,
  deriveRecurrence,
  itemToClip,
  itemTrackId,
  openEndBeat,
} from "../src/finance/mapping";

const START = "2026-11-07";

function makeDoc(): FinancialDocument {
  return {
    id: "t",
    name: "test",
    startDate: START,
    initialCash: 5000,
    minimumCashReserve: 1000,
    horizonMonths: 12,
    items: [
      {
        id: "sal",
        kind: "income",
        name: "Sueldo",
        amount: 9000,
        recurrence: { frequency: "biweekly", startDate: "2026-11-13" },
      },
      {
        id: "gas",
        kind: "expense",
        name: "Gasto",
        amount: 2000,
        recurrence: { frequency: "once", startDate: "2026-11-20" },
      },
      {
        id: "loan",
        kind: "loan",
        name: "Préstamo",
        paymentAmount: 1500,
        recurrence: {
          frequency: "monthly",
          startDate: "2026-11-10",
          endDate: "2027-04-10",
        },
      },
    ],
  };
}

function setup(doc: FinancialDocument = makeDoc()) {
  const core = createPlaylistCore(createFinancialPlaylistState(doc), {
    metrics: FINANCE_PLAYLIST_METRICS,
    stretchEnabled: false,
  });
  const bridge = new FinancialBridge(core, doc);
  const clip = (id: string) => {
    const found = core.getState().clips.find((c) => c.id === id);
    if (!found) throw new Error(`no clip ${id}`);
    return found;
  };
  const trackIndexOf = (id: string) =>
    core.getState().tracks.findIndex((t) => t.id === clip(id).trackId);
  const datesOf = (itemId: string) =>
    bridge
      .getProjection()
      .points.filter((p) => p.itemId === itemId)
      .map((p) => p.date);
  const events = () =>
    expandFinancialEvents(bridge.getDocument())
      .map((e) => `${e.date}|${e.type}|${e.amount}|${e.name}`)
      .sort();
  return { core, bridge, clip, trackIndexOf, datesOf, events };
}

// Corrections (sourceId, labels, open-end pin) land in a microtask.
const flush = () => Promise.resolve();

describe("mapping", () => {
  it("round-trips every item through clip geometry", () => {
    const doc = makeDoc();
    for (const item of doc.items) {
      const clip = itemToClip(doc, item, itemTrackId(item));
      const rule = deriveRecurrence(
        doc,
        item,
        clip,
        null,
        item.recurrence.endDate === undefined,
      );
      expect(rule).toEqual(item.recurrence);
    }
  });

  it("draws an indefinite window up to the horizon", () => {
    const doc = makeDoc();
    const sal = doc.items[0]!;
    const clip = itemToClip(doc, sal, "x");
    expect(clip.start).toBe(6);
    expect(clip.start + clip.duration).toBe(openEndBeat(doc));
  });

  it("encodes a past window start as content offset", () => {
    const doc = makeDoc();
    const item: FinancialItem = {
      id: "old",
      kind: "expense",
      name: "Renta",
      amount: 100,
      recurrence: { frequency: "monthly", startDate: "2026-10-01" },
    };
    const clip = itemToClip(doc, item, "x");
    expect(clip.start).toBe(0);
    expect(clip.contentOffset).toBe(37);
    expect(deriveRecurrence(doc, item, clip, null, true)).toEqual(item.recurrence);
  });
});

describe("FinancialBridge — playlist edits rewrite financial dates", () => {
  it("one clip per item, ids shared", () => {
    const { core, bridge } = setup();
    const ids = core.getState().clips.map((c) => c.id).sort();
    expect(ids).toEqual(["gas", "loan", "sal"]);
    expect(bridge.getItem("sal")?.name).toBe("Sueldo");
  });

  it("moving a one-time expense changes its date and recalculates", () => {
    const { core, bridge, trackIndexOf, datesOf } = setup();
    const before = bridge.getRevision();
    let notified = 0;
    bridge.subscribe(() => {
      notified += 1;
    });
    core.moveClips([{ id: "gas", start: 20, trackIndex: trackIndexOf("gas") }]);
    expect(bridge.getItem("gas")?.recurrence.startDate).toBe("2026-11-27");
    expect(datesOf("gas")).toEqual(["2026-11-27"]);
    expect(bridge.getRevision()).toBeGreaterThan(before);
    expect(notified).toBeGreaterThan(0);
  });

  it("moving a recurring income shifts every payday", () => {
    const { core, datesOf, trackIndexOf } = setup();
    expect(datesOf("sal").slice(0, 2)).toEqual(["2026-11-13", "2026-11-27"]);
    core.moveClips([{ id: "sal", start: 9, trackIndex: trackIndexOf("sal") }]);
    expect(datesOf("sal").slice(0, 2)).toEqual(["2026-11-16", "2026-11-30"]);
  });

  it("a pure move keeps an indefinite income indefinite", () => {
    const { core, bridge, trackIndexOf } = setup();
    core.moveClips([{ id: "sal", start: 2, trackIndex: trackIndexOf("sal") }]);
    expect(bridge.getItem("sal")?.recurrence.endDate).toBeUndefined();
  });

  it("stretching the right edge sets endDate", () => {
    const { core, bridge, datesOf } = setup();
    core.resizeClip("sal", "right", 40); // window [6, 40) → ends 2026-12-16
    expect(bridge.getItem("sal")?.recurrence.endDate).toBe("2026-12-16");
    expect(datesOf("sal")).toEqual(["2026-11-13", "2026-11-27", "2026-12-11"]);
  });

  it("cropping the left edge keeps the paydays in phase", () => {
    const { core, datesOf } = setup();
    core.resizeClip("sal", "left", 13); // window starts 2026-11-20
    expect(datesOf("sal").slice(0, 2)).toEqual(["2026-11-27", "2026-12-11"]);
  });

  it("delete + undo restores the item intact", () => {
    const { core, bridge } = setup();
    core.deleteClip("loan");
    expect(bridge.getItem("loan")).toBeNull();
    core.undo();
    const loan = bridge.getItem("loan");
    expect(loan?.kind).toBe("loan");
    expect(loan && loan.kind === "loan" ? loan.paymentAmount : 0).toBe(1500);
  });

  it("slicing an indefinite income yields two in-phase items; undo merges back", () => {
    const { core, bridge, datesOf } = setup();
    const original = datesOf("sal");
    const created = core.sliceClipsAtTime(30); // 2026-12-07
    expect(created.length).toBeGreaterThan(0);
    const rightId = core
      .getState()
      .clips.find((c) => c.id !== "sal" && c.sourceId === "sal")?.id;
    expect(rightId).toBeDefined();
    expect(bridge.getItem("sal")?.recurrence.endDate).toBe("2026-12-06");
    const right = bridge.getItem(rightId!);
    expect(right?.kind).toBe("income");
    expect(right?.recurrence.endDate).toBeUndefined();
    expect([...datesOf("sal"), ...datesOf(rightId!)].sort()).toEqual(original);

    core.undo();
    expect(bridge.getItem(rightId!)).toBeNull();
    expect(bridge.getItem("sal")?.recurrence.endDate).toBeUndefined();
    expect(datesOf("sal")).toEqual(original);
  });

  it("paste clones the financial item", () => {
    const { core, bridge, trackIndexOf } = setup();
    core.setClipSelection(["gas"]);
    expect(core.copyToClipboard()).toBe(true);
    core.pasteClipboard({ atTime: 40, atTrackIndex: trackIndexOf("gas") });
    const pasted = core
      .getState()
      .clips.find((c) => c.id !== "gas" && c.sourceId === "gas");
    expect(pasted).toBeDefined();
    const item = bridge.getItem(pasted!.id);
    expect(item?.kind).toBe("expense");
    expect(item && item.kind === "expense" ? item.amount : 0).toBe(2000);
    expect(item?.recurrence.startDate).toBe("2026-12-17");
  });

  it("muting a clip excludes the item from the projection", () => {
    const { core, bridge, datesOf } = setup();
    const withSalary = bridge.getProjection().finalCash;
    core.toggleClipMute("sal");
    expect(bridge.getItem("sal")?.enabled).toBe(false);
    expect(datesOf("sal")).toEqual([]);
    core.toggleClipMute("sal");
    expect(bridge.getProjection().finalCash).toBe(withSalary);
  });

  it("renaming the clip renames the item", () => {
    const { core, bridge } = setup();
    core.setClipLabel("gas", "Super");
    expect(bridge.getItem("gas")?.name).toBe("Super");
  });

  it("hover / playhead / viewport changes never bump the revision", () => {
    const { core, bridge } = setup();
    const revision = bridge.getRevision();
    core.setHover({ kind: "clip", clipId: "sal" });
    core.setPlayPosition(42);
    core.setViewportSize(800, 600);
    expect(bridge.getRevision()).toBe(revision);
  });

  it("a generic clip drawn on a track inherits that track's item", async () => {
    const { core, bridge, trackIndexOf } = setup();
    const id = core.createClip({
      trackIndex: trackIndexOf("gas"),
      start: 50,
      duration: 4,
    });
    const item = bridge.getItem(id);
    expect(item?.kind).toBe("expense");
    expect(item?.name).toBe("Gasto");
    expect(item?.recurrence.startDate).toBe("2026-12-27");
    await Promise.resolve();
    expect(core.getState().clips.find((c) => c.id === id)?.label).toBe("Gasto");
  });
});

describe("FinancialBridge — editor and summary writes", () => {
  it("changing an income amount changes the whole future", () => {
    const { bridge } = setup();
    const before = bridge.getProjection();
    const sal = bridge.getItem("sal");
    if (!sal || sal.kind !== "income") throw new Error("bad fixture");
    const count = before.points.filter((p) => p.itemId === "sal").length;
    bridge.replaceItem({ ...sal, amount: 11000 });
    const after = bridge.getProjection();
    expect(after.finalCash - before.finalCash).toBeCloseTo(2000 * count, 2);
    const firstPay = after.points.find((p) => p.itemId === "sal");
    expect(firstPay?.cashDelta).toBe(11000);
  });

  it("changing a date in the editor moves the clip as one undo step", () => {
    const { core, bridge, clip } = setup();
    const gas = bridge.getItem("gas")!;
    bridge.replaceItem({
      ...gas,
      recurrence: { frequency: "once", startDate: "2026-12-01" },
    });
    expect(clip("gas").start).toBe(24);
    expect(bridge.getItem("gas")?.recurrence.startDate).toBe("2026-12-01");
    core.undo();
    expect(clip("gas").start).toBe(13);
    expect(bridge.getItem("gas")?.recurrence.startDate).toBe("2026-11-20");
  });

  it("editor can turn a one-time expense into a monthly one with an end date", () => {
    const { bridge, datesOf } = setup();
    const gas = bridge.getItem("gas")!;
    bridge.replaceItem({
      ...gas,
      recurrence: {
        frequency: "monthly",
        startDate: "2026-11-20",
        endDate: "2027-01-20",
      },
    });
    expect(datesOf("gas")).toEqual(["2026-11-20", "2026-12-20", "2027-01-20"]);
  });

  it("draft + addItem creates a clip + item at the playhead day", () => {
    const { core, bridge } = setup();
    core.setPlayPosition(10.6);
    const draft = bridge.createDraftItem("expense");
    expect(bridge.getItem(draft.id)).toBeNull();
    const id = bridge.addItem(draft);
    expect(core.getState().clips.some((c) => c.id === id)).toBe(true);
    expect(bridge.getItem(id)?.recurrence.startDate).toBe("2026-11-17");
    core.undo();
    expect(bridge.getItem(id)).toBeNull();
    core.redo();
    expect(bridge.getItem(id)?.recurrence.startDate).toBe("2026-11-17");
  });

  it("initial cash and reserve edits recompute", () => {
    const { bridge } = setup();
    const before = bridge.getProjection().finalCash;
    bridge.setInitialCash(6000);
    expect(bridge.getProjection().finalCash).toBeCloseTo(before + 1000, 2);
    bridge.setMinimumCashReserve(1_000_000);
    expect(bridge.getWarnings().length).toBeGreaterThan(0);
  });

  it("deleteItem removes the clip and the item", () => {
    const { core, bridge } = setup();
    bridge.deleteItem("gas");
    expect(core.getState().clips.some((c) => c.id === "gas")).toBe(false);
    expect(bridge.getItem("gas")).toBeNull();
  });

  it("clip detail shows amount and frequency", () => {
    const { bridge } = setup();
    expect(bridge.getClipDetail("sal")).toContain("9,000");
    expect(bridge.getClipDetail("nope")).toBeNull();
  });
});

describe("FinancialBridge — review regressions", () => {
  it("SYNC-1: a reused clip id never resurrects a deleted item", async () => {
    const { core, bridge, trackIndexOf } = setup();
    core.setClipSelection(["gas"]);
    core.copyToClipboard();
    core.pasteClipboard({ atTime: 40, atTrackIndex: trackIndexOf("gas") });
    await flush();
    core.undo();
    core.setClipSelection(["sal"]);
    core.copyToClipboard();
    core.pasteClipboard({ atTime: 50, atTrackIndex: trackIndexOf("sal") });
    await flush();
    const pasted = core
      .getState()
      .clips.find((c) => !["sal", "gas", "loan"].includes(c.id))!;
    const item = bridge.getItem(pasted.id);
    expect(item?.kind).toBe("income");
    expect(item && item.kind === "income" ? item.amount : 0).toBe(9000);
  });

  it("SYNC-2: slicing never splits a one-time event", () => {
    const { core, bridge, events } = setup();
    const before = events().filter((e) => e.includes("|expense|"));
    const finalCash = bridge.getProjection().finalCash;
    core.sliceClipsAtTime(15);
    expect(events().filter((e) => e.includes("|expense|"))).toEqual(before);
    expect(bridge.getProjection().finalCash).toBe(finalCash);
  });

  it("SYNC-3: slicing never duplicates a card / MSI / loan-with-balance debt", () => {
    const { core, bridge } = setup(createDemoFinancialDocument("2026-11-07"));
    const debt = bridge.getProjection().initialDebt;
    core.sliceClipsAtTime(60);
    expect(bridge.getProjection().initialDebt).toBe(debt);
  });

  it("SYNC-4: a finite end on the horizon date survives unrelated edits and saves", () => {
    const doc = makeDoc();
    doc.items.push({
      id: "car",
      kind: "loan",
      name: "Auto",
      paymentAmount: 3000,
      recurrence: {
        frequency: "monthly",
        startDate: "2026-11-07",
        endDate: "2027-11-07",
      },
    });
    const { core, bridge, trackIndexOf } = setup(doc);
    core.moveClips([{ id: "gas", start: 20, trackIndex: trackIndexOf("gas") }]);
    expect(bridge.getItem("car")?.recurrence.endDate).toBe("2027-11-07");
    bridge.replaceItem({ ...bridge.getItem("car")!, name: "Auto 2" });
    expect(bridge.getItem("car")?.recurrence.endDate).toBe("2027-11-07");
  });

  it("SYNC-5: paste of an edited copy clones the edited copy", async () => {
    const { core, bridge, trackIndexOf } = setup();
    core.setClipSelection(["gas"]);
    core.copyToClipboard();
    core.pasteClipboard({ atTime: 40, atTrackIndex: trackIndexOf("gas") });
    await flush();
    const copyId = core
      .getState()
      .clips.find((c) => !["sal", "gas", "loan"].includes(c.id))!.id;
    const copy = bridge.getItem(copyId)!;
    if (copy.kind !== "expense") throw new Error("bad copy");
    bridge.replaceItem({ ...copy, amount: 3333 });
    core.setClipSelection([copyId]);
    core.copyToClipboard();
    core.pasteClipboard({ atTime: 80, atTrackIndex: trackIndexOf(copyId) });
    await flush();
    const second = core
      .getState()
      .clips.find((c) => !["sal", "gas", "loan", copyId].includes(c.id))!;
    const item = bridge.getItem(second.id);
    expect(item && item.kind === "expense" ? item.amount : 0).toBe(3333);
  });

  it("SYNC-6: open-ended survives move + undo, paste and slow drags", async () => {
    const doc = makeDoc();
    doc.items.push({
      id: "gym",
      kind: "expense",
      name: "Gym",
      amount: 300,
      recurrence: { frequency: "weekly", startDate: "2026-11-09" },
    });
    const { core, bridge, trackIndexOf, datesOf } = setup(doc);
    const original = datesOf("gym");
    core.moveClips([{ id: "gym", start: 0, trackIndex: trackIndexOf("gym") }]);
    await flush();
    expect(bridge.getItem("gym")?.recurrence.endDate).toBeUndefined();
    core.resizeClip("gym", "right", 400);
    await flush();
    core.undo();
    expect(bridge.getItem("gym")?.recurrence.endDate).toBeUndefined();
    core.undo();
    expect(datesOf("gym")).toEqual(original);
    for (let i = 1; i <= 20; i += 1) {
      core.moveClips([
        { id: "gym", start: 2 - i * 0.1, trackIndex: trackIndexOf("gym") },
      ]);
    }
    await flush();
    expect(bridge.getItem("gym")?.recurrence.endDate).toBeUndefined();
    core.setClipSelection(["gym"]);
    core.copyToClipboard();
    core.pasteClipboard({ atTime: 0, atTrackIndex: trackIndexOf("gym") });
    await flush();
    const pasted = core
      .getState()
      .clips.find((c) => c.id !== "gym" && bridge.getItem(c.id)?.name === "Gym")!;
    expect(bridge.getItem(pasted.id)?.recurrence.endDate).toBeUndefined();
  });

  it("SYNC-7: a window entirely in the past is never rewritten", () => {
    const doc = makeDoc();
    doc.items.push({
      id: "old",
      kind: "loan",
      name: "Viejo",
      paymentAmount: 777,
      balance: 0,
      recurrence: {
        frequency: "monthly",
        startDate: "2026-01-07",
        endDate: "2026-10-07",
      },
    });
    const { core, bridge, trackIndexOf, events } = setup(doc);
    core.moveClips([{ id: "gas", start: 20, trackIndex: trackIndexOf("gas") }]);
    expect(bridge.getItem("old")?.recurrence.endDate).toBe("2026-10-07");
    expect(events().some((e) => e.includes("Viejo"))).toBe(false);
  });

  it("SYNC-8: switching to once lands on the date shown, not a stale anchor", () => {
    const { core, bridge, datesOf } = setup();
    core.resizeClip("sal", "left", 13); // window 2026-11-20…, anchor 2026-11-13
    const sal = bridge.getItem("sal")!;
    bridge.replaceItem({
      ...sal,
      recurrence: {
        ...sal.recurrence,
        frequency: "once",
        endDate: sal.recurrence.startDate,
      },
    });
    expect(datesOf("sal")).toEqual(["2026-11-20"]);
  });

  it("SYNC-9: undo / redo of an editor save restores the item exactly", () => {
    const { core, bridge, datesOf } = setup();
    const before = datesOf("sal");
    const sal = bridge.getItem("sal")!;
    bridge.replaceItem({
      ...sal,
      recurrence: { frequency: "once", startDate: "2026-11-13", endDate: "2026-11-13" },
    });
    expect(datesOf("sal")).toEqual(["2026-11-13"]);
    core.undo();
    expect(datesOf("sal")).toEqual(before);
    core.redo();
    expect(datesOf("sal")).toEqual(["2026-11-13"]);
  });

  it("amount-only edits are their own undo step", () => {
    const { core, bridge } = setup();
    const sal = bridge.getItem("sal")!;
    if (sal.kind !== "income") throw new Error("bad fixture");
    bridge.replaceItem({ ...sal, amount: 11000 });
    core.undo();
    const undone = bridge.getItem("sal")!;
    expect(undone.kind === "income" ? undone.amount : 0).toBe(9000);
    core.redo();
    const redone = bridge.getItem("sal")!;
    expect(redone.kind === "income" ? redone.amount : 0).toBe(11000);
  });

  it("SYNC-10: grouped siblings dragged by an editor save update their items", () => {
    const { core, bridge, clip } = setup();
    core.setClipSelection(["gas", "loan"]);
    core.groupSelection();
    const gas = bridge.getItem("gas")!;
    bridge.replaceItem({
      ...gas,
      recurrence: { frequency: "once", startDate: "2026-12-01", endDate: "2026-12-01" },
    });
    expect(bridge.getItem("loan")?.recurrence.startDate).toBe(
      bridge.dateAtBeat(clip("loan").start),
    );
  });

  it("SYNC-11: a generic clip and its fix-up undo in one step", async () => {
    const { core, bridge, trackIndexOf } = setup();
    const id = core.createClip({
      trackIndex: trackIndexOf("gas"),
      start: 50,
      duration: 4,
      label: "Clip",
      color: "#7aa6d8",
    });
    await flush();
    expect(bridge.getItem(id)?.name).toBe("Gasto");
    core.undo();
    expect(core.getState().clips.some((c) => c.id === id)).toBe(false);
    expect(bridge.getItem(id)).toBeNull();
  });

  it("SYNC-13: saves and deletes on a locked track are refused", () => {
    const { core, bridge, trackIndexOf } = setup();
    core.toggleTrackLock(trackIndexOf("gas"));
    expect(bridge.isItemLocked("gas")).toBe(true);
    const gas = bridge.getItem("gas")!;
    expect(bridge.replaceItem({ ...gas, name: "Renta" })).toBe(false);
    expect(bridge.getItem("gas")?.name).toBe("Gasto");
    expect(bridge.deleteItem("gas")).toBe(false);
    expect(bridge.getItem("gas")).not.toBeNull();
  });

  it("SYNC-14: addItem never lands on a muted lane as an enabled item", () => {
    const { core, bridge, trackIndexOf } = setup();
    core.toggleTrackMute(trackIndexOf("gas"));
    core.setPlayPosition(100);
    const id = bridge.addItem(bridge.createDraftItem("expense"));
    const created = core.getState().clips.find((c) => c.id === id)!;
    const track = core.getState().tracks.find((t) => t.id === created.trackId)!;
    expect(track.muted === true).toBe(bridge.getItem(id)?.enabled === false);
  });

  it("demo document round-trips: an unrelated edit changes no other item", () => {
    const doc = createDemoFinancialDocument("2026-11-07");
    const { core, bridge, trackIndexOf, events } = setup(doc);
    const gasto = doc.items.find((i) => i.name === "Gasto")!;
    const before = events().filter((e) => !e.endsWith("|Gasto"));
    core.moveClips([{ id: gasto.id, start: 30, trackIndex: trackIndexOf(gasto.id) }]);
    expect(events().filter((e) => !e.endsWith("|Gasto"))).toEqual(before);
    expect(bridge.getItem(gasto.id)?.recurrence.startDate).toBe("2026-12-07");
  });
});

describe("FinancialBridge — second review regressions", () => {
  it("R2-BRIDGE-1: a creation folded into a gesture undoes in one step", async () => {
    const { core, bridge, trackIndexOf } = setup();
    core.beginGesture();
    const id = core.createClip({
      trackIndex: trackIndexOf("gas"),
      start: 60,
      duration: 4,
      label: "Clip",
      color: "#7aa6d8",
    });
    await flush();
    core.endGesture();
    expect(bridge.getItem(id)).not.toBeNull();
    core.undo();
    expect(core.getState().clips.some((c) => c.id === id)).toBe(false);
    expect(bridge.getItem(id)).toBeNull();
  });

  it("R2-BRIDGE-1: after an undo lands on an uncorrected clip, it is corrected", async () => {
    const { core, bridge, trackIndexOf } = setup();
    const id = core.createClip({
      trackIndex: trackIndexOf("gas"),
      start: 60,
      duration: 4,
      label: "Clip",
      color: "#7aa6d8",
    });
    core.beginGesture();
    await flush();
    core.endGesture();
    core.undo(); // back to the raw createClip state
    await flush();
    const clip = core.getState().clips.find((c) => c.id === id);
    if (clip) {
      expect(clip.noSlice).toBe(true);
      expect(clip.label).toBe(bridge.getItem(id)?.name);
    }
  });

  it("R2-BRIDGE-2: pasting an open-ended copy after its source changed length", async () => {
    const doc = createDemoFinancialDocument("2026-11-07");
    const { core, bridge, trackIndexOf } = setup(doc);
    const id = "fin-sueldo";
    core.moveClips([{ id, start: 10, trackIndex: trackIndexOf(id) }]);
    await flush();
    core.setClipSelection([id]);
    core.copyToClipboard();
    core.moveClips([{ id, start: 20, trackIndex: trackIndexOf(id) }]);
    await flush();
    core.pasteClipboard({ atTime: 0, atTrackIndex: trackIndexOf(id) });
    await flush();
    const pasted = core
      .getState()
      .clips.find((c) => c.id !== id && bridge.getItem(c.id)?.name === "Sueldo");
    expect(pasted).toBeDefined();
    expect(bridge.getItem(pasted!.id)?.recurrence.endDate).toBeUndefined();
  });

  it("R2-BRIDGE-3: a past-dated one-time event is dated where it is moved / pasted", async () => {
    const doc = makeDoc();
    doc.items.push({
      id: "old",
      kind: "expense",
      name: "Viejo",
      amount: 4000,
      recurrence: { frequency: "once", startDate: "2026-10-01", endDate: "2026-10-01" },
    });
    const { core, bridge, trackIndexOf } = setup(doc);
    core.moveClips([{ id: "old", start: 10, trackIndex: trackIndexOf("old") }]);
    expect(bridge.getItem("old")?.recurrence.startDate).toBe("2026-11-17");
    await flush();
    expect(core.getState().clips.find((c) => c.id === "old")?.contentOffset ?? 0).toBe(0);
    core.setClipSelection(["old"]);
    core.copyToClipboard();
    core.pasteClipboard({ atTime: 50, atTrackIndex: trackIndexOf("old") });
    const pasted = core
      .getState()
      .clips.find((c) => c.id !== "old" && bridge.getItem(c.id)?.name === "Viejo")!;
    expect(bridge.getItem(pasted.id)?.recurrence.startDate).toBe("2026-12-27");
  });

  it("R2-BRIDGE-5: an off-grid one-time event is not rewritten by unrelated edits", () => {
    const { core, bridge, trackIndexOf } = setup();
    core.moveClips([{ id: "gas", start: 20.4, trackIndex: trackIndexOf("gas") }]);
    const item = bridge.getItem("gas");
    const revision = bridge.getRevision();
    core.renameTrack(0, "Renamed");
    expect(bridge.getItem("gas")).toBe(item);
    expect(bridge.getRevision()).toBe(revision);
  });

  it("R2-BRIDGE-6 / PERF2-5: a window parked past the horizon is not re-pinned forever", async () => {
    const { core, trackIndexOf } = setup();
    core.moveClips([{ id: "sal", start: 400, trackIndex: trackIndexOf("sal") }]);
    await flush();
    const parked = core.getState().clips.find((c) => c.id === "sal")!;
    expect(parked.duration).toBeGreaterThan(1);
    let notifies = 0;
    core.subscribe(() => {
      notifies += 1;
    });
    for (let i = 0; i < 5; i += 1) {
      core.renameTrack(0, `T${i}`);
      await flush();
    }
    expect(notifies).toBe(5);
  });

  it("R2-BRIDGE-7: dragging an edge in and back out in one gesture keeps it open-ended", async () => {
    const { core, bridge } = setup();
    const doc = bridge.getDocument();
    const openEnd = openEndBeat(doc);
    core.beginGesture();
    core.resizeClip("sal", "right", openEnd - 20);
    await flush();
    core.resizeClip("sal", "right", openEnd + 15);
    await flush();
    core.endGesture();
    await flush();
    expect(bridge.getItem("sal")?.recurrence.endDate).toBeUndefined();
  });

  it("R2-BRIDGE-8: initial cash and reserve edits are undo steps", () => {
    const { core, bridge, trackIndexOf } = setup();
    core.moveClips([{ id: "gas", start: 40, trackIndex: trackIndexOf("gas") }]);
    bridge.setInitialCash(50000);
    bridge.setMinimumCashReserve(2500);
    core.undo();
    expect(bridge.getDocument().minimumCashReserve).toBe(1000);
    expect(bridge.getDocument().initialCash).toBe(50000);
    core.undo();
    expect(bridge.getDocument().initialCash).toBe(5000);
    expect(bridge.getItem("gas")?.recurrence.startDate).toBe("2026-12-17");
    core.redo();
    core.redo();
    expect(bridge.getDocument().initialCash).toBe(50000);
    expect(bridge.getDocument().minimumCashReserve).toBe(2500);
  });

  it("PERF2-1: corrections after a bulk slice cost a constant number of notifies", async () => {
    const doc = makeDoc();
    for (let i = 0; i < 150; i += 1) {
      doc.items.push({
        id: `w${i}`,
        kind: "expense",
        name: `W${i}`,
        amount: 10,
        recurrence: { frequency: "weekly", startDate: "2026-11-09" },
      });
    }
    const { core } = setup(doc);
    core.sliceClipsAtTime(100);
    let notifies = 0;
    core.subscribe(() => {
      notifies += 1;
    });
    await flush();
    expect(notifies).toBeLessThanOrEqual(3);
    const sources = core.getState().clips.map((c) => c.sourceId);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("PERF2-4: a future MSI's sparkline has no debt-opening bar", () => {
    const doc = makeDoc();
    doc.items.push({
      id: "msi",
      kind: "installment-plan",
      name: "MSI",
      originalAmount: 6000,
      installmentsTotal: 6,
      installmentsPaid: 0,
      recurrence: { frequency: "monthly", startDate: "2027-03-01" },
    });
    const { bridge } = setup(doc);
    const bars = bridge.getClipSparkline("msi")!;
    expect(bars.length).toBe(6);
    expect(new Set(bars).size).toBe(1);
  });

  it("PERF2-5: a draft created past the horizon starts on its last day", () => {
    const { core, bridge } = setup();
    core.setPlayPosition(400);
    const draft = bridge.createDraftItem("income");
    expect(bridge.beatAtDate(draft.recurrence.startDate)).toBeLessThan(
      openEndBeat(bridge.getDocument()),
    );
  });
});

describe("FinancialBridge — Ola 1 renderer providers", () => {
  it("overview: cash curve with reserve/zero thresholds, stable across UI-only notifies", () => {
    const { core, bridge } = setup();
    const data = bridge.getOverviewData();
    expect(data.title).toBe("Caja");
    expect(data.primary.initial).toBe(5000);
    expect(data.thresholds.map((t) => t.tone)).toEqual(["warning", "danger"]);
    core.setHover({ kind: "clip", clipId: "sal" });
    core.setPlayPosition(30);
    expect(bridge.getOverviewData()).toBe(data);
  });

  it("overview: valleys are annotated where they happen", () => {
    const { bridge } = setup();
    bridge.setMinimumCashReserve(1_000_000);
    const data = bridge.getOverviewData();
    expect(data.annotations.length).toBeGreaterThan(0);
    expect(data.annotations[0]!.tone).toBe("warning");
  });

  it("during a gesture: ghost baseline + effect pill; gone after it", () => {
    const { core, bridge, trackIndexOf } = setup();
    expect(bridge.getDragAnnotation()).toBeNull();
    core.beginGesture();
    core.moveClips([{ id: "gas", start: 40, trackIndex: trackIndexOf("gas") }]);
    const overview = bridge.getOverviewData();
    expect(overview.baseline).not.toBeNull();
    const pill = bridge.getDragAnnotation();
    expect(pill).not.toBeNull();
    expect(bridge.getDragAnnotation()).toBe(pill);
    core.endGesture();
    expect(bridge.getDragAnnotation()).toBeNull();
    expect(bridge.getOverviewData().baseline).toBeNull();
  });

  it("drag pill says when you get out of the red", () => {
    const doc = makeDoc();
    doc.initialCash = 3000;
    const { core, bridge, trackIndexOf } = setup(doc);
    // gas (−2000 on 2026-11-20) before the first payday (11-13)? move it
    // from after the payday to before it and back.
    core.moveClips([{ id: "gas", start: 2, trackIndex: trackIndexOf("gas") }]);
    expect(bridge.getProjection().minimumCash.cash).toBeLessThan(0);
    core.beginGesture();
    core.moveClips([{ id: "gas", start: 20, trackIndex: trackIndexOf("gas") }]);
    const pill = bridge.getDragAnnotation()!;
    expect(pill.tone).toBe("positive");
    expect(pill.text).toContain("sales del rojo");
    core.endGesture();
  });

  it("clip content: payments at their real dates; identity kept when unaffected", () => {
    const { core, bridge, trackIndexOf } = setup();
    const salary = bridge.getClipContent("sal");
    expect(salary?.kind).toBe("events");
    if (salary?.kind !== "events") throw new Error("expected events");
    expect(salary.beats[0]).toBe(6); // 2026-11-13
    expect(salary.values.every((v) => v > 0)).toBe(true);
    const gas = bridge.getClipContent("gas");
    if (gas?.kind !== "events") throw new Error("expected events");
    expect(gas.values[0]!).toBeLessThan(0);
    core.moveClips([{ id: "gas", start: 30, trackIndex: trackIndexOf("gas") }]);
    expect(bridge.getClipContent("sal")).toBe(salary);
    expect(bridge.getClipContent("gas")).not.toBe(gas);
  });

  it("clip content: a card shows its debt melting (level)", () => {
    const { bridge } = setup(createDemoFinancialDocument("2026-11-07"));
    const nu = bridge.getClipContent("fin-nu");
    expect(nu?.kind).toBe("level");
    if (nu?.kind !== "level") throw new Error("expected level");
    expect(nu.series.initial).toBe(30069);
    expect(nu.max).toBeGreaterThanOrEqual(30069);
  });

  it("track meta: cards tell when you're free, incomes their yearly impact", () => {
    const { core, bridge } = setup(createDemoFinancialDocument("2026-11-07"));
    const trackOf = (id: string) =>
      core.getState().clips.find((c) => c.id === id)!.trackId;
    const nu = bridge.getTrackMeta(trackOf("fin-nu"));
    expect(nu?.subtitle).toMatch(/Libre|No se liquida/);
    const salary = bridge.getTrackMeta(trackOf("fin-sueldo"));
    expect(salary?.subtitle?.startsWith("+")).toBe(true);
    expect(salary?.meter).toBe(1);
    expect(bridge.getTrackMeta(trackOf("fin-sueldo"))).toBe(salary);
  });

  it("clip detail follows the playhead day", () => {
    const { core, bridge } = setup(createDemoFinancialDocument("2026-11-07"));
    const today = bridge.getClipDetail("fin-nu");
    expect(today).toContain("Debes $30,069");
    core.setPlayPosition(200);
    const later = bridge.getClipDetail("fin-nu");
    expect(later).not.toBe(today);
    expect(later).toContain("Debes");
    core.setPlayPosition(200.7);
    expect(bridge.getClipDetail("fin-nu")).toBe(later);
  });
});
