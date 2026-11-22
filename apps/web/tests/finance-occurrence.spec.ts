// One payment of an item as a cell of the timeline: which payment a click
// lands on (occurrence.ts), editing it through the bridge (one undo entry,
// one item), and the rule changes / edits following the item when it moves.
import { describe, expect, it } from "vitest";
import type { FinancialDocument } from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import { FinancialBridge } from "../src/finance/financial-bridge";
import { createFinancialPlaylistState, FINANCE_PLAYLIST_METRICS } from "../src/finance/mapping";
import { describeOccurrenceEdit, ruleEditsSummary } from "../src/finance/occurrence";
import { planAmountOf, withPlanAmount } from "../src/finance/movements-ui";
import { paymentChangeRows } from "../src/finance/components/PaymentChanges";
import { buildClipContents, describeItemAt } from "../src/finance/visuals";

const START = "2026-11-21";

function makeDoc(): FinancialDocument {
  return {
    id: "t",
    name: "test",
    startDate: START,
    initialCash: 5000,
    minimumCashReserve: 0,
    horizonMonths: 6,
    items: [
      {
        id: "sueldo",
        kind: "income",
        name: "Sueldo",
        amount: 9000,
        recurrence: { frequency: "semimonthly", startDate: "2026-11-22" },
      },
      {
        id: "gas",
        kind: "expense",
        name: "Gas",
        amount: 800,
        recurrence: { frequency: "weekly", startDate: "2026-11-27" },
      },
      {
        id: "msi",
        kind: "installment-plan",
        name: "Laptop",
        originalAmount: 12000,
        installmentsTotal: 12,
        installmentsPaid: 0,
        recurrence: { frequency: "monthly", startDate: "2026-12-05" },
      },
    ],
  };
}

function setup() {
  const doc = makeDoc();
  const core = createPlaylistCore(createFinancialPlaylistState(doc), {
    metrics: FINANCE_PLAYLIST_METRICS,
    stretchEnabled: false,
  });
  const bridge = new FinancialBridge(core, doc);
  const beat = (date: string) => bridge.beatAtDate(date);
  const trackIndexOf = (id: string) => {
    const clip = core.getState().clips.find((c) => c.id === id)!;
    return core.getState().tracks.findIndex((t) => t.id === clip.trackId);
  };
  const cash = (itemId: string) =>
    bridge
      .getProjection()
      .points.filter((p) => p.itemId === itemId)
      .map((p) => [p.date, p.cashDelta]);
  return { core, bridge, beat, trackIndexOf, cash };
}

describe("occurrenceAt", () => {
  it("a click inside a cell is the payment at its left edge", () => {
    const { bridge, beat } = setup();
    // Gas pays every Friday from 27 nov: 4 dic … 11 dic is the 2nd cell.
    const info = bridge.occurrenceAt("gas", beat("2026-12-08") + 0.4)!;
    expect(info.date).toBe("2026-12-04");
    expect(info.nextDate).toBe("2026-12-11");
    expect(info.index).toBe(2);
    expect(info.amount).toBe(800);
    expect(info.editable).toBe(true);
    expect(info.cadenceEditable).toBe(true);
    expect(info.first).toBe(false);
    expect(info.direction).toBe(-1);
  });

  it("a click before the first payment opens the first one", () => {
    const { bridge, beat } = setup();
    const info = bridge.occurrenceAt("gas", beat("2026-11-25"))!;
    expect(info.date).toBe("2026-11-27");
    expect(info.first).toBe(true);
  });

  it("MSI installments are read-only", () => {
    const { bridge, beat } = setup();
    const info = bridge.occurrenceAt("msi", beat("2027-01-10"))!;
    expect(info.date).toBe("2027-01-05");
    expect(info.editable).toBe(false);
    expect(info.amount).toBe(1000);
  });
});

describe("editOccurrence", () => {
  it("'solo este pago' changes that one payment; one undo step brings it back", () => {
    const { core, bridge, cash } = setup();
    expect(bridge.editOccurrence("gas", { date: "2026-12-05", scope: "this", amount: 400 })).toBe(false); // not a payment day
    expect(bridge.editOccurrence("gas", { date: "2026-12-04", scope: "this", amount: 400 })).toBe(true);
    expect(cash("gas").slice(0, 3)).toEqual([
      ["2026-11-27", -800],
      ["2026-12-04", -400],
      ["2026-12-11", -800],
    ]);
    expect(bridge.getDocument().items.filter((i) => i.id === "gas")).toHaveLength(1);
    const info = bridge.occurrenceAt("gas", bridge.beatAtDate("2026-12-04"))!;
    expect(info.edited).toBe(true);
    expect(info.ruleAmount).toBe(800);
    core.undo();
    expect(cash("gas")[1]).toEqual(["2026-12-04", -800]);
    expect(bridge.getItem("gas")!.occurrenceEdits).toBeUndefined();
  });

  it("'este y los siguientes' raises the pay from that date, still one item", () => {
    const { bridge, cash } = setup();
    expect(bridge.editOccurrence("sueldo", { date: "2026-12-15", scope: "following", amount: 12000 })).toBe(true);
    expect(cash("sueldo").slice(0, 4)).toEqual([
      ["2026-11-30", 9000],
      ["2026-12-15", 12000],
      ["2026-12-31", 12000],
      ["2027-01-15", 12000],
    ]);
    const item = bridge.getItem("sueldo")!;
    expect(item.ruleChanges).toEqual([{ from: "2026-12-15", amount: 12000 }]);
    expect(describeItemAt(item, bridge.getDocument(), bridge.getProjection(), START, new Map())).toBe(
      "+$9,000 /quincena → +$12,000 (15 dic)",
    );
    expect(describeItemAt(item, bridge.getDocument(), bridge.getProjection(), "2027-01-02", new Map())).toBe(
      "+$12,000 /quincena",
    );
  });

  it("'este y los siguientes' then 'solo este pago': the following payments are back, one undo step", () => {
    const { core, bridge, beat, cash } = setup();
    bridge.editOccurrence("sueldo", { date: "2027-01-15", scope: "following", amount: 5000 });
    const info = bridge.occurrenceAt("sueldo", beat("2027-01-15"))!;
    expect(info.changeStartsHere).toBe(true);
    expect(info.edited).toBe(false);
    expect(info.before).toMatchObject({ amount: 9000, rule: { frequency: "semimonthly" } });
    expect(bridge.editOccurrence("sueldo", { date: "2027-01-15", scope: "this", amount: 5000 })).toBe(true);
    const back = [
      ["2026-12-31", 9000],
      ["2027-01-15", 5000],
      ["2027-01-31", 9000],
      ["2027-02-15", 9000],
    ];
    expect(cash("sueldo").slice(2, 6)).toEqual(back);
    const cells = buildClipContents(bridge.getDocument(), bridge.getProjection(), new Map()).get("sueldo")!.cells!;
    expect(cells.labels.slice(2, 6)).toEqual(["+$9,000", "+$5,000", "+$9,000", "+$9,000"]);
    expect(cells.strong!.slice(2, 6)).toEqual([false, true, false, false]);
    core.undo();
    expect(cash("sueldo").slice(3, 5)).toEqual([
      ["2027-01-15", 5000],
      ["2027-01-31", 5000],
    ]);
    core.redo();
    expect(cash("sueldo").slice(2, 6)).toEqual(back);
  });

  it("a cadence change from a payment restarts the rhythm there", () => {
    const { bridge, cash } = setup();
    bridge.editOccurrence("gas", { date: "2026-12-11", scope: "following", frequency: "biweekly", amount: 1500 });
    expect(cash("gas").slice(0, 5)).toEqual([
      ["2026-11-27", -800],
      ["2026-12-04", -800],
      ["2026-12-11", -1500],
      ["2026-12-25", -1500],
      ["2027-01-08", -1500],
    ]);
  });

  it("a payment set to 0 keeps its cell as a dashed mark", () => {
    const { bridge, beat } = setup();
    bridge.editOccurrence("gas", { date: "2026-12-11", scope: "this", amount: 0 });
    const contents = buildClipContents(bridge.getDocument(), bridge.getProjection(), new Map());
    expect(contents.get("gas")!.marks).toEqual([beat("2026-12-11")]);
    // The cell still opens at that payment.
    expect(bridge.occurrenceAt("gas", beat("2026-12-12"))!.date).toBe("2026-12-11");
  });

  it("moving the item moves its changes and edits with it", () => {
    const { core, bridge, trackIndexOf } = setup();
    bridge.editOccurrence("gas", { date: "2026-12-04", scope: "this", amount: 400 });
    bridge.editOccurrence("gas", { date: "2026-12-18", scope: "following", amount: 300 });
    const start = core.getState().clips.find((c) => c.id === "gas")!.start;
    core.moveClips([{ id: "gas", start: start + 2, trackIndex: trackIndexOf("gas") }]);
    const item = bridge.getItem("gas")!;
    expect(item.recurrence.startDate).toBe("2026-11-29");
    expect(item.occurrenceEdits).toEqual([{ date: "2026-12-06", amount: 400 }]);
    expect(item.ruleChanges).toEqual([{ from: "2026-12-20", amount: 300 }]);
  });

  it("describes what changed for the announcer", () => {
    const { bridge, beat } = setup();
    const item = bridge.getItem("gas")!;
    const info = bridge.occurrenceAt("gas", beat("2026-12-04"))!;
    const rule = item.recurrence;
    expect(describeOccurrenceEdit(item, info, { date: info.date, scope: "this", amount: 400 }, rule)).toBe(
      "Gas: −$400 solo el 4 dic",
    );
    expect(describeOccurrenceEdit(item, info, { date: info.date, scope: "this", amount: 0 }, rule)).toBe(
      "Gas: sin pago el 4 dic",
    );
    expect(describeOccurrenceEdit(item, info, { date: info.date, scope: "following", amount: 400 }, rule)).toBe(
      "Gas: −$400 /semana desde el 4 dic",
    );
    bridge.editOccurrence("gas", { date: "2026-12-04", scope: "following", amount: 400 });
    const changed = bridge.occurrenceAt("gas", beat("2026-12-04"))!;
    expect(describeOccurrenceEdit(item, changed, { date: info.date, scope: "this", amount: 400 }, rule)).toBe(
      "Gas: −$400 solo el 4 dic; los siguientes vuelven a −$800 /semana",
    );
    expect(describeOccurrenceEdit(item, changed, { date: info.date, scope: "this", amount: 800 }, rule)).toBe(
      "Gas: vuelve a −$800 /semana desde el 4 dic",
    );
  });
});

describe("amounts in sight", () => {
  it("every recurring item writes each payment's amount in its cell; changed ones stand out", () => {
    const { bridge, beat } = setup();
    bridge.editOccurrence("gas", { date: "2026-12-04", scope: "this", amount: 700 });
    bridge.editOccurrence("gas", { date: "2026-12-18", scope: "following", amount: 300 });
    bridge.editOccurrence("gas", { date: "2026-12-11", scope: "this", amount: 0 });
    const contents = buildClipContents(bridge.getDocument(), bridge.getProjection(), new Map());
    const cells = contents.get("gas")!.cells!;
    expect(cells.labels.slice(0, 6)).toEqual(["−$800", "−$700", "$0", "−$300", "−$300", "−$300"]);
    expect(cells.beats.slice(0, 3)).toEqual([beat("2026-11-27"), beat("2026-12-04"), beat("2026-12-11")]);
    expect(cells.strong!.slice(0, 5)).toEqual([false, true, true, true, false]);
    // An income: "+"; an MSI: its installment.
    expect(contents.get("sueldo")!.cells!.labels[0]).toBe("+$9,000");
    expect(contents.get("msi")!.cells!.labels[0]).toBe("−$1,000");
  });

  it("an unchanged content keeps its identity (the renderer redoes nothing)", () => {
    const { bridge } = setup();
    const first = buildClipContents(bridge.getDocument(), bridge.getProjection(), new Map());
    const again = buildClipContents(bridge.getDocument(), bridge.getProjection(), first);
    expect(again.get("gas")).toBe(first.get("gas"));
  });

  it("says what changes the payments from today on", () => {
    const { bridge } = setup();
    bridge.editOccurrence("gas", { date: "2026-12-04", scope: "this", amount: 700 });
    bridge.editOccurrence("gas", { date: "2026-12-18", scope: "following", amount: 300, frequency: "biweekly" });
    const item = bridge.getItem("gas")!;
    expect(ruleEditsSummary(item, START)).toBe("Desde 18 dic: −$300 /14 días · 4 dic: −$700");
    expect(ruleEditsSummary(item, "2026-12-20")).toBeNull();
    expect(ruleEditsSummary(bridge.getItem("sueldo")!, START)).toBeNull();
  });

  it("the plan list shows and edits the amount in force today", () => {
    const { bridge } = setup();
    bridge.editOccurrence("gas", { date: "2026-12-18", scope: "following", amount: 300 });
    const item = bridge.getItem("gas")!;
    expect(planAmountOf(item, START)).toBe(800);
    expect(planAmountOf(item, "2027-01-01")).toBe(300);
    const later = withPlanAmount(item, 350, "2027-01-01");
    expect(later.ruleChanges).toEqual([{ from: "2026-12-18", amount: 350 }]);
    expect((withPlanAmount(item, 900, START) as typeof item & { amount: number }).amount).toBe(900);
  });

  it("the form lists the changes, each one removable", () => {
    const { bridge } = setup();
    bridge.editOccurrence("gas", { date: "2026-12-04", scope: "this", amount: 0 });
    bridge.editOccurrence("gas", { date: "2026-12-18", scope: "following", amount: 300 });
    const item = bridge.getItem("gas")!;
    const rows = paymentChangeRows(item);
    expect(rows.map((row) => [row.when, row.what])).toEqual([
      ["Desde el 18 dic", "−$300 /semana"],
      ["Solo el 4 dic", "sin pago"],
    ]);
    const withoutRule = rows[0]!.remove(item);
    expect(withoutRule.ruleChanges).toBeUndefined();
    expect(withoutRule.occurrenceEdits).toHaveLength(1);
  });
});
