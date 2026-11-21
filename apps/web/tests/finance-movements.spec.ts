// @vitest-environment jsdom
// "Lo que pasó": real movements recorded by hand. The journal is ONE for
// every future, its effect is booked on today's cash / card debt outside the
// plan's undo history (undoing a plan edit never un-spends money), it
// survives a reload, and the capture dialog records a movement in a few
// keystrokes.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FinancialDocument, LedgerEntry, Movement } from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import { FinancialBridge } from "../src/finance/financial-bridge";
import { FINANCE_PLAYLIST_METRICS, createFinancialPlaylistState } from "../src/finance/mapping";
import { Futures, MAIN_BRANCH_ID } from "../src/finance/futures";
import { parsePlan } from "../src/finance/persistence";
import {
  describeEffect,
  historyRows,
  periodRange,
  plannedFromCapture,
  withPlanAmount,
} from "../src/finance/movements-ui";
import {
  captureSchema,
  MovementCaptureDialog,
  movementFromCapture,
} from "../src/finance/components/MovementCaptureDialog";
import { AnnouncerProvider } from "../src/ui/announcer";
import { SlicexMantineProvider } from "../src/mantine";

const TODAY = "2026-11-18";

function makeDoc(): FinancialDocument {
  return {
    id: "t",
    name: "test",
    startDate: TODAY,
    initialCash: 8000,
    minimumCashReserve: 1000,
    horizonMonths: 12,
    items: [
      {
        id: "sueldo",
        kind: "income",
        name: "Sueldo",
        amount: 9000,
        recurrence: { frequency: "semimonthly", startDate: TODAY },
      },
      {
        id: "nu",
        kind: "credit-card",
        name: "Nu",
        balance: 3000,
        annualRate: 60,
        cutDay: 5,
        dueDay: 15,
        minimumPayment: 300,
        paymentAmount: 1000,
        recurrence: { frequency: "monthly", startDate: TODAY },
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
  const card = () => {
    const item = bridge.getItem("nu");
    if (item?.kind !== "credit-card") throw new Error("no card");
    return item;
  };
  return { core, bridge, card };
}

function movement(partial: Partial<Movement> & Pick<Movement, "id">): Movement {
  return { kind: "expense", amount: 500, date: TODAY, concept: "Gasolina", category: "Gasolina", ...partial };
}

describe("reality is not a plan undo step", () => {
  it("undo / redo of plan edits keep the cash and card debt booked since", () => {
    const { core, bridge, card } = setup();
    bridge.setMinimumCashReserve(2000); // a plan edit
    bridge.applyReality({ cash: -500, debts: [{ accountId: "nu", amount: 250 }] });
    expect(bridge.getDocument().initialCash).toBe(7500);
    expect(card().balance).toBe(3250);

    core.undo(); // takes back the reserve, not the money spent
    expect(bridge.getDocument().minimumCashReserve).toBe(1000);
    expect(bridge.getDocument().initialCash).toBe(7500);
    expect(card().balance).toBe(3250);

    core.redo();
    expect(bridge.getDocument().minimumCashReserve).toBe(2000);
    expect(bridge.getDocument().initialCash).toBe(7500);
    expect(card().balance).toBe(3250);
    // The projection follows.
    expect(bridge.getProjection().initialCash).toBe(7500);
  });

  it("a plan edit of the cash itself goes back to its value plus the reality booked since", () => {
    const { core, bridge } = setup();
    bridge.setInitialCash(6000); // "Liquidez hoy" typed by hand
    bridge.applyReality({ cash: -500, debts: [] });
    expect(bridge.getDocument().initialCash).toBe(5500);
    core.undo();
    expect(bridge.getDocument().initialCash).toBe(7500);
    core.redo();
    expect(bridge.getDocument().initialCash).toBe(5500);
  });

  it("booking twice and taking it back leaves the plan as it was", () => {
    const { bridge, card } = setup();
    const before = bridge.getRevision();
    bridge.applyReality({ cash: 0, debts: [] });
    expect(bridge.getRevision()).toBe(before);
    bridge.applyReality({ cash: -120.1, debts: [{ accountId: "nu", amount: 99.9 }] });
    bridge.applyReality({ cash: 120.1, debts: [{ accountId: "nu", amount: -99.9 }] });
    expect(bridge.getDocument().initialCash).toBe(8000);
    expect(card().balance).toBe(3000);
  });
});

describe("the journal (Futures)", () => {
  it("records, edits and deletes, booking each change on every future", () => {
    const { bridge } = setup();
    const futures = new Futures(bridge);
    const other = futures.fork(TODAY, "Sin coche"); // active: the new future; main is parked
    expect(futures.getActiveId()).toBe(other.id);

    const gas = movement({ id: futures.newMovementId(0) });
    const effect = futures.commitMovement(null, gas);
    expect(effect).toEqual({ cash: -500, debts: [] });
    expect(futures.getMovements()).toEqual([gas]);
    expect(bridge.getDocument().initialCash).toBe(7500);
    expect(futures.docOf(MAIN_BRANCH_ID)?.initialCash).toBe(7500);

    // The parked future comes back (from its undo session) with the money spent.
    futures.switchTo(MAIN_BRANCH_ID);
    expect(bridge.getDocument().initialCash).toBe(7500);

    // Edit: on the card instead, 450.
    const onCard = { ...gas, amount: 450, cardId: "nu" };
    futures.commitMovement(gas, onCard);
    expect(futures.getMovements()).toEqual([onCard]);
    expect(bridge.getDocument().initialCash).toBe(8000);
    expect(bridge.getItem("nu")).toMatchObject({ balance: 3450 });

    futures.switchTo(other.id);
    expect(bridge.getDocument().initialCash).toBe(8000);
    expect(bridge.getItem("nu")).toMatchObject({ balance: 3450 });

    futures.commitMovement(onCard, null);
    expect(futures.getMovements()).toEqual([]);
    expect(bridge.getItem("nu")).toMatchObject({ balance: 3000 });
    expect(futures.docOf(MAIN_BRANCH_ID)?.items.find((i) => i.id === "nu")).toMatchObject({ balance: 3000 });
  });

  it("gives ids that never collide, even with a deleted one restored", () => {
    const { bridge } = setup();
    const futures = new Futures(bridge);
    const first = futures.newMovementId(1000);
    futures.commitMovement(null, movement({ id: first }));
    const second = futures.newMovementId(1000);
    expect(second).not.toBe(first);
  });

  it("survives a reload; an invalid movement is dropped alone", () => {
    const { bridge } = setup();
    const futures = new Futures(bridge);
    const kept = movement({ id: "m1", time: "14:32", notes: "Costco" });
    futures.commitMovement(null, kept);
    const saved = futures.toSaved();
    expect(saved.movements).toEqual([kept]);
    const raw = JSON.parse(JSON.stringify(saved));
    raw.movements.push({ id: "bad", kind: "expense", amount: -3, date: TODAY, concept: "x" });
    raw.movements.push({ id: "bad2", kind: "expense", amount: 3, date: TODAY, concept: "x", time: "25:00" });
    const parsed = parsePlan(JSON.stringify(raw));
    expect(parsed?.movements).toEqual([kept]);
    // Its effect is already in the saved cash: no double booking on load.
    expect(parsed?.branches[0]?.doc.initialCash).toBe(7500);
    const { bridge: reloaded } = setup(parsed!.branches[0]!.doc);
    const restored = new Futures(reloaded, parsed);
    expect(restored.getMovements()).toEqual([kept]);
    expect(reloaded.getDocument().initialCash).toBe(7500);
    // Plans saved before the journal existed read as none.
    const old = JSON.parse(JSON.stringify(saved));
    delete old.movements;
    expect(new Futures(reloaded, parsePlan(JSON.stringify(old))).getMovements()).toEqual([]);
  });
});

describe("history rows and wording", () => {
  it("merges the journal with what the plan assumed happened", () => {
    const ledger: LedgerEntry[] = [
      { eventId: "renta@2026-11-01", itemId: "renta", name: "Renta", type: "expense", date: "2026-11-01", planned: -8000, actual: -8000, status: "planned", plannedDebt: 0, actualDebt: 0 },
      { eventId: "x@2026-11-02", itemId: "x", name: "Skip", type: "expense", date: "2026-11-02", planned: -100, actual: 0, status: "skipped", plannedDebt: 0, actualDebt: 0 },
      { eventId: "nu@2026-11-05", itemId: "nu", name: "Interés", type: "credit-card-interest", date: "2026-11-05", planned: 0, actual: 0, status: "planned", accountId: "nu", plannedDebt: 30, actualDebt: 30 },
      { eventId: "amz@2026-11-06", itemId: "amz", name: "Amazon", type: "credit-card-purchase", date: "2026-11-06", planned: 0, actual: 0, status: "planned", accountId: "nu", plannedDebt: 900, actualDebt: 900 },
      { eventId: "adjustment@2026-11-18", itemId: "adjustment", name: "Ajuste de efectivo", type: "income", date: "2026-11-18", planned: 0, actual: 250, status: "adjustment", plannedDebt: 0, actualDebt: 0 },
    ];
    const rows = historyRows([movement({ id: "m1" })], ledger);
    expect(rows.map((row) => [row.key, row.source, row.kind, row.amount, row.cardId ?? ""])).toEqual([
      ["m1", "registered", "expense", 500, ""],
      ["ledger:renta@2026-11-01", "plan", "expense", 8000, ""],
      ["ledger:amz@2026-11-06", "plan", "expense", 900, "nu"],
      ["ledger:adjustment@2026-11-18", "adjustment", "income", 250, ""],
    ]);
    expect(rows[0]?.movement?.id).toBe("m1");
  });

  it("periods around today", () => {
    expect(periodRange("all", TODAY)).toEqual({});
    expect(periodRange("today", TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(periodRange("7d", TODAY)).toEqual({ from: "2026-11-12", to: TODAY });
    expect(periodRange("month", TODAY)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(periodRange("last-month", TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("year", TODAY)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("says what an effect does to today's figures", () => {
    const doc = makeDoc();
    expect(describeEffect(doc, { cash: -500, debts: [] })).toBe("Liquidez hoy $8,000 → $7,500");
    expect(describeEffect(doc, { cash: 0, debts: [{ accountId: "nu", amount: 250 }] })).toBe(
      "Deuda de Nu $3,000 → $3,250",
    );
  });

  it("a future capture becomes a one-time item of the plan; quick amount edits per kind", () => {
    const draft = { id: "d1", kind: "expense" as const, name: "Gasto", amount: 1, recurrence: { frequency: "once" as const, startDate: TODAY } };
    expect(plannedFromCapture(draft, { kind: "expense", amount: 700, date: "2026-11-25", concept: "Cumple", cardId: "nu" })).toEqual({
      id: "d1",
      kind: "card-purchase",
      name: "Cumple",
      cardId: "nu",
      amount: 700,
      recurrence: { frequency: "once", startDate: "2026-11-25", endDate: "2026-11-25" },
    });
    const card = makeDoc().items[1]!;
    expect(withPlanAmount(card, 1200)).toMatchObject({ balance: 1200 });
  });
});

describe("capture form", () => {
  it("needs an amount and a concept (or a quick selector); a recorded movement can't move to the future", () => {
    const base = { kind: "expense" as const, amount: "", concept: "", category: "", paidWith: "cash", date: TODAY, time: "", notes: "" };
    const errors = captureSchema(TODAY, false).safeParse(base);
    expect(errors.success).toBe(false);
    const paths = errors.success ? [] : errors.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["amount", "concept"]));
    expect(captureSchema(TODAY, false).safeParse({ ...base, amount: "$1,250.50", category: "Mandado" }).success).toBe(true);
    expect(captureSchema(TODAY, false).safeParse({ ...base, amount: "0", category: "Mandado" }).success).toBe(false);
    expect(captureSchema(TODAY, false).safeParse({ ...base, amount: "5", category: "x", date: "2026-12-01" }).success).toBe(true);
    expect(captureSchema(TODAY, true).safeParse({ ...base, amount: "5", category: "x", date: "2026-12-01" }).success).toBe(false);
    expect(
      movementFromCapture({ ...base, amount: "$1,250.50", category: "Mandado", time: "09:15", notes: "  ticket ", paidWith: "nu" }, "m"),
    ).toEqual({ id: "m", kind: "expense", amount: 1250.5, date: TODAY, concept: "Mandado", category: "Mandado", time: "09:15", notes: "ticket", cardId: "nu" });
  });
});

// --- The dialog, rendered ------------------------------------------------------

let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      React.createElement(SlicexMantineProvider, {
        theme: "light",
        children: React.createElement(AnnouncerProvider, { children: element }),
      }),
    ),
  );
}

function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`button "${text}" not found`);
  return found;
}

describe("MovementCaptureDialog", () => {
  it("amount → quick selector → Registrar: recorded, cash down at once, announced", () => {
    const { bridge } = setup();
    const futures = new Futures(bridge);
    let closed = 0;
    mount(
      React.createElement(MovementCaptureDialog, {
        bridge,
        futures,
        today: TODAY,
        onClose: () => {
          closed += 1;
        },
        now: () => new Date(2026, 10, 18, 14, 32),
      }),
    );
    const amount = document.querySelector<HTMLInputElement>(".fin-capture__amount")!;
    expect(document.activeElement).toBe(amount);
    typeInto(amount, "500");
    act(() => button("Gasolina").click());
    expect(document.body.textContent).toContain("Liquidez hoy $8,000 → $7,500");
    act(() => button("Registrar").click());
    expect(closed).toBe(1);
    expect(futures.getMovements()).toEqual([
      expect.objectContaining({ kind: "expense", amount: 500, concept: "Gasolina", category: "Gasolina", date: TODAY, time: "14:32" }),
    ]);
    expect(bridge.getDocument().initialCash).toBe(7500);
  });

  it("edits and deletes a recorded movement", () => {
    const { bridge } = setup();
    const futures = new Futures(bridge);
    const recorded = movement({ id: "m1" });
    futures.commitMovement(null, recorded);
    mount(
      React.createElement(MovementCaptureDialog, {
        bridge,
        futures,
        today: TODAY,
        movement: recorded,
        onClose: () => {},
      }),
    );
    expect(document.querySelector("h2")?.textContent).toBe("Editar gasto");
    act(() => button("Borrar").click());
    expect(futures.getMovements()).toEqual([]);
    expect(bridge.getDocument().initialCash).toBe(8000);
  });
});
