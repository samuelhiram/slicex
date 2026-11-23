// @vitest-environment jsdom
// The plan's memory of its past (2026-11-23): the day the person set their
// balance ("tengo $1,000" on 17 nov) is never forgotten. Rolled to today,
// the plan keeps each day it left behind; the timeline goes back to the
// first one (read-only), the money lane draws the past, and the header reads
// a past day ("Tenías $1,000 · Hasta hoy +$9,800").
import { afterEach, describe, expect, it } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { addDays, historyStart, openingCashAt, rollForward, type FinancialDocument } from "@slicex/core";
import { createPlaylistCore, stepSeriesValueAt } from "@slicex/canvas";
import { FinancialBridge } from "../src/finance/financial-bridge";
import { createFinancialPlaylistState, FINANCE_PLAYLIST_METRICS } from "../src/finance/mapping";
import { applyRecCorrections, bootstrapPlan } from "../src/finance/bootstrap";
import type { SavedPlan } from "../src/finance/persistence";
import { createCalendarTimeAxis } from "../src/finance/time-axis";
import { PlayheadReadout } from "../src/finance/components/PlayheadReadout";
import { testPlan } from "../src/finance/test-plans";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-11-23";
const SET_ON = "2026-11-17";

/** "Tengo $1,000" on 17 nov: Súper every Friday from the 20th, pay every 14 days from the 21st. */
function planSetOn17(): FinancialDocument {
  return {
    id: "d",
    name: "Mi plan",
    startDate: SET_ON,
    initialCash: 1000,
    minimumCashReserve: 0,
    horizonMonths: 12,
    items: [
      { id: "super", kind: "expense", name: "Súper", amount: 1200, recurrence: { frequency: "weekly", startDate: "2026-11-20" } },
      { id: "pay", kind: "income", name: "Sueldo", amount: 11000, recurrence: { frequency: "biweekly", startDate: "2026-11-21" } },
    ],
  };
}

function saved(doc: FinancialDocument, ledger: SavedPlan["ledger"] = []): SavedPlan {
  return {
    v: 1,
    activeId: "main",
    compareId: null,
    branches: [{ id: "main", name: "Plan principal", forkDate: null, doc }],
    ledger,
  };
}

function setup(doc: FinancialDocument) {
  const core = createPlaylistCore(createFinancialPlaylistState(doc), {
    metrics: FINANCE_PLAYLIST_METRICS,
    stretchEnabled: false,
  });
  return { core, bridge: new FinancialBridge(core, doc) };
}

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("opening the app days later", () => {
  it("the plan remembers 17 nov opened with $1,000; today it has $10,800", () => {
    const plan = bootstrapPlan(TODAY, saved(planSetOn17()));
    expect(plan.doc.startDate).toBe(TODAY);
    expect(plan.doc.initialCash).toBe(10800);
    expect(openingCashAt(plan.doc, SET_ON)).toBe(1000);
    // What gets saved carries the memory.
    expect(plan.saved!.branches[0]!.doc.history).toEqual(plan.doc.history);
  });

  it("a plan saved before the memory existed gets its past back from what Rec booked", () => {
    // Rolled once without a memory (as before), then saved with Rec's ledger.
    const first = rollForward(planSetOn17(), "2026-11-22");
    const { history: _history, ...noMemory } = first.doc;
    const plan = bootstrapPlan(TODAY, saved(noMemory, first.ledger));
    // The ledger knows from its first payment on (the 20th).
    expect(openingCashAt(plan.doc, "2026-11-20")).toBe(1000);
    expect(openingCashAt(plan.doc, "2026-11-21")).toBe(-200);
    expect(openingCashAt(plan.doc, "2026-11-22")).toBe(10800);
  });
});

describe("the timeline goes back to the first remembered day (read-only)", () => {
  it("the view reaches 17 nov (beat −6) and no further", () => {
    const { core } = setup(bootstrapPlan(TODAY, saved(planSetOn17())).doc);
    expect(core.getState().viewport.minBeat).toBe(-6);
    expect(core.getState().viewport.scrollX).toBe(0);
    core.setPlayPosition(-20);
    expect(core.getState().playPosition.time).toBe(-6);
  });

  it("a plan without a past starts at today, as before", () => {
    const { core } = setup(planSetOn17());
    expect(core.getState().viewport.minBeat).toBeUndefined();
  });

  it("what a past day closed with: the next day's opening; today and later are the projection's", () => {
    const { bridge } = setup(bootstrapPlan(TODAY, saved(planSetOn17())).doc);
    expect(bridge.pastCashAt("2026-11-17")).toBe(1000);
    expect(bridge.pastCashAt("2026-11-20")).toBe(-200);
    expect(bridge.pastCashAt("2026-11-22")).toBe(10800);
    expect(bridge.pastCashAt(TODAY)).toBeNull();
    expect(bridge.pastCashAt("2026-11-16")).toBeNull();
  });

  it("the money lane draws the past from 17 nov; the debt curve only from today", () => {
    const { bridge } = setup(bootstrapPlan(TODAY, saved(planSetOn17())).doc);
    const data = bridge.getOverviewData();
    expect(data.startBeat).toBe(-6);
    expect(stepSeriesValueAt(data.primary, -6)).toBe(1000);
    expect(stepSeriesValueAt(data.primary, -4)).toBe(1000);
    // Friday 20th: the Súper; Saturday 21st: the pay.
    expect(stepSeriesValueAt(data.primary, -3)).toBe(-200);
    expect(stepSeriesValueAt(data.primary, -2)).toBe(10800);
    expect(stepSeriesValueAt(data.primary, -1)).toBe(10800);
    expect(data.secondary?.from).toBe(0);
  });

  it("the ruler names the past days and keeps 'Hoy' on today", () => {
    const axis = createCalendarTimeAxis(TODAY);
    const ticks = axis.ticks(-6, 3, 40);
    expect(ticks[0]!.beat).toBe(-6);
    expect(ticks[0]!.label).toContain("17");
    const today = ticks.find((tick) => tick.beat === 0)!;
    expect(today.emphasis).toBe(true);
    expect(ticks.map((tick) => tick.beat)).toEqual([...ticks.map((tick) => tick.beat)].sort((a, b) => a - b));
  });
});

describe("the header reads a past day", () => {
  it("'Tenías $1,000 · Hasta hoy +$9,800' on 17 nov; back to 'Caja · Deuda' today", () => {
    const { core, bridge } = setup(bootstrapPlan(TODAY, saved(planSetOn17())).doc);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(React.createElement(PlayheadReadout, { bridge })));
    const text = () => container.textContent!.replace(/\s+/g, " ");
    expect(text()).toContain("Caja");
    act(() => core.setPlayPosition(-6));
    expect(text()).toContain("Tenías");
    expect(text()).toContain("$1,000");
    expect(text()).toContain("Hasta hoy");
    expect(text()).toContain("+$9,800");
    expect(text()).not.toContain("Deuda");
    // The 20th closed below zero: less then, more today.
    act(() => core.setPlayPosition(-3));
    expect(text()).toContain("-$200");
    expect(text()).toContain("+$11,000");
    act(() => core.setPlayPosition(0));
    expect(text()).toContain("Caja");
    expect(text()).toContain("Deuda");
  });
});

describe("Rec corrects the past", () => {
  it("'No pasó' on the 20th's Súper: the days after it are remembered $1,200 higher", () => {
    const plan = bootstrapPlan(TODAY, saved(planSetOn17()));
    const { bridge } = setup(plan.doc);
    const superOn20 = plan.rec!.pending.find((point) => point.itemId === "super")!;
    applyRecCorrections(bridge, plan.rec!, TODAY, [{ eventId: superOn20.eventId, status: "skipped" }], undefined);
    expect(bridge.pastCashAt("2026-11-20")).toBe(1000);
    expect(bridge.pastCashAt("2026-11-22")).toBe(12000);
    expect(bridge.getDocument().initialCash).toBe(12000);
    expect(openingCashAt(bridge.getDocument(), SET_ON)).toBe(1000);
  });
});

describe("?reset=memoria — a plan to try the memory", () => {
  it("opens rolled to today, remembering 45 days back: set with $15,000, today $10,421", () => {
    const saved = testPlan("memoria", TODAY)!;
    const plan = bootstrapPlan(TODAY, saved);
    expect(plan.doc.startDate).toBe(TODAY);
    expect(plan.doc.initialCash).toBe(10421);
    expect(historyStart(plan.doc)).toBe(addDays(TODAY, -45));
    expect(openingCashAt(plan.doc, addDays(TODAY, -22))).toBe(15000);
    const { core } = setup(plan.doc);
    expect(core.getState().viewport.minBeat).toBe(-45);
  });

  it("an unknown name opens nothing (plain ?reset: the example year)", () => {
    expect(testPlan("otro", TODAY)).toBeNull();
  });
});
