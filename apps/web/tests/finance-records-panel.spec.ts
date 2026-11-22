// @vitest-environment jsdom
// The records panel, right of the timeline: open by default on "Gastos del
// mes", grouped by day, with chips per category that keep showing while
// one is chosen, and "En tu plan" landing on the same kind. Its title says
// what is on screen; open / folded is remembered by the browser, the view
// by the tab.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FinancialDocument, Movement } from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import { FinancialBridge } from "../src/finance/financial-bridge";
import { FINANCE_PLAYLIST_METRICS, createFinancialPlaylistState } from "../src/finance/mapping";
import { Futures } from "../src/finance/futures";
import {
  DEFAULT_SEARCH_VIEW,
  dayLabel,
  groupByDay,
  parseSearchView,
  planTabFor,
  rangeLabel,
  recordsTitle,
  viewRange,
  withPeriod,
  type SearchView,
} from "../src/finance/movements-ui";
import { chooseOption } from "./select-helpers";
import {
  loadRecordsOpen,
  loadRecordsView,
  RECORDS_OPEN_KEY,
  RECORDS_VIEW_KEY,
  saveRecordsOpen,
  saveRecordsView,
} from "../src/finance/records-panel-state";
import { MovementsPanel } from "../src/finance/components/MovementsPanel";
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

function setup() {
  const doc = makeDoc();
  const core = createPlaylistCore(createFinancialPlaylistState(doc), {
    metrics: FINANCE_PLAYLIST_METRICS,
    stretchEnabled: false,
  });
  const bridge = new FinancialBridge(core, doc);
  const futures = new Futures(bridge);
  const movements: Movement[] = [
    { id: "m1", kind: "expense", amount: 500, date: TODAY, time: "14:30", concept: "Gasolina", category: "Gasolina" },
    {
      id: "m2",
      kind: "expense",
      amount: 300,
      date: "2026-11-17",
      concept: "Tacos",
      category: "Comida",
      notes: "con Ana",
      cardId: "nu",
    },
    { id: "m3", kind: "income", amount: 1200, date: TODAY, concept: "Venta", category: "Venta" },
    { id: "m4", kind: "expense", amount: 200, date: "2026-10-20", concept: "Viejo", category: "Gasolina" },
  ];
  for (const movement of movements) futures.commitMovement(null, movement);
  return { bridge, futures };
}

describe("what the panel shows, in words", () => {
  it("the title says what is on screen", () => {
    expect(recordsTitle(DEFAULT_SEARCH_VIEW)).toBe("Gastos del mes");
    expect(recordsTitle({ tab: "history", kind: "income", period: "today" })).toBe("Ingresos de hoy");
    expect(recordsTitle({ tab: "history", kind: "all", period: "year" })).toBe("Movimientos del año");
    expect(recordsTitle({ tab: "history", kind: "all", period: "all" })).toBe("Todo lo que pasó");
    expect(recordsTitle({ tab: "history", kind: "expense", period: "all" })).toBe("Todos tus gastos");
    expect(recordsTitle({ tab: "loan", kind: "expense", period: "month" })).toBe("Préstamos de tu plan");
    expect(planTabFor("income")).toBe("income");
    expect(planTabFor("all")).toBe("expense");
  });

  it("a day walked day by day, a picked range: their ranges and titles", () => {
    const day = (from?: string) => withPeriod(DEFAULT_SEARCH_VIEW, "day", from);
    expect(viewRange(day(), TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(recordsTitle(day(), TODAY)).toBe("Gastos de hoy");
    expect(recordsTitle(day("2026-11-17"), TODAY)).toBe("Gastos de ayer");
    expect(recordsTitle({ ...day("2026-11-16"), kind: "income" }, TODAY)).toBe("Ingresos del lun 16 nov");
    const range = (from: string, to: string) => withPeriod(DEFAULT_SEARCH_VIEW, "range", from, to);
    expect(viewRange(range("2026-11-15", "2026-11-01"), TODAY)).toEqual({ from: "2026-11-01", to: "2026-11-15" });
    expect(recordsTitle(range("2026-11-01", "2026-11-15"), TODAY)).toBe("Gastos del 1 al 15 nov");
    expect(recordsTitle(range("2026-10-28", "2026-11-03"), TODAY)).toBe("Gastos del 28 oct al 3 nov");
    expect(recordsTitle(range("2025-12-28", "2026-01-03"), TODAY)).toBe("Gastos del 28 dic 2025 al 3 ene 2026");
    expect(recordsTitle(range(TODAY, TODAY), TODAY)).toBe("Gastos de hoy");
    expect(rangeLabel("2026-10-28", "2026-11-03", TODAY)).toBe("28 oct – 3 nov");
    // A stored "today" is a day on today; a range needs both ends.
    expect(parseSearchView({ ...DEFAULT_SEARCH_VIEW, period: "today" })).toEqual(day());
    expect(parseSearchView(range("2026-11-01", "2026-11-15"))).toEqual(range("2026-11-01", "2026-11-15"));
    expect(parseSearchView({ ...DEFAULT_SEARCH_VIEW, period: "range", from: "2026-11-01" })).toBeNull();
    // Back to a preset drops the dates.
    expect(withPeriod(range("2026-11-01", "2026-11-15"), "month")).toEqual(DEFAULT_SEARCH_VIEW);
  });

  it("days: Hoy, Ayer, then the weekday; runs of one day with its net", () => {
    expect(dayLabel(TODAY, TODAY)).toBe("Hoy");
    expect(dayLabel("2026-11-17", TODAY)).toBe("Ayer");
    expect(dayLabel("2026-11-15", TODAY)).toBe("dom 15 nov");
    expect(dayLabel("2025-11-15", TODAY)).toBe("sáb 15 nov 2025");
    const rows = [
      { kind: "income" as const, amount: 1200, date: TODAY, concept: "a" },
      { kind: "expense" as const, amount: 500, date: TODAY, concept: "b" },
      { kind: "expense" as const, amount: 300, date: "2026-11-17", concept: "c" },
    ];
    expect(groupByDay(rows).map((group) => [group.date, group.rows.length, group.net])).toEqual([
      [TODAY, 2, 700],
      ["2026-11-17", 1, -300],
    ]);
  });

  it("a stored view is checked field by field", () => {
    expect(parseSearchView({ ...DEFAULT_SEARCH_VIEW, tab: "msi" })).toEqual({ ...DEFAULT_SEARCH_VIEW, tab: "msi" });
    for (const bad of [
      null,
      [],
      { ...DEFAULT_SEARCH_VIEW, tab: "boats" },
      { ...DEFAULT_SEARCH_VIEW, kind: "loan" },
      { ...DEFAULT_SEARCH_VIEW, period: "forever" },
      { ...DEFAULT_SEARCH_VIEW, query: 4 },
    ]) {
      expect(parseSearchView(bad)).toBeNull();
    }
  });
});

describe("open / folded and the view survive", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("never chosen: open when it fits beside the timeline; then as chosen", () => {
    expect(loadRecordsOpen(1440)).toBe(true);
    expect(loadRecordsOpen(600)).toBe(false);
    saveRecordsOpen(false);
    expect(localStorage.getItem(RECORDS_OPEN_KEY)).toBe("folded");
    expect(loadRecordsOpen(1440)).toBe(false);
    saveRecordsOpen(true);
    expect(loadRecordsOpen(600)).toBe(true);
    localStorage.setItem(RECORDS_OPEN_KEY, "garbage");
    expect(loadRecordsOpen(1440)).toBe(true);
  });

  it("the view round-trips through the tab's storage; garbage is ignored", () => {
    expect(loadRecordsView()).toBeNull();
    const view: SearchView = { ...DEFAULT_SEARCH_VIEW, kind: "income", query: "venta" };
    saveRecordsView(view);
    expect(loadRecordsView()).toEqual(view);
    sessionStorage.setItem(RECORDS_VIEW_KEY, "{not json");
    expect(loadRecordsView()).toBeNull();
  });
});

// --- The panel, rendered -----------------------------------------------------

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function Harness({
  initialView,
  ...props
}: Omit<React.ComponentProps<typeof MovementsPanel>, "view" | "onViewChange"> & { initialView: SearchView }) {
  const [view, setView] = React.useState<SearchView>(initialView);
  return React.createElement(MovementsPanel, { ...props, view, onViewChange: setView });
}

function mountPanel(initialView: SearchView = DEFAULT_SEARCH_VIEW) {
  const { bridge, futures } = setup();
  const calls = {
    edited: [] as string[],
    items: [] as string[],
    revealed: [] as string[],
    recorded: [] as string[],
    folded: 0,
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      React.createElement(SlicexMantineProvider, {
        theme: "light",
        children: React.createElement(AnnouncerProvider, {
          children: React.createElement(Harness, {
            initialView,
            bridge,
            futures,
            today: TODAY,
            onFold: () => {
              calls.folded += 1;
            },
            onRecord: (kind) => calls.recorded.push(kind),
            onEditMovement: (movement) => calls.edited.push(movement.id),
            onEditItem: (id) => calls.items.push(id),
            onRevealItem: (id) => calls.revealed.push(id),
          }),
        }),
      }),
    ),
  );
  return { bridge, futures, calls };
}

const panel = () => document.getElementById("fin-records")!;
const title = () => panel().querySelector("h2")!.textContent;
const figure = () => panel().querySelector(".fin-records__figure")?.textContent ?? null;
const caption = () => panel().querySelector(".fin-records__caption")!.textContent;
const concepts = () => [...panel().querySelectorAll(".fin-records__concept")].map((el) => el.textContent);

function button(text: string, scope: ParentNode = document): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`button "${text}" not found`);
  return found;
}

function chip(category: string): HTMLButtonElement {
  const found = [...panel().querySelectorAll<HTMLButtonElement>(".fin-records__chip")].find(
    (b) => b.querySelector("span")?.textContent === category,
  );
  if (!found) throw new Error(`chip "${category}" not found`);
  return found;
}

function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("MovementsPanel", () => {
  it("opens on this month's expenses, by day, newest first", () => {
    mountPanel();
    expect(panel().tagName).toBe("ASIDE");
    expect(title()).toBe("Gastos del mes");
    expect(figure()).toBe("$800");
    expect(caption()).toBe("2 movimientos");
    expect([...panel().querySelectorAll(".fin-records__day-head")].map((el) => el.textContent)).toEqual([
      "Hoy−$500",
      "Ayer−$300",
    ]);
    // Last month's and the income are not "Gastos del mes".
    expect(concepts()).toEqual(["Gasolina", "Tacos"]);
    const tacos = panel().querySelectorAll(".fin-records__row")[1]!;
    expect(tacos.textContent).toContain("Nu");
    expect(tacos.textContent).toContain("Comida");
    expect(tacos.textContent).toContain("con Ana");
  });

  it("a category chip narrows the list and stays to undo it; Todo shows the income too", () => {
    mountPanel();
    act(() => chip("Comida").click());
    expect(concepts()).toEqual(["Tacos"]);
    expect(figure()).toBe("$300");
    expect(caption()).toBe("1 movimiento en Comida");
    expect(chip("Comida").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Gasolina").getAttribute("aria-pressed")).toBe("false");
    act(() => chip("Comida").click());
    expect(concepts()).toEqual(["Gasolina", "Tacos"]);

    act(() => button("Todo", panel()).click());
    expect(title()).toBe("Movimientos del mes");
    expect(concepts()).toEqual(["Gasolina", "Venta", "Tacos"]);
    expect(figure()).toBe("+$400");
    expect(caption()).toBe("3 movimientos · gastos $800 · ingresos $1,200");
  });

  it("search; a recorded row opens it to edit", () => {
    const { calls } = mountPanel();
    const query = panel().querySelector<HTMLInputElement>(".fin-records__query")!;
    typeInto(query, "tacos");
    expect(concepts()).toEqual(["Tacos"]);
    act(() => panel().querySelector<HTMLButtonElement>("button.fin-records__row-main")!.click());
    expect(calls.edited).toEqual(["m2"]);
    typeInto(query, "viejo");
    expect(panel().textContent).toContain("Nada coincide con esos filtros.");
    typeInto(query, "");
    expect(concepts()).toEqual(["Gasolina", "Tacos"]);
  });

  it("an empty period offers every date", () => {
    mountPanel({ ...DEFAULT_SEARCH_VIEW, kind: "income", period: "last-month" });
    expect(title()).toBe("Ingresos del mes pasado");
    expect(figure()).toBe("$0");
    expect(caption()).toBe("Sin movimientos");
    // Empty: what the list is for.
    expect(panel().querySelector(".fin-records__empty-title")!.textContent).toBe("Gastos e ingresos no planeados");
    expect(panel().textContent).toContain(
      "Aquí ingresas gastos no previstos o cosas del día a día que afectan a tu cartera directamente.",
    );
    act(() => button("Ver todas las fechas", panel()).click());
    expect(title()).toBe("Todos tus ingresos");
    expect(concepts()).toEqual(["Venta"]);
    // One income category only: no chips (nothing to choose between).
    expect(panel().querySelector(".fin-records__chip")).toBeNull();
  });

  it("'En tu plan' lands on the same kind; quick actions per object", () => {
    const { calls } = mountPanel();
    act(() => button("Ingresos", panel()).click());
    const plan = panel().querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')!;
    expect(plan.textContent).toBe("En tu plan");
    act(() => plan.click());
    expect(title()).toBe("Ingresos de tu plan");
    expect(concepts()).toEqual(["Sueldo"]);
    // A figure over the plan list too (what it moves over the horizon), so
    // switching sections never shifts what is below.
    expect(figure()).toMatch(/^\$[\d,]+$/);
    expect(figure()).not.toBe("$0");
    expect(caption()).toBe("1 ingreso en el año");
    act(() => button("Editar", panel()).click());
    expect(calls.items).toEqual(["sueldo"]);
    act(() => button("Ver", panel()).click());
    expect(calls.revealed).toEqual(["sueldo"]);
    act(() => button("Tarjetas", panel()).click());
    expect(title()).toBe("Tarjetas de tu plan");
    expect(panel().textContent).toContain("Saldo · corte 5 · paga 15");
    act(() => button("Gastos", panel()).click());
    expect(panel().textContent).toContain("No hay gastos en tu plan.");
  });

  it("counts or not, from the list (one undo step)", () => {
    const { bridge } = mountPanel();
    act(() => button("Ingresos", panel()).click());
    act(() => panel().querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')!.click());
    const counts = panel().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(counts.checked).toBe(true);
    act(() => counts.click());
    expect(bridge.getItem("sueldo")?.enabled).toBe(false);
    expect(caption()).toBe("1 ingreso en el año · 1 no cuenta");
    // Excluded, it moves nothing.
    expect(figure()).toBe("$0");
    act(() => bridge.core.undo());
    expect(bridge.getItem("sueldo")?.enabled).not.toBe(false);
  });

  it("day by day: ‹ goes back a day, › stops at today, Hoy comes back", () => {
    mountPanel(withPeriod(DEFAULT_SEARCH_VIEW, "day"));
    expect(title()).toBe("Gastos de hoy");
    expect(concepts()).toEqual(["Gasolina"]);
    const next = panel().querySelector<HTMLButtonElement>('[aria-label="Día siguiente"]')!;
    expect(next.disabled).toBe(true);
    act(() => panel().querySelector<HTMLButtonElement>('[aria-label="Día anterior"]')!.click());
    expect(title()).toBe("Gastos de ayer");
    expect(concepts()).toEqual(["Tacos"]);
    expect(panel().querySelector(".fin-records__date")!.textContent).toBe("Ayer · mar 17 nov");
    act(() => panel().querySelector<HTMLButtonElement>('[aria-label="Día anterior"]')!.click());
    expect(title()).toBe("Gastos del lun 16 nov");
    act(() => button("Hoy", panel()).click());
    expect(title()).toBe("Gastos de hoy");
    expect(panel().querySelector(".fin-records__today")).toBeNull();
  });

  it("a picked range: its movements; ‹ › move it whole, never past today", () => {
    mountPanel(withPeriod(DEFAULT_SEARCH_VIEW, "range", "2026-10-01", "2026-10-31"));
    expect(title()).toBe("Gastos del 1 al 31 oct");
    expect(concepts()).toEqual(["Viejo"]);
    expect(panel().querySelector(".fin-records__date")!.textContent).toBe("1 – 31 oct");
    act(() => panel().querySelector<HTMLButtonElement>('[aria-label="31 días después"]')!.click());
    // 1 nov – 1 dic would pass today: it ends today, same length.
    expect(title()).toBe("Gastos del 19 oct al 18 nov");
    expect(concepts()).toEqual(["Gasolina", "Tacos", "Viejo"]);
    expect(panel().querySelector<HTMLButtonElement>('[aria-label="31 días después"]')!.disabled).toBe(true);
  });

  it("'Elegir fechas…' starts from what was on screen and opens the calendar; two clicks pick", () => {
    mountPanel();
    chooseOption(panel().querySelector('[aria-label="Periodo"]')!, "range");
    // "Este mes" on screen → this month so far.
    expect(title()).toBe("Gastos del 1 al 18 nov");
    expect(document.querySelector(".fin-cal")).not.toBeNull();
    const dayButton = (label: string) =>
      document.querySelector<HTMLButtonElement>(`.fin-cal button[aria-label="${label}"]`)!;
    act(() => dayButton("martes 17 de noviembre de 2026").click());
    expect(document.querySelector(".fin-cal__hint")!.textContent).toBe("Ahora el último día");
    act(() => dayButton("miércoles 18 de noviembre de 2026").click());
    expect(title()).toBe("Gastos del 17 al 18 nov");
    expect(concepts()).toEqual(["Gasolina", "Tacos"]);
    expect(document.querySelector(".fin-cal")).toBeNull();
  });

  it("its own Registrar opens the capture on the kind in view", () => {
    const { calls } = mountPanel();
    const record = panel().querySelector<HTMLButtonElement>(".fin-records__record")!;
    expect(record.textContent).toBe("Registrar");
    act(() => record.click());
    act(() => button("Ingresos", panel()).click());
    act(() => record.click());
    expect(calls.recorded).toEqual(["expense", "income"]);
  });

  it("the sections are tabs (←/→); × folds", () => {
    const { calls } = mountPanel();
    const tabs = [...panel().querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    act(() => tabs[0]!.focus());
    act(() => {
      tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(title()).toBe("Gastos de tu plan");
    expect(document.activeElement?.textContent).toBe("En tu plan");
    act(() => panel().querySelector<HTMLButtonElement>(".fin-records__fold")!.click());
    expect(calls.folded).toBe(1);
  });
});
