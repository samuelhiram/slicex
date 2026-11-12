// Waves 2–3 on the bridge:
//   - debts end where they're paid off; dragging that end is a goal-seek;
//   - amount by hand (vertical drag) = one undo entry;
//   - valleys explained + fixes;
//   - previews (without an item / with a draft / another future), comparison
//     ghost, the switch morph;
//   - sessions: load a document, export / import with its own undo history.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDemoFinancialDocument,
  estimateDebtPayoffs,
  type CreditCardItem,
  type FinancialDocument,
} from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import { isAutoRowLabel } from "../src/finance/labels";
import { FinancialBridge, levelValue, niceAmount } from "../src/finance/financial-bridge";
import {
  FINANCE_PLAYLIST_METRICS,
  beatOf,
  createFinancialPlaylistState,
  isPayoffPinned,
  openEndBeat,
} from "../src/finance/mapping";

const START = "2026-11-07";
const flush = () => Promise.resolve();

function cardDoc(): FinancialDocument {
  return {
    id: "w",
    name: "waves",
    startDate: START,
    initialCash: 20000,
    minimumCashReserve: 2000,
    horizonMonths: 12,
    items: [
      {
        id: "sal",
        kind: "income",
        name: "Sueldo",
        amount: 9000,
        recurrence: { frequency: "semimonthly", startDate: START },
      },
      {
        id: "card",
        kind: "credit-card",
        name: "Tarjeta",
        balance: 6000,
        annualRate: 40,
        cutDay: 15,
        dueDay: 26,
        minimumPayment: 500,
        paymentAmount: 1000,
        recurrence: { frequency: "monthly", startDate: START },
      },
      {
        id: "loan",
        kind: "loan",
        name: "Préstamo",
        paymentAmount: 1500,
        recurrence: { frequency: "monthly", startDate: "2026-11-10", endDate: "2027-04-10" },
      },
    ],
  };
}

function setup(doc: FinancialDocument = cardDoc()) {
  const core = createPlaylistCore(createFinancialPlaylistState(doc), {
    metrics: FINANCE_PLAYLIST_METRICS,
    stretchEnabled: false,
  });
  const bridge = new FinancialBridge(core, doc);
  const clip = (id: string) => core.getState().clips.find((c) => c.id === id)!;
  return { core, bridge, clip };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("debts end where they're paid off", () => {
  it("cards / open balance loans are payoff-pinned; window loans and others are not", () => {
    const doc = cardDoc();
    expect(isPayoffPinned(doc.items[1]!)).toBe(true);
    expect(isPayoffPinned(doc.items[2]!)).toBe(false);
    expect(isPayoffPinned(doc.items[0]!)).toBe(false);
  });

  it("the card clip is pinned to its payoff right after load", async () => {
    const { bridge, clip } = setup();
    await flush();
    const payoff = estimateDebtPayoffs(bridge.getDocument()).get("card")!.payoffDate!;
    const end = clip("card").start + clip("card").duration;
    expect(end).toBe(beatOf(bridge.getDocument(), payoff) + 1);
    expect(end).toBeLessThan(openEndBeat(bridge.getDocument()));
  });

  it("a card that never pays off (payment below interest) stays open-ended", async () => {
    const doc = cardDoc();
    (doc.items[1] as CreditCardItem).paymentAmount = 150;
    (doc.items[1] as CreditCardItem).minimumPayment = 150;
    const { clip } = setup(doc);
    await flush();
    expect(clip("card").start + clip("card").duration).toBe(openEndBeat(doc));
  });
});

describe("goal-seek: drag the end of a debt to choose when you're free", () => {
  it("card: solves the payment live, shows it, and lands on the real payoff", async () => {
    const { core, bridge, clip } = setup();
    await flush();
    const before = (bridge.getItem("card") as CreditCardItem).paymentAmount!;
    const startEnd = clip("card").start + clip("card").duration;
    core.beginGesture();
    const target = startEnd - 60; // two months earlier
    core.resizeClip("card", "right", target);
    const after = bridge.getItem("card") as CreditCardItem;
    expect(after.paymentAmount).toBeGreaterThan(before);
    expect(after.recurrence.endDate).toBeUndefined();
    const pill = bridge.getDragAnnotation()!;
    // UX-13: the goal, the result and the payoff before the gesture.
    expect(pill.text).toMatch(/^Meta: .+ → Libre en .+ · pagas \$[\d,]+\/mes/);
    core.endGesture();
    await flush();
    const payoff = estimateDebtPayoffs(bridge.getDocument()).get("card")!.payoffDate!;
    const end = clip("card").start + clip("card").duration;
    expect(end).toBe(beatOf(bridge.getDocument(), payoff) + 1);
    expect(end).toBeLessThanOrEqual(target);
    // One undo entry restores the payment and the length.
    core.undo();
    await flush();
    expect((bridge.getItem("card") as CreditCardItem).paymentAmount).toBe(before);
  });

  it("window loan: moving the end keeps the total and spreads it", () => {
    const { core, bridge, clip } = setup();
    const total = 1500 * 6; // 10 nov … 10 abr
    core.beginGesture();
    const c = clip("loan");
    // End right after the 10 feb payment: 4 payments.
    core.resizeClip("loan", "right", beatOf(bridge.getDocument(), "2027-02-11"));
    const loan = bridge.getItem("loan")!;
    if (loan.kind !== "loan") throw new Error("loan");
    expect(loan.recurrence.endDate).toBe("2027-02-10");
    expect(loan.paymentAmount).toBe(2250);
    expect(loan.paymentAmount * 4).toBe(total);
    expect(bridge.getDragAnnotation()!.text).toContain("Libre en");
    core.endGesture();
    expect(c.id).toBe("loan");
  });

  it("an editor save that changes dates is never a goal-seek", () => {
    const { bridge } = setup();
    const loan = bridge.getItem("loan")!;
    if (loan.kind !== "loan") throw new Error("loan");
    bridge.replaceItem({ ...loan, recurrence: { ...loan.recurrence, endDate: "2027-02-10" } });
    const next = bridge.getItem("loan")!;
    if (next.kind !== "loan") throw new Error("loan");
    expect(next.paymentAmount).toBe(1500);
  });
});

describe("amount by hand", () => {
  it("niceAmount rounds to friendlier steps as amounts grow", () => {
    expect(niceAmount(57.4)).toBe(57);
    expect(niceAmount(434)).toBe(430);
    expect(niceAmount(9124)).toBe(9100);
    expect(niceAmount(12_340)).toBe(12_300);
    expect(niceAmount(0)).toBe(1);
  });

  it("drag up raises the amount live; the whole drag is ONE undo entry", () => {
    const { core, bridge } = setup();
    core.beginGesture();
    expect(bridge.levelDrag("sal", "start", 0)).toBe("+$9,000 /quincena");
    const text = bridge.levelDrag("sal", "move", 120 * Math.log(2));
    // UX-39: the amount it had when the drag started.
    expect(text).toBe("+$18,000 /quincena (antes $9,000)");
    bridge.levelDrag("sal", "move", 120 * Math.log(1.5));
    expect(levelValue(bridge.getItem("sal")!)).toBe(13_500);
    // The pill shows the effect against the drag's start.
    expect(bridge.getDragAnnotation()).not.toBeNull();
    bridge.levelDrag("sal", "end", 0);
    core.endGesture();
    expect(levelValue(bridge.getItem("sal")!)).toBe(13_500);
    core.undo();
    expect(levelValue(bridge.getItem("sal")!)).toBe(9000);
    core.redo();
    expect(levelValue(bridge.getItem("sal")!)).toBe(13_500);
  });

  it("a totalero card has no level", () => {
    const doc = cardDoc();
    (doc.items[1] as CreditCardItem).paymentMode = "statement";
    const { bridge } = setup(doc);
    expect(bridge.levelDrag("card", "start", 0)).toBe("Pagas el total de cada estado de cuenta");
    expect(bridge.levelDrag("card", "move", 80)).toBeNull();
    expect((bridge.getItem("card") as CreditCardItem).paymentAmount).toBe(1000);
  });
});

describe("valleys explain and fix themselves", () => {
  it("demo: the 27-nov valley has causes and a fix that removes it", () => {
    const doc = createDemoFinancialDocument(START);
    const { bridge } = setup(doc);
    const warnings = bridge.getWarnings();
    expect(warnings.length).toBeGreaterThan(0);
    const day = beatOf(doc, warnings[0]!.date);
    const insight = bridge.valleyAt(day)!;
    expect(insight).not.toBeNull();
    expect(insight.explanation.causes.length).toBeGreaterThan(0);
    expect(insight.fixes.length).toBeGreaterThan(0);
    expect(bridge.valleyAt(day)).toBe(insight); // cached per revision
    expect(bridge.valleyAt(0)).toBeNull();
    const fix = insight.fixes[0]!;
    expect(bridge.applyValleyFix(fix)).toBe(true);
    const after = bridge.getWarnings();
    expect(after.some((w) => w.startDate === warnings[0]!.startDate)).toBe(false);
  });

  it("highlight repaints (listeners) without a revision bump", () => {
    const { bridge } = setup();
    const listener = vi.fn();
    bridge.subscribe(listener);
    const revision = bridge.getRevision();
    bridge.setHighlight(["sal"]);
    expect(bridge.isHighlighted("sal")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    bridge.setHighlight(["sal"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(bridge.getRevision()).toBe(revision);
  });
});

describe("previews, comparison and the morph", () => {
  it("without an item: the lane shows the what-if over a ghost of the plan", () => {
    const { bridge } = setup();
    const plain = bridge.getOverviewData();
    bridge.setPreview({ kind: "exclude", itemId: "sal" });
    const what = bridge.getOverviewData();
    expect(what).not.toBe(plain);
    expect(what.baseline).not.toBeNull();
    const effect = bridge.getPreviewEffect()!;
    expect(effect.finalAfter).toBeLessThan(effect.finalBefore);
    expect(bridge.getOverviewData()).toBe(what); // cached
    bridge.setPreview(null);
    expect(bridge.getOverviewData().baseline).toBeNull();
  });

  it("with a draft and with another future", () => {
    const { bridge } = setup();
    bridge.setPreview({
      kind: "add",
      item: {
        id: "x",
        kind: "expense",
        name: "Renta",
        amount: 8000,
        recurrence: { frequency: "monthly", startDate: "2026-12-01" },
      },
    });
    expect(bridge.getPreviewEffect()!.finalAfter).toBeLessThan(
      bridge.getPreviewEffect()!.finalBefore,
    );
    const other = { ...bridge.getDocument(), initialCash: 50_000 };
    bridge.setPreview({ kind: "document", doc: other });
    expect(bridge.getPreviewEffect()!.finalAfter).toBeGreaterThan(
      bridge.getPreviewEffect()!.finalBefore,
    );
    expect(bridge.getDocument().initialCash).toBe(20_000);
  });

  it("comparison draws another future as the ghost", () => {
    const { bridge } = setup();
    bridge.setComparison({ ...bridge.getDocument(), initialCash: 1000 });
    expect(bridge.getOverviewData().baseline).not.toBeNull();
    bridge.setComparison(null);
    expect(bridge.getOverviewData().baseline).toBeNull();
  });

  it("the morph interpolates for ~320 ms, then the settled lane is back", () => {
    const { bridge } = setup();
    let t = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => t);
    const settled = bridge.getOverviewData();
    bridge.animateFrom({ initial: 0, beats: [], values: [] });
    expect(bridge.isAnimating()).toBe(true);
    t = 1160;
    const mid = bridge.getOverviewData();
    expect(mid).not.toBe(settled);
    expect(mid.annotations).toEqual([]);
    expect(mid.primary.initial).toBeGreaterThan(0);
    expect(mid.primary.initial).toBeLessThan(settled.primary.initial);
    t = 1400;
    expect(bridge.isAnimating()).toBe(false);
    expect(bridge.getOverviewData()).toBe(settled);
  });
});

describe("sessions: several futures, each with its own undo", () => {
  it("loadDocument replaces the plan with a fresh history", () => {
    const { core, bridge } = setup();
    bridge.setInitialCash(1);
    const demo = createDemoFinancialDocument(START);
    bridge.loadDocument(demo);
    expect(bridge.getDocument().items.map((i) => i.id)).toEqual(demo.items.map((i) => i.id));
    expect(core.getState().clips.length).toBe(demo.items.length);
    expect(core.canUndo()).toBe(false);
  });

  it("export → load another → edit → import the first: both histories intact", () => {
    const { core, bridge } = setup();
    bridge.setInitialCash(11_111);
    const a = bridge.exportSession();
    bridge.loadDocument({ ...bridge.getDocument(), initialCash: 3 });
    bridge.setInitialCash(4);
    const b = bridge.exportSession();
    bridge.importSession(a);
    expect(bridge.getDocument().initialCash).toBe(11_111);
    core.undo();
    expect(bridge.getDocument().initialCash).toBe(20_000);
    bridge.importSession(b);
    expect(bridge.getDocument().initialCash).toBe(4);
    core.undo();
    expect(bridge.getDocument().initialCash).toBe(3);
  });
});

describe("adding items with the app's playlist options", () => {
  it("a recurring item gets its own NEW lane even with virtualTracks off", () => {
    const doc = cardDoc();
    const core = createPlaylistCore(createFinancialPlaylistState(doc), {
      metrics: FINANCE_PLAYLIST_METRICS,
      stretchEnabled: false,
      virtualTracks: false,
    });
    const bridge = new FinancialBridge(core, doc);
    const tracks = core.getState().tracks.length;
    const id = bridge.addItem({
      id: "",
      kind: "expense",
      name: "Renta",
      amount: 8000,
      recurrence: { frequency: "monthly", startDate: "2026-12-01" },
    });
    const clip = core.getState().clips.find((c) => c.id === id);
    expect(clip).toBeDefined();
    expect(core.getState().tracks.length).toBe(tracks + 1);
    // Not named after the item: an unnamed row ("Línea de evento").
    expect(isAutoRowLabel(core.getState().tracks.at(-1)!.label)).toBe(true);
    expect(bridge.getItem(id)?.name).toBe("Renta");
    core.undo();
    expect(core.getState().clips.some((c) => c.id === id)).toBe(false);
    expect(core.getState().tracks.length).toBe(tracks);
  });
});
