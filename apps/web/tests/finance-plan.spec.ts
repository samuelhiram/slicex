// @vitest-environment jsdom
// Wave 3–4 plumbing: persistence, how a session starts (first visit vs a
// plan saved days ago, rolled forward), alternative futures and the "Rec"
// corrections, and the 60-second onboarding.
import { beforeEach, describe, expect, it } from "vitest";
import {
  addDays,
  createDemoFinancialDocument,
  rollForward,
  type FinancialDocument,
} from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import { FinancialBridge } from "../src/finance/financial-bridge";
import { FINANCE_PLAYLIST_METRICS, createFinancialPlaylistState } from "../src/finance/mapping";
import {
  PLAN_STORAGE_KEY,
  loadPlan,
  parsePlan,
  savePlan,
  type SavedPlan,
} from "../src/finance/persistence";
import { applyRecCorrections, bootstrapPlan } from "../src/finance/bootstrap";
import { Futures, MAIN_BRANCH_ID } from "../src/finance/futures";
import { buildYear, nextDayOfMonth } from "../src/finance/components/Onboarding";

const TODAY = "2026-11-20";
const SAVED_ON = "2026-11-07";

function setup(doc: FinancialDocument) {
  const core = createPlaylistCore(createFinancialPlaylistState(doc), {
    metrics: FINANCE_PLAYLIST_METRICS,
    stretchEnabled: false,
  });
  return { core, bridge: new FinancialBridge(core, doc) };
}

function savedPlan(doc: FinancialDocument): SavedPlan {
  return {
    v: 1,
    activeId: MAIN_BRANCH_ID,
    compareId: null,
    branches: [{ id: MAIN_BRANCH_ID, name: "Plan principal", forkDate: null, doc }],
    ledger: [],
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("persistence", () => {
  it("round-trips a plan and rejects garbage", () => {
    const plan = savedPlan(createDemoFinancialDocument(SAVED_ON));
    expect(savePlan(plan)).toBe(true);
    expect(loadPlan()).toEqual(plan);
    localStorage.setItem(PLAN_STORAGE_KEY, "{not json");
    expect(loadPlan()).toBeNull();
    expect(parsePlan(JSON.stringify({ v: 2, branches: [] }))).toBeNull();
    expect(parsePlan(JSON.stringify({ v: 1, branches: [{ id: "x", name: "x", doc: {} }] }))).toBeNull();
  });

  it("repairs a dangling active / compare id", () => {
    const plan = savedPlan(createDemoFinancialDocument(SAVED_ON));
    const parsed = parsePlan(JSON.stringify({ ...plan, activeId: "nope", compareId: "nope" }))!;
    expect(parsed.activeId).toBe(MAIN_BRANCH_ID);
    expect(parsed.compareId).toBeNull();
  });
});

describe("how a session starts", () => {
  it("first visit: the example year and the onboarding", () => {
    const boot = bootstrapPlan(TODAY, null);
    expect(boot.firstVisit).toBe(true);
    expect(boot.doc.startDate).toBe(TODAY);
    expect(boot.rec).toBeNull();
  });

  it("a plan saved days ago is rolled to today, assuming everything happened", () => {
    const old = createDemoFinancialDocument(SAVED_ON);
    const boot = bootstrapPlan(TODAY, savedPlan(old));
    expect(boot.firstVisit).toBe(false);
    expect(boot.doc.startDate).toBe(TODAY);
    expect(boot.rec?.since).toBe(SAVED_ON);
    expect(boot.rec!.pending.length).toBeGreaterThan(0);
    expect(boot.doc.initialCash).toBe(rollForward(old, TODAY).doc.initialCash);
    expect(boot.saved!.ledger.length).toBe(boot.rec!.ledger.length);
  });

  it("a plan saved today needs nothing", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const boot = bootstrapPlan(TODAY, savedPlan(doc));
    expect(boot.rec).toBeNull();
    expect(boot.doc).toBe(doc);
  });
});

describe("Rec: corrections keep later edits", () => {
  it("a skipped expense gives the cash back; a real balance overrides", () => {
    const old = createDemoFinancialDocument(SAVED_ON);
    const boot = bootstrapPlan(TODAY, savedPlan(old));
    const { bridge } = setup(boot.doc);
    // An edit made after loading must survive the correction.
    bridge.setMinimumCashReserve(7777);
    const expense = boot.rec!.pending.find((p) => p.itemId === "fin-pago-plata")!;
    const cashBefore = bridge.getDocument().initialCash;
    const ledger = applyRecCorrections(bridge, boot.rec!, TODAY, [
      { eventId: expense.eventId, status: "skipped" },
    ], undefined);
    expect(bridge.getDocument().initialCash).toBeCloseTo(cashBefore - expense.cashDelta, 2);
    expect(bridge.getDocument().minimumCashReserve).toBe(7777);
    expect(ledger.find((e) => e.eventId === expense.eventId)?.status).toBe("skipped");

    applyRecCorrections(bridge, boot.rec!, TODAY, [], 1234);
    expect(bridge.getDocument().initialCash).toBeCloseTo(
      cashBefore - expense.cashDelta + (1234 - cashBefore),
      2,
    );
  });
});

describe("futures (alternative versions of the year)", () => {
  it("fork, edit, switch back and forth: each future keeps its plan", () => {
    const { bridge } = setup(createDemoFinancialDocument(TODAY));
    const futures = new Futures(bridge);
    expect(futures.list()).toHaveLength(1);
    expect(futures.peekTarget()).toBeNull();
    const branch = futures.fork(addDays(TODAY, 30));
    expect(futures.getActiveId()).toBe(branch.id);
    expect(futures.getCompareId()).toBe(MAIN_BRANCH_ID);
    expect(bridge.getComparison()).not.toBeNull();
    bridge.setInitialCash(99_999);
    futures.switchTo(MAIN_BRANCH_ID);
    expect(bridge.getDocument().initialCash).toBe(12_000);
    expect(bridge.isAnimating()).toBe(true);
    expect(futures.peekTarget()?.id).toBe(branch.id);
    futures.switchTo(branch.id);
    expect(bridge.getDocument().initialCash).toBe(99_999);
    const saved = futures.toSaved();
    expect(saved.branches.map((b) => b.doc.initialCash)).toEqual([12_000, 99_999]);
    futures.remove(branch.id);
    expect(futures.list()).toHaveLength(1);
    expect(bridge.getDocument().initialCash).toBe(12_000);
  });

  it("restores parked futures from a save and loads them on demand", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const { bridge } = setup(doc);
    const plan: SavedPlan = {
      v: 1,
      activeId: MAIN_BRANCH_ID,
      compareId: "rama-1",
      branches: [
        { id: MAIN_BRANCH_ID, name: "Plan principal", forkDate: null, doc },
        { id: "rama-1", name: "Sin coche", forkDate: TODAY, doc: { ...doc, initialCash: 1 } },
      ],
      ledger: [],
    };
    const futures = new Futures(bridge, plan);
    expect(bridge.getComparison()?.initialCash).toBe(1);
    futures.switchTo("rama-1");
    expect(bridge.getDocument().initialCash).toBe(1);
    expect(futures.fork(TODAY).id).toBe("rama-2");
  });
});

describe("tu año en 60 segundos", () => {
  it("builds a year from three answers (+ fixed expenses, + the Mexican year)", () => {
    const doc = buildYear(TODAY, {
      cash: 15_000,
      frequency: "semimonthly",
      pay: 10_000,
      nextPay: TODAY,
      reserve: 5_000,
      fixed: [{ name: "Renta", amount: 8000, day: 1 }],
      withSuggestions: true,
    });
    expect(doc.startDate).toBe(TODAY);
    expect(doc.initialCash).toBe(15_000);
    expect(doc.minimumCashReserve).toBe(5_000);
    const rent = doc.items.find((i) => i.name === "Renta")!;
    expect(rent.recurrence).toEqual({ frequency: "monthly", startDate: "2026-12-01" });
    expect(doc.items.some((i) => i.name === "Aguinaldo")).toBe(true);
    const plain = buildYear(TODAY, {
      cash: 0,
      frequency: "weekly",
      pay: 3000,
      nextPay: "2026-11-27",
      reserve: 0,
      fixed: [],
      withSuggestions: false,
    });
    expect(plain.items).toHaveLength(1);
    expect(plain.items[0]!.recurrence.anchorDate).toBe("2026-11-27");
  });

  it("nextDayOfMonth clamps to the month and never goes back", () => {
    expect(nextDayOfMonth("2026-11-20", 1)).toBe("2026-12-01");
    expect(nextDayOfMonth("2026-11-20", 20)).toBe("2026-11-20");
    expect(nextDayOfMonth("2027-02-10", 31)).toBe("2027-02-28");
  });
});

describe("tracks are a place (endless rows, never removed by themselves)", () => {
  const renta = {
    id: "",
    kind: "expense" as const,
    name: "Renta",
    amount: 8000,
    recurrence: { frequency: "monthly" as const, startDate: "2026-12-01" },
  };

  it("an empty, renamed row and every placement survive a save + reload", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const { core, bridge } = setup(doc);
    core.insertTrackBelow(0);
    core.renameTrack(1, "Ahorro");
    const before = core.getState();
    const layout = bridge.getTrackLayout();
    expect(layout.tracks.map((track) => track.label)).toContain("Ahorro");

    savePlan({ ...savedPlan(bridge.getDocument()), branches: [{ ...savedPlan(doc).branches[0]!, layout }] });
    const plan = bootstrapPlan(TODAY, loadPlan());
    const state = createFinancialPlaylistState(plan.doc, plan.layout);
    expect(state.tracks.map((track) => track.label)).toEqual(before.tracks.map((track) => track.label));
    expect(state.tracks[1]!.label).toBe("Ahorro");
    expect(state.clips.some((clip) => clip.trackId === state.tracks[1]!.id)).toBe(false);
    for (const clip of before.clips) {
      expect(state.clips.find((candidate) => candidate.id === clip.id)?.trackId).toBe(clip.trackId);
    }
  });

  it("deleting a row's only item leaves the row, also after a reload", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const { core, bridge } = setup(doc);
    const victim = core.getState().clips[0]!;
    const rows = core.getState().tracks.length;
    expect(bridge.deleteItem(victim.id)).toBe(true);
    expect(core.getState().tracks.length).toBe(rows);
    const state = createFinancialPlaylistState(bridge.getDocument(), bridge.getTrackLayout());
    expect(state.tracks.length).toBe(rows);
    expect(state.tracks.some((track) => track.id === victim.trackId)).toBe(true);
  });

  it("items without a usable placement get the default lanes below the saved rows", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const fresh = createFinancialPlaylistState(doc);
    const first = doc.items.find((item) => fresh.clips.some((clip) => clip.id === item.id))!;
    const layout = {
      tracks: [{ id: "mine", label: "Mío", color: "#123456" }],
      // A placement on a row that no longer exists is ignored.
      placement: { [first.id]: "gone" },
    };
    const state = createFinancialPlaylistState(doc, layout);
    expect(state.tracks[0]!.id).toBe("mine");
    expect(state.tracks.length).toBe(fresh.tracks.length + 1);
    expect(state.clips.find((clip) => clip.id === first.id)?.trackId).not.toBe("gone");
  });

  it("a stored layout is validated; garbage is dropped, not trusted", () => {
    const plan = savedPlan(createDemoFinancialDocument(SAVED_ON));
    const raw = {
      ...plan,
      branches: [
        {
          ...plan.branches[0]!,
          layout: {
            tracks: [{ id: "a", label: "A", color: "#111111" }, { id: "a" }, 7, { label: "sin id" }],
            placement: { x: "a", y: "nope", z: 3 },
          },
        },
      ],
    };
    const parsed = parsePlan(JSON.stringify(raw))!;
    expect(parsed.branches[0]!.layout).toEqual({
      tracks: [{ id: "a", label: "A", color: "#111111" }],
      placement: { x: "a" },
    });
    const junk = parsePlan(JSON.stringify({ ...plan, branches: [{ ...plan.branches[0]!, layout: "x" }] }))!;
    expect(junk.branches[0]!.layout).toBeUndefined();
  });

  it("each future keeps its own rows", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const { core, bridge } = setup(doc);
    const futures = new Futures(bridge);
    const branch = futures.fork(TODAY);
    core.insertTrackBelow(0);
    core.renameTrack(1, "Solo en la rama");
    futures.switchTo(MAIN_BRANCH_ID);
    expect(core.getState().tracks.some((track) => track.label === "Solo en la rama")).toBe(false);
    futures.switchTo(branch.id);
    expect(core.getState().tracks[1]!.label).toBe("Solo en la rama");
    const saved = futures.toSaved();
    expect(saved.branches.find((b) => b.id === branch.id)!.layout!.tracks[1]!.label).toBe(
      "Solo en la rama",
    );
    // A parked future restored from a save comes back with its rows.
    const { core: core2, bridge: bridge2 } = setup(doc);
    const restored = new Futures(bridge2, { ...saved, activeId: MAIN_BRANCH_ID });
    restored.switchTo(branch.id);
    expect(core2.getState().tracks[1]!.label).toBe("Solo en la rama");
  });

  it("'Nuevo … aquí' lands on the picked row: an endless one below, or an empty 'Track N'", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const { core, bridge } = setup(doc);
    const rows = core.getState().tracks.length;
    const id = bridge.addItem({ ...renta }, { trackIndex: rows + 2 });
    const state = core.getState();
    const clip = state.clips.find((c) => c.id === id)!;
    expect(state.tracks.findIndex((track) => track.id === clip.trackId)).toBe(rows + 2);
    expect(state.tracks[rows + 2]!.label).toBe("Renta");
    // The endless rows in between materialised as plain "Track N".
    expect(state.tracks[rows]!.label).toMatch(/^Track \d+$/);
    expect(bridge.getItem(id)?.name).toBe("Renta");

    // That empty "Track N" row takes the next item's name.
    const id2 = bridge.addItem({ ...renta, name: "Gym", amount: 500 }, { trackIndex: rows });
    expect(core.getState().clips.find((c) => c.id === id2)!.trackId).toBe(core.getState().tracks[rows]!.id);
    expect(core.getState().tracks[rows]!.label).toBe("Gym");

    // One undo entry per item.
    core.undo();
    expect(bridge.getItem(id2)).toBeNull();
    expect(bridge.getItem(id)).not.toBeNull();
  });

  it("a picked row that is busy at those dates falls back to a new lane", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const { core, bridge } = setup(doc);
    const busy = core.getState().clips.find((clip) => clip.duration > 60)!;
    const busyIndex = core.getState().tracks.findIndex((track) => track.id === busy.trackId);
    const id = bridge.addItem({ ...renta }, { trackIndex: busyIndex });
    const clip = core.getState().clips.find((c) => c.id === id)!;
    expect(clip.trackId).not.toBe(busy.trackId);
  });

  it("a draft can be dated on a given day", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const { bridge } = setup(doc);
    expect(bridge.createDraftItem("income", 10).recurrence.startDate).toBe(addDays(TODAY, 10));
  });
});

describe("saved rows", () => {
  it("untouched endless rows materialised at the end (e.g. by a right-click) are not saved", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const { core, bridge } = setup(doc);
    const rows = core.getState().tracks.length;
    core.openTrackContextMenu(rows + 5, { x: 10, y: 10 });
    core.closeContextMenu();
    const layout = bridge.getTrackLayout();
    expect(layout.tracks.length).toBe(rows);
    // A touched one is kept (and everything above it).
    core.insertTrackBelow(rows - 1);
    core.renameTrack(rows, "Ahorro");
    expect(bridge.getTrackLayout().tracks.length).toBe(rows + 1);
  });
});

describe("under the date: the cash and that day's movements", () => {
  it("cash line first, then each movement with its sign; cached until the plan changes", () => {
    const doc: FinancialDocument = {
      id: "d",
      name: "d",
      startDate: TODAY,
      initialCash: 1000,
      minimumCashReserve: 0,
      horizonMonths: 12,
      items: [
        { id: "sal", kind: "income", name: "Sueldo", amount: 9000, recurrence: { frequency: "monthly", startDate: addDays(TODAY, 5) } },
        { id: "rent", kind: "expense", name: "Renta", amount: 7500, recurrence: { frequency: "monthly", startDate: addDays(TODAY, 5) } },
      ],
    };
    const { bridge } = setup(doc);
    const detail = bridge.getDayDetail(5.4)!;
    expect(detail.split("\n")).toEqual(["Caja $2,500", "+$9,000 Sueldo", "−$7,500 Renta"]);
    // Same day, same projection: the same string.
    expect(bridge.getDayDetail(5.9)).toBe(detail);
    // A quiet day: just the cash.
    expect(bridge.getDayDetail(3)).toBe("Caja $1,000");
    bridge.setInitialCash(2000);
    expect(bridge.getDayDetail(5)!.split("\n")[0]).toBe("Caja $3,500");
    expect(bridge.getDayDetail(-5)).toBeNull();
  });
});

describe("an end 'hasta 1 sep' includes the payment of the 1st", () => {
  it("a monthly income on the 1st, end dragged to the day after the 1st", async () => {
    const doc: FinancialDocument = {
      id: "beca",
      name: "beca",
      startDate: TODAY,
      initialCash: 0,
      minimumCashReserve: 0,
      horizonMonths: 12,
      items: [
        {
          id: "beca",
          kind: "income",
          name: "beca",
          amount: 16000,
          recurrence: { frequency: "monthly", startDate: "2026-12-01" },
        },
      ],
    };
    const { core, bridge } = setup(doc);
    const sep2 = Math.round((Date.parse("2027-09-02") - Date.parse(TODAY)) / 86_400_000);
    core.resizeClip("beca", "right", sep2); // edge on the start of 2 sep = "hasta 1 sep"
    await Promise.resolve();
    expect(bridge.getItem("beca")?.recurrence.endDate).toBe("2027-09-01");
    const paid = bridge.snapshotAt("2027-09-01").cash - bridge.snapshotAt("2027-08-31").cash;
    expect(paid).toBe(16000);
    core.resizeClip("beca", "right", sep2 - 1); // "hasta 31 ago": the 1st is out
    await Promise.resolve();
    expect(bridge.snapshotAt("2027-09-01").cash - bridge.snapshotAt("2027-08-31").cash).toBe(0);
  });
});
