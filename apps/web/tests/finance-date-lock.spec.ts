// The lock on each object of the timeline (its dates fixed or free): fixed
// by default when it has a start AND an end, free otherwise; the clip's
// lock is the item's (lockDates stored only when it differs from that
// default); a free item moves to another day by hand, a fixed one only
// changes line; the form can always change the dates; the plan keeps the
// choice across a reload.
import { describe, expect, it } from "vitest";
import type { FinancialDocument, FinancialItem } from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import { describePeriod, FinancialBridge } from "../src/finance/financial-bridge";
import {
  FINANCE_PLAYLIST_METRICS,
  createFinancialPlaylistState,
  datesLockedByDefault,
  isDatesLocked,
  withDatesLocked,
} from "../src/finance/mapping";
import { cleanItem } from "../src/finance/item-schema";
import { parsePlan } from "../src/finance/persistence";

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
        id: "bono",
        kind: "income",
        name: "Bono",
        amount: 4000,
        recurrence: { frequency: "once", startDate: "2026-12-09", endDate: "2026-12-09" },
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

function setup(doc: FinancialDocument = makeDoc()) {
  const core = createPlaylistCore(createFinancialPlaylistState(doc), {
    metrics: FINANCE_PLAYLIST_METRICS,
    stretchEnabled: false,
  });
  const bridge = new FinancialBridge(core, doc);
  const clip = (id: string) => core.getState().clips.find((c) => c.id === id)!;
  const trackIndexOf = (id: string) => core.getState().tracks.findIndex((t) => t.id === clip(id).trackId);
  return { core, bridge, clip, trackIndexOf };
}

const flush = () => Promise.resolve();

describe("fixed by default when it has a start and an end", () => {
  const base = { id: "x", name: "x", amount: 1 };
  const monthly = { frequency: "monthly" as const, startDate: START };
  it("windows and MSI are fixed; one-time events, open-ended items and payoff debts are free", () => {
    const cases: Array<[FinancialItem, boolean]> = [
      [{ ...base, kind: "expense", recurrence: { ...monthly, endDate: "2027-06-01" } }, true],
      [{ ...base, kind: "expense", recurrence: monthly }, false],
      [{ ...base, kind: "income", recurrence: { frequency: "once", startDate: START, endDate: START } }, false],
      [
        { id: "l", name: "l", kind: "loan", paymentAmount: 1, recurrence: { ...monthly, endDate: "2027-06-01" } },
        true,
      ],
      // A balance loan / a revolving card end where they are paid off.
      [{ id: "l", name: "l", kind: "loan", paymentAmount: 1, balance: 9000, recurrence: monthly }, false],
      [
        {
          id: "c",
          name: "c",
          kind: "credit-card",
          balance: 1,
          annualRate: 1,
          cutDay: 5,
          dueDay: 15,
          minimumPayment: 1,
          recurrence: monthly,
        },
        false,
      ],
      [
        { id: "m", name: "m", kind: "installment-plan", originalAmount: 1200, installmentsTotal: 12, installmentsPaid: 0, recurrence: monthly },
        true,
      ],
    ];
    for (const [item, fixed] of cases) {
      expect(datesLockedByDefault(item), item.kind).toBe(fixed);
      expect(isDatesLocked(item)).toBe(fixed);
      expect(isDatesLocked({ ...item, lockDates: !fixed })).toBe(!fixed);
    }
  });

  it("the choice is stored only when it differs from the default", () => {
    const loan = makeDoc().items[2]!;
    const free = withDatesLocked(loan, false);
    expect(free.lockDates).toBe(false);
    const back = withDatesLocked(free, true);
    expect("lockDates" in back).toBe(false);
    expect(withDatesLocked(back, true)).toBe(back);
  });
});

describe("the clip's lock is the item's", () => {
  it("each clip starts as its item says", () => {
    const { clip } = setup();
    expect(clip("loan").timeLocked).toBe(true);
    expect(clip("sal").timeLocked).toBeUndefined();
    expect(clip("bono").timeLocked).toBeUndefined();
  });

  it("the lock button writes the item (one undo step); back to the default leaves no flag", () => {
    const { core, bridge, clip } = setup();
    core.setClipTimeLocked("sal", true);
    expect(bridge.getItem("sal")!.lockDates).toBe(true);
    core.setClipTimeLocked("loan", false);
    expect(bridge.getItem("loan")!.lockDates).toBe(false);
    core.setClipTimeLocked("loan", true);
    expect("lockDates" in bridge.getItem("loan")!).toBe(false);
    core.undo();
    expect(bridge.getItem("loan")!.lockDates).toBe(false);
    core.undo();
    core.undo();
    expect("lockDates" in bridge.getItem("sal")!).toBe(false);
    expect(clip("sal").timeLocked).toBeUndefined();
  });

  it("a free one-time event moves to another day by hand", () => {
    const { core, bridge, clip, trackIndexOf } = setup();
    core.moveClips([{ id: "bono", start: clip("bono").start + 3, trackIndex: trackIndexOf("bono") }]);
    expect(bridge.getItem("bono")!.recurrence.startDate).toBe("2026-12-12");
  });

  it("a free open-ended item stretched to an end stays free", async () => {
    const { core, bridge, clip } = setup();
    const before = clip("sal");
    core.resizeClip("sal", "right", before.start + 60);
    await flush();
    const item = bridge.getItem("sal")!;
    expect(item.recurrence.endDate).toBeDefined();
    expect(item.lockDates).toBe(false);
    expect(clip("sal").timeLocked).toBeUndefined();
  });

  it("an end added in the form fixes it; a free choice survives form saves", () => {
    const { bridge, clip } = setup();
    const sal = bridge.getItem("sal")!;
    expect(bridge.replaceItem({ ...sal, recurrence: { ...sal.recurrence, endDate: "2027-05-01" } })).toBe(true);
    expect(clip("sal").timeLocked).toBe(true);

    const { core: core2, bridge: bridge2, clip: clip2 } = setup();
    core2.setClipTimeLocked("loan", false);
    const loan = bridge2.getItem("loan")!;
    // What the editor saves goes through the shared schema: the flag stays.
    const saved = cleanItem({ ...loan, paymentAmount: 1800 } as FinancialItem);
    expect(saved.lockDates).toBe(false);
    expect(bridge2.replaceItem(saved)).toBe(true);
    expect(clip2("loan").timeLocked).toBeUndefined();
    expect(bridge2.getItem("loan")!.lockDates).toBe(false);
  });

  it("the form can always change the dates of a fixed item", () => {
    const { bridge, clip } = setup();
    const loan = bridge.getItem("loan")!;
    const before = clip("loan").start;
    expect(bridge.replaceItem({ ...loan, recurrence: { ...loan.recurrence, startDate: "2026-11-20" } })).toBe(true);
    expect(clip("loan").start).toBe(before + 10);
    expect(clip("loan").timeLocked).toBe(true);
  });
});

describe("one-time events are as wide as their name and amount", () => {
  it("a tag width for one-time events, none for windows; it follows a rename and the card's height", () => {
    const { bridge } = setup();
    const width = bridge.clipMinWidth("bono", 58, 20);
    // Its date ("9 dic 2026") after the lock, at least.
    expect(width).toBeGreaterThan(8 + 22 + "9 dic 2026".length * 6.7);
    expect(bridge.clipMinWidth("sal", 58, 20)).toBe(0);
    expect(bridge.clipMinWidth("loan", 58, 20)).toBe(0);
    // A short card puts lock + date beside the text: wider.
    expect(bridge.clipMinWidth("bono", 40, 20)).toBeGreaterThan(width);
    const bono = bridge.getItem("bono")!;
    expect(bridge.replaceItem({ ...bono, name: "Bono de fin de año y algo más" })).toBe(true);
    expect(bridge.clipMinWidth("bono", 40, 20)).toBeGreaterThan(bridge.clipMinWidth("bono", 58, 20) - 1);
  });
});

describe("every card says the dates it covers", () => {
  it("one date, a window, open-ended, a debt to its payoff", () => {
    const { bridge } = setup();
    expect(bridge.getClipPeriod("bono")).toBe("9 dic 2026");
    expect(bridge.getClipPeriod("loan")).toBe("10 nov 2026 – 10 abr 2027");
    expect(bridge.getClipPeriod("sal")).toBe("13 nov 2026 – Indefinido");
    const card: FinancialItem = {
      id: "c",
      name: "Nu",
      kind: "credit-card",
      balance: 3000,
      annualRate: 0,
      cutDay: 5,
      dueDay: 15,
      minimumPayment: 300,
      recurrence: { frequency: "monthly", startDate: START },
    };
    expect(
      describePeriod(card, {
        accountId: "c",
        name: "Nu",
        kind: "credit-card",
        payoffDate: "2027-02-15",
        totalInterest: 0,
        totalPaid: 3000,
      } as never),
    ).toBe("7 nov 2026 – 15 feb 2027");
    expect(describePeriod(card)).toBe("7 nov 2026 – Indefinido");
  });

  it("follows an edit of the dates", () => {
    const { bridge } = setup();
    const sal = bridge.getItem("sal")!;
    bridge.replaceItem({ ...sal, recurrence: { ...sal.recurrence, endDate: "2027-09-01" } });
    expect(bridge.getClipPeriod("sal")).toBe("13 nov 2026 – 1 sep 2027");
  });
});

describe("the choice survives a reload", () => {
  it("lockDates round-trips through the saved plan", () => {
    const doc = makeDoc();
    doc.items[0] = { ...doc.items[0]!, lockDates: true };
    const raw = JSON.stringify({ v: 1, activeId: "main", branches: [{ id: "main", name: "Principal", doc }] });
    const plan = parsePlan(raw)!;
    expect(plan.branches[0]!.doc.items[0]!.lockDates).toBe(true);
  });
});
