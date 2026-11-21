// @vitest-environment jsdom
// The item editor's shape preview: a piece of timeline on top of the form
// with the item's card as the canvas draws it. The window around its
// dates, the card (a window, open-ended, one date), a mark per payment, the
// month labels (never on top of each other) and the editor mounting it,
// visual only, with the form's live values.
import { afterEach, describe, expect, it } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FinancialDocument, FinancialItem } from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import { FinancialBridge } from "../src/finance/financial-bridge";
import { FINANCE_PLAYLIST_METRICS, createFinancialPlaylistState } from "../src/finance/mapping";
import { SHAPE_MAX_MARKS, shapeModel } from "../src/finance/components/ShapePreview";
import { FinancialEditorModal } from "../src/finance/components/FinancialEditorModal";
import { SlicexMantineProvider } from "../src/mantine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-11-19";

const LOAN: FinancialItem = {
  id: "loan",
  kind: "loan",
  name: "Préstamo",
  paymentAmount: 7500,
  recurrence: { frequency: "monthly", startDate: "2026-11-27", endDate: "2027-04-27" },
};
const PAY: FinancialItem = {
  id: "sal",
  kind: "income",
  name: "Sueldo",
  amount: 9000,
  recurrence: { frequency: "biweekly", startDate: "2026-11-20" },
};
const ONCE: FinancialItem = {
  id: "bono",
  kind: "income",
  name: "Bono",
  amount: 4000,
  recurrence: { frequency: "once", startDate: "2026-12-09", endDate: "2026-12-09" },
};

describe("the window and the card", () => {
  it("a window with an end: the card from its start to its end, room on both sides", () => {
    const model = shapeModel(LOAN, TODAY);
    const card = model.card!;
    expect(card.open).toBe(false);
    expect(card.point).toBe(false);
    expect(card.left).toBeGreaterThan(0);
    expect(card.left + card.width).toBeLessThan(1);
    // One mark per payment: 27 nov … 27 abr.
    expect(model.marks).toHaveLength(6);
    for (const mark of model.marks) {
      expect(mark).toBeGreaterThanOrEqual(card.left);
      expect(mark).toBeLessThanOrEqual(card.left + card.width);
    }
    // "Hoy" (before the first payment) is in the strip, before the card.
    expect(model.today).not.toBeNull();
    expect(model.today!).toBeLessThan(card.left);
  });

  it("open-ended: the card runs to the strip's right edge, with several payments", () => {
    const model = shapeModel(PAY, TODAY);
    expect(model.card!.open).toBe(true);
    expect(model.card!.left + model.card!.width).toBeCloseTo(1, 9);
    expect(model.marks.length).toBeGreaterThanOrEqual(4);
  });

  it("one date: a card at its day, as wide as its text (no width), a month around it", () => {
    const model = shapeModel(ONCE, TODAY);
    expect(model.card!.point).toBe(true);
    expect(model.card!.width).toBe(0);
    expect(model.days).toBeGreaterThanOrEqual(28);
    expect(model.days).toBeLessThanOrEqual(35);
    expect(model.card!.left).toBeGreaterThan(0.2);
    expect(model.card!.left).toBeLessThan(0.4);
  });

  it("no valid start yet: the strip without a card", () => {
    const model = shapeModel({ ...PAY, recurrence: { frequency: "monthly", startDate: "" } }, TODAY);
    expect(model.card).toBeNull();
    expect(model.marks).toEqual([]);
    expect(model.ticks.length).toBeGreaterThan(0);
  });

  it("a very long weekly window keeps at most SHAPE_MAX_MARKS marks", () => {
    const weekly: FinancialItem = {
      ...PAY,
      recurrence: { frequency: "weekly", startDate: "2026-11-20", endDate: "2036-11-20" },
    };
    const model = shapeModel(weekly, TODAY);
    expect(model.marks.length).toBeLessThanOrEqual(SHAPE_MAX_MARKS);
    expect(model.marks.length).toBeGreaterThan(100);
  });
});

describe("the months", () => {
  it("the strip's month with its year first, then one line per month", () => {
    const model = shapeModel(LOAN, TODAY);
    expect(model.ticks[0]).toEqual({ at: 0, label: "nov 2026" });
    const labels = model.ticks.map((tick) => tick.label).filter(Boolean);
    expect(labels).toContain("ene 2027");
    expect(labels).toContain("mar");
  });

  it("measured: labels never overlap, nor run past the right edge (a narrow strip shows fewer)", () => {
    for (const width of [340, 700]) {
      const ticks = shapeModel(LOAN, TODAY, width).ticks.filter((tick) => tick.label);
      for (let i = 1; i < ticks.length; i++) {
        const previous = ticks[i - 1]!;
        expect((ticks[i]!.at - previous.at) * width).toBeGreaterThanOrEqual(8 + previous.label.length * 6.6);
      }
      const last = ticks[ticks.length - 1]!;
      expect(last.at * width + 8 + last.label.length * 6.6).toBeLessThanOrEqual(width);
    }
    const narrow = shapeModel(LOAN, TODAY, 340).ticks.filter((tick) => tick.label).length;
    const wide = shapeModel(LOAN, TODAY, 700).ticks.filter((tick) => tick.label).length;
    expect(narrow).toBeLessThan(wide);
  });

  it("years instead of months on a window of years", () => {
    const long: FinancialItem = {
      ...LOAN,
      recurrence: { frequency: "monthly", startDate: "2026-11-27", endDate: "2031-11-27" },
    };
    const labels = shapeModel(long, TODAY).ticks.map((tick) => tick.label).filter(Boolean);
    expect(labels[0]).toBe("2026");
    for (const label of labels) expect(label).toMatch(/^\d{4}$/);
  });
});

describe("in the editor", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("on top of the form: the item's card with its name, amount and dates; visual only", () => {
    const doc: FinancialDocument = {
      id: "t",
      name: "t",
      startDate: "2026-11-07",
      initialCash: 5000,
      minimumCashReserve: 1000,
      horizonMonths: 12,
      items: [LOAN],
    };
    const core = createPlaylistCore(createFinancialPlaylistState(doc), {
      metrics: FINANCE_PLAYLIST_METRICS,
      stretchEnabled: false,
    });
    const bridge = new FinancialBridge(core, doc);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        React.createElement(SlicexMantineProvider, {
          theme: "dark",
          children: React.createElement(FinancialEditorModal, {
            bridge,
            itemId: LOAN.id,
            onClose: () => {},
            today: TODAY,
          }),
        }),
      ),
    );
    const shape = document.querySelector<HTMLElement>(".fin-sheet__shape .fin-shape")!;
    expect(shape).not.toBeNull();
    expect(shape.getAttribute("aria-hidden")).toBe("true");
    // Before the form in the sheet's order.
    const main = document.querySelector(".fin-sheet__main")!;
    expect(shape.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const card = shape.querySelector(".fin-shape__card")!;
    expect(card.querySelector(".fin-shape__title")?.textContent).toBe("Préstamo");
    expect(card.querySelector(".fin-shape__detail")?.textContent).toContain("7,500");
    expect(card.querySelector(".fin-shape__period")?.textContent).toBe("27 nov 2026 – 27 abr 2027");
    expect(card.querySelectorAll(".fin-shape__mark")).toHaveLength(6);
    expect(shape.style.getPropertyValue("--clip-color")).not.toBe("");
  });
});
