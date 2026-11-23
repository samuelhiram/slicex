// The plan's memory of its past (FinancialDocument.history): rolling the plan
// forward never forgets the day the balance was set, nor what each later
// day opened with.
import { describe, expect, it } from "vitest";
import {
  historyStart,
  openingCashAt,
  rebuildHistory,
  rollForward,
  type FinancialDocument,
  type FinancialItem,
} from "../src/finance";

const SET_ON = "2026-11-17";

function plan(over: Partial<FinancialDocument> = {}): FinancialDocument {
  const items: FinancialItem[] = [
    // Súper every Friday (20 nov, 27 nov…), pay day on the 21st.
    { id: "super", kind: "expense", name: "Súper", amount: 1200, recurrence: { frequency: "weekly", startDate: "2026-11-20" } },
    { id: "pay", kind: "income", name: "Sueldo", amount: 11000, recurrence: { frequency: "once", startDate: "2026-11-21", endDate: "2026-11-21" } },
  ];
  return {
    id: "d",
    name: "Plan",
    startDate: SET_ON,
    initialCash: 1000,
    minimumCashReserve: 0,
    horizonMonths: 6,
    items,
    ...over,
  };
}

describe("history — the plan remembers the day its balance was set", () => {
  it("rolled to the 23rd: 17 nov opened with $1,000; each later day with what changed", () => {
    const { doc } = rollForward(plan(), "2026-11-23");
    expect(doc.startDate).toBe("2026-11-23");
    expect(doc.initialCash).toBe(10800);
    expect(doc.history).toEqual([
      { date: "2026-11-17", cash: 1000 },
      { date: "2026-11-21", cash: -200 },
      { date: "2026-11-22", cash: 10800 },
    ]);
    expect(historyStart(doc)).toBe("2026-11-17");
    expect(openingCashAt(doc, "2026-11-17")).toBe(1000);
    expect(openingCashAt(doc, "2026-11-19")).toBe(1000);
    expect(openingCashAt(doc, "2026-11-21")).toBe(-200);
    expect(openingCashAt(doc, "2026-11-23")).toBe(10800);
    // Before the memory, and the future: not the history's business.
    expect(openingCashAt(doc, "2026-11-16")).toBeNull();
    expect(openingCashAt(doc, "2026-11-24")).toBeNull();
  });

  it("rolling day by day remembers the same as rolling at once", () => {
    let daily = plan();
    for (const day of ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"]) {
      daily = rollForward(daily, day).doc;
    }
    expect(daily.history).toEqual(rollForward(plan(), "2026-11-23").doc.history);
    expect(daily.initialCash).toBe(10800);
  });

  it("a balance typed on a later day starts from there; the earlier days stay as they were", () => {
    const rolled = rollForward(plan(), "2026-11-20").doc;
    // On the 20th the person says they really have $3,000.
    const typed = rollForward({ ...rolled, initialCash: 3000 }, "2026-11-23").doc;
    expect(openingCashAt(typed, "2026-11-17")).toBe(1000);
    expect(openingCashAt(typed, "2026-11-20")).toBe(3000);
    expect(openingCashAt(typed, "2026-11-21")).toBe(1800);
    expect(openingCashAt(typed, "2026-11-23")).toBe(12800);
  });

  it("Rec's corrections change the remembered days from the corrected one on", () => {
    const { doc, pending } = rollForward(plan(), "2026-11-23");
    const superOn20 = pending.find((point) => point.itemId === "super")!;
    const corrected = rollForward(plan(), "2026-11-23", {
      actuals: [{ eventId: superOn20.eventId, status: "skipped" }],
    }).doc;
    expect(openingCashAt(corrected, "2026-11-20")).toBe(1000);
    expect(openingCashAt(corrected, "2026-11-21")).toBe(1000);
    expect(openingCashAt(corrected, "2026-11-22")).toBe(12000);
    expect(corrected.initialCash - doc.initialCash).toBe(1200);
  });

  it("a plan with no past remembers nothing", () => {
    expect(historyStart(plan())).toBeNull();
    expect(openingCashAt(plan(), "2026-11-10")).toBeNull();
    expect(openingCashAt(plan(), SET_ON)).toBe(1000);
  });
});

describe("rebuildHistory — a plan saved before the memory gets its past back", () => {
  it("walks back from today's cash through the ledger: the days rollForward remembers, from the first with a movement", () => {
    const rolled = rollForward(plan(), "2026-11-23");
    const { history: _history, ...withoutMemory } = rolled.doc;
    // The ledger knows nothing before its first event (the 20th): the
    // memory starts there; from it on, the same days.
    expect(rebuildHistory(withoutMemory, rolled.ledger)).toEqual([
      { date: "2026-11-20", cash: 1000 },
      { date: "2026-11-21", cash: -200 },
      { date: "2026-11-22", cash: 10800 },
    ]);
  });

  it("a movement paid in cash counts on its day; one paid with a card does not", () => {
    const rolled = rollForward(plan(), "2026-11-23");
    const { history: _history, ...withoutMemory } = rolled.doc;
    const rebuilt = rebuildHistory(withoutMemory, rolled.ledger, [
      { id: "m1", kind: "expense", amount: 300, date: "2026-11-18", concept: "Tacos" },
      { id: "m2", kind: "expense", amount: 900, date: "2026-11-19", concept: "Tenis", cardId: "nu" },
    ])!;
    const doc = { ...withoutMemory, history: rebuilt };
    // Today's cash already has the tacos: the day they happened opened $300
    // higher; the card's tenis moved no cash.
    expect(historyStart(doc)).toBe("2026-11-18");
    expect(openingCashAt(doc, "2026-11-18")).toBe(1300);
    expect(openingCashAt(doc, "2026-11-19")).toBe(1000);
    expect(openingCashAt(doc, "2026-11-20")).toBe(1000);
  });

  it("nothing before today: no history", () => {
    expect(rebuildHistory(plan(), [])).toBeUndefined();
  });
});
