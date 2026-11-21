// @vitest-environment jsdom
// An open form survives a reload of the tab: the item editor and "Registrar"
// keep what was being written in sessionStorage and reopen with it. Garbage
// in storage never reaches a form.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FinancialDocument, FinancialItem } from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import { FinancialBridge } from "../src/finance/financial-bridge";
import { FINANCE_PLAYLIST_METRICS, createFinancialPlaylistState } from "../src/finance/mapping";
import { Futures } from "../src/finance/futures";
import {
  FORM_DRAFT_KEY,
  clearFormDraft,
  loadFormDraft,
  parseFormDraft,
  saveFormDraft,
  type FormDraft,
} from "../src/finance/form-draft";
import { FinancialEditorModal } from "../src/finance/components/FinancialEditorModal";
import { MovementCaptureDialog, type CaptureValues } from "../src/finance/components/MovementCaptureDialog";
import { DEFAULT_SEARCH_VIEW } from "../src/finance/movements-ui";
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
        id: "renta",
        kind: "expense",
        name: "Renta",
        amount: 8000,
        recurrence: { frequency: "monthly", startDate: "2026-12-01", endDate: "2027-05-01" },
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
  return { bridge: new FinancialBridge(core, doc) };
}

const CAPTURE: CaptureValues = {
  kind: "expense",
  amount: "750",
  concept: "Tacos",
  category: "Comida",
  paidWith: "cash",
  date: TODAY,
  time: "14:32",
  notes: "con Ana",
};

beforeEach(() => sessionStorage.clear());

describe("the stored draft", () => {
  it("round-trips each form", () => {
    const loan: FinancialItem = {
      id: "loan-1",
      kind: "loan",
      name: "Auto",
      paymentAmount: 2500,
      recurrence: { frequency: "monthly", startDate: "2026-12-15" },
    };
    const drafts: FormDraft[] = [
      { form: "editor", mode: "create", values: loan, placement: { trackIndex: 3 }, ui: { endBy: "date", loanInterest: true } },
      { form: "editor", mode: "edit", itemId: "renta", values: makeDoc().items[0]! },
      { form: "capture", movementId: null, values: CAPTURE },
    ];
    for (const draft of drafts) {
      saveFormDraft(draft);
      expect(loadFormDraft()).toEqual(draft);
    }
    clearFormDraft();
    expect(sessionStorage.getItem(FORM_DRAFT_KEY)).toBeNull();
    expect(loadFormDraft()).toBeNull();
  });

  it("a half-written item is fine (amounts may be missing); garbage is not", () => {
    const half = { id: "e", kind: "expense", name: "", recurrence: { frequency: "once", startDate: TODAY } };
    expect(parseFormDraft(JSON.stringify({ form: "editor", mode: "create", values: half }))).not.toBeNull();
    for (const bad of [
      "{not json",
      JSON.stringify({ form: "editor", mode: "create", values: { ...half, kind: "boat" } }),
      JSON.stringify({ form: "editor", mode: "edit", values: half }),
      JSON.stringify({ form: "editor", mode: "create", values: { ...half, recurrence: null } }),
      JSON.stringify({ form: "capture", values: { ...CAPTURE, amount: 750 } }),
      // "Buscar" was a dialog with a draft; the records panel keeps its own view.
      JSON.stringify({ form: "search", view: DEFAULT_SEARCH_VIEW }),
      JSON.stringify({ form: "rec" }),
    ]) {
      expect(parseFormDraft(bad)).toBeNull();
    }
  });
});

// --- the forms, rendered -------------------------------------------------------

let root: Root | null = null;

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

function fieldInput(label: string): HTMLInputElement {
  const span = [...document.querySelectorAll(".fin-editor__label")].find((s) => s.textContent?.startsWith(label));
  const input = span?.closest(".fin-editor__field")?.querySelector("input");
  if (!input) throw new Error(`field "${label}" not found`);
  return input as HTMLInputElement;
}

describe("the item editor reopens as it was", () => {
  it("create: the restored values show, keep counting as unsaved, and every change is reported", () => {
    const { bridge } = setup();
    const draft = bridge.createDraftItem("loan");
    const onDraftChange = vi.fn();
    mount(
      React.createElement(FinancialEditorModal, {
        bridge,
        draft,
        today: TODAY,
        onClose: () => {},
        onDraftChange,
        restore: {
          values: { ...draft, name: "Auto", paymentAmount: 2500, annualRate: 24 } as FinancialItem,
          ui: { endBy: "date", loanInterest: true },
        },
      }),
    );
    expect(fieldInput("Nombre").value).toBe("Auto");
    expect(fieldInput("¿Cuánto pagas?").value).toBe("2500");
    // "Con intereses" was chosen: its rate is back.
    expect(fieldInput("Tasa anual").value).toBe("24");
    expect(onDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "Auto", paymentAmount: 2500 }),
      { endBy: "date", loanInterest: true },
    );
    typeInto(fieldInput("Nombre"), "Auto nuevo");
    expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Auto nuevo" }), expect.anything());
    // A press outside asks: the restored edits are still unsaved.
    const overlay = document.querySelector<HTMLElement>(".playlist-shell__modal-overlay")!;
    act(() => {
      overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      overlay.click();
    });
    expect(document.body.textContent).toContain("Tienes cambios sin guardar.");
  });

  it("edit: an item edited before the reload comes back with the edits", () => {
    const { bridge } = setup();
    const item = bridge.getItem("renta")!;
    mount(
      React.createElement(FinancialEditorModal, {
        bridge,
        itemId: "renta",
        today: TODAY,
        onClose: () => {},
        restore: { values: { ...item, amount: 9500 } as FinancialItem },
      }),
    );
    expect(fieldInput("Monto").value).toBe("9500");
    expect(bridge.getItem("renta")).toMatchObject({ amount: 8000 });
  });
});

describe("'Registrar' reopens as it was", () => {
  it("the restored values show and every change is reported", () => {
    const { bridge } = setup();
    const futures = new Futures(bridge);
    const onValuesChange = vi.fn();
    mount(
      React.createElement(MovementCaptureDialog, {
        bridge,
        futures,
        today: TODAY,
        onClose: () => {},
        restoreValues: CAPTURE,
        onValuesChange,
      }),
    );
    const amount = document.querySelector<HTMLInputElement>(".fin-capture__amount")!;
    expect(amount.value).toBe("750");
    expect(document.querySelector<HTMLTextAreaElement>(".fin-capture__notes")!.value).toBe("con Ana");
    expect(onValuesChange).toHaveBeenLastCalledWith(CAPTURE);
    typeInto(amount, "800");
    expect(onValuesChange).toHaveBeenLastCalledWith({ ...CAPTURE, amount: "800" });
  });
});
