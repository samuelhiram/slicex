// @vitest-environment jsdom
// Headless render tests of the financial React components against a small
// in-memory FinancialBridgeApi (real @slicex/core projection, fake playlist
// core). Regression tests for the adversarial-review findings react-1/3/4/
// 5/6/7/8, SYNC-8 and SYNC-13 (editor side).
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  addDays,
  createDefaultFinancialItem,
  createDemoFinancialDocument,
  debtByAccountAt,
  diffDays,
  findLiquidityWarnings,
  nextPayment,
  projectFinancialDocument,
  snapshotAt,
  type FinancialDocument,
  type FinancialItem,
  type FinancialItemKind,
} from "@slicex/core";
import type { PlaylistCore } from "@slicex/canvas";
import type { FinancialBridgeApi } from "../src/finance/bridge-api";
import { formatMoneyWhole } from "../src/finance/format";
import {
  FinancialEditorModal,
  normalizeForSave,
  switchKind,
} from "../src/finance/components/FinancialEditorModal";
import { FinancialSummaryBar } from "../src/finance/components/FinancialSummaryBar";
import { FinancialSidePanel } from "../src/finance/components/FinancialSidePanel";
import { DebtStrategyPanel } from "../src/finance/components/DebtStrategyPanel";

const h = React.createElement;
const START = "2026-11-07";

// --- fakes -----------------------------------------------------------------

interface FakeCoreState {
  playPosition: { time: number; isRunning: boolean };
  tracks: unknown[];
  clips: unknown[];
  viewport: { width: number; pxPerBeat: number; scrollX: number };
}

function createFakeCore(time = 0) {
  let state: FakeCoreState = {
    playPosition: { time, isRunning: false },
    tracks: [],
    clips: [],
    viewport: { width: 1200, pxPerBeat: 10, scrollX: 0 },
  };
  const listeners = new Set<(s: FakeCoreState) => void>();
  const core = {
    getState: () => state,
    subscribe(listener: (s: FakeCoreState) => void) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
    setPlayPosition(t: number) {
      state = { ...state, playPosition: { ...state.playPosition, time: t } };
      for (const l of [...listeners]) l(state);
    },
    updateViewport() {},
  };
  return {
    core: core as unknown as PlaylistCore,
    /** Simulates a track change (e.g. a lock toggle): new `tracks` ref. */
    touchTracks() {
      state = { ...state, tracks: [...state.tracks] };
      for (const l of [...listeners]) l(state);
    },
  };
}

interface FakeOptions {
  time?: number;
  /** replaceItem / deleteItem return false (e.g. vetoed by the playlist). */
  failWrites?: boolean;
}

function createFakeBridge(initial: FinancialDocument, options: FakeOptions = {}) {
  let doc = initial;
  let projection = projectFinancialDocument(doc);
  let revision = 0;
  const listeners = new Set<() => void>();
  const locked = new Set<string>();
  const fakeCore = createFakeCore(options.time ?? 0);
  const commit = (next: FinancialDocument) => {
    doc = next;
    projection = projectFinancialDocument(doc);
    revision += 1;
    for (const l of [...listeners]) l();
  };
  const bridge = {
    core: fakeCore.core,
    getRevision: () => revision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getDocument: () => doc,
    getProjection: () => projection,
    getItem: (id: string) => doc.items.find((item) => item.id === id) ?? null,
    replaceItem: vi.fn((item: FinancialItem) => {
      if (options.failWrites || locked.has(item.id)) return false;
      if (!doc.items.some((i) => i.id === item.id)) return false;
      commit({ ...doc, items: doc.items.map((i) => (i.id === item.id ? item : i)) });
      return true;
    }),
    deleteItem: vi.fn((id: string) => {
      if (options.failWrites || locked.has(id)) return false;
      if (!doc.items.some((i) => i.id === id)) return false;
      commit({ ...doc, items: doc.items.filter((i) => i.id !== id) });
      return true;
    }),
    isItemLocked: (id: string) => locked.has(id),
    createDraftItem: vi.fn((kind: FinancialItemKind) =>
      createDefaultFinancialItem(kind, `draft-${kind}`, doc.startDate, doc),
    ),
    addItem: vi.fn((item: FinancialItem) => {
      commit({ ...doc, items: [...doc.items, item] });
      return item.id;
    }),
    setInitialCash: (amount: number) => commit({ ...doc, initialCash: amount }),
    setMinimumCashReserve: (amount: number) =>
      commit({ ...doc, minimumCashReserve: amount }),
    dateAtBeat: (beat: number) => addDays(doc.startDate, Math.floor(beat)),
    beatAtDate: (date: string) => diffDays(doc.startDate, date),
    snapshotAt: (date: string) => snapshotAt(projection, date),
    nextPaymentAfter: (date: string) => nextPayment(projection, date),
    getWarnings: () => findLiquidityWarnings(projection, doc.minimumCashReserve),
    getClipDetail: () => null,
    getClipSparkline: () => null,
    destroy: () => listeners.clear(),
  } satisfies FinancialBridgeApi;
  return { bridge, locked, fakeCore };
}

// --- DOM helpers -------------------------------------------------------------

let root: Root | null = null;
let container: HTMLElement | null = null;

function mount(element: React.ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

function unmount() {
  act(() => root?.unmount());
  root = null;
}

afterEach(() => {
  if (root) unmount();
  document.body.innerHTML = "";
});

function buttonByText(scope: ParentNode, text: string): HTMLButtonElement | null {
  return (
    [...scope.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === text,
    ) ?? null
  );
}

function mustButton(scope: ParentNode, text: string): HTMLButtonElement {
  const button = buttonByText(scope, text);
  if (!button) throw new Error(`button "${text}" not found`);
  return button;
}

/** The input / select of the editor field whose label starts with `label`. */
function field<T extends HTMLElement = HTMLInputElement>(label: string): T {
  const span = [...document.querySelectorAll(".fin-editor__label")].find((s) =>
    s.textContent?.startsWith(label),
  );
  const control = span
    ?.closest(".fin-editor__field")
    ?.querySelector("input, select");
  if (!control) throw new Error(`field "${label}" not found`);
  return control as T;
}

/** Changes a React-controlled <select> like a user would. */
function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.click();
  });
}

function pressEscape() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
}

function errorText(): string {
  return document.querySelector(".fin-editor__error")?.textContent ?? "";
}

function docWith(items: FinancialItem[]): FinancialDocument {
  return {
    id: "t",
    name: "Test",
    startDate: START,
    initialCash: 10000,
    minimumCashReserve: 0,
    horizonMonths: 12,
    items,
  };
}

// --- react-1 / SYNC-8 -------------------------------------------------------

describe("react-1 / SYNC-8: a single occurrence is saved on the shown date", () => {
  it("normalizeForSave drops the anchor of a once item and closes its window", () => {
    const saved = normalizeForSave({
      id: "x",
      kind: "expense",
      name: " Renta ",
      amount: 10,
      recurrence: {
        frequency: "once",
        startDate: "2026-11-20",
        endDate: "2026-12-31",
        anchorDate: "2026-11-15",
      },
    });
    expect(saved.name).toBe("Renta");
    expect(saved.recurrence).toEqual({
      frequency: "once",
      startDate: "2026-11-20",
      endDate: "2026-11-20",
    });
    expect("anchorDate" in saved.recurrence).toBe(false);
  });

  it("normalizeForSave keeps the anchor of a recurring item (paydays)", () => {
    const saved = normalizeForSave({
      id: "x",
      kind: "income",
      name: "Sueldo",
      amount: 10,
      recurrence: {
        frequency: "biweekly",
        startDate: "2026-11-20",
        anchorDate: "2026-11-13",
      },
    });
    expect(saved.recurrence).toEqual({
      frequency: "biweekly",
      startDate: "2026-11-20",
      anchorDate: "2026-11-13",
    });
  });

  it("Frecuencia → 'Una vez' on a left-cropped loan saves {once, Fecha}", () => {
    const loan: FinancialItem = {
      id: "fin-prestamo",
      kind: "loan",
      name: "Préstamo personal",
      paymentAmount: 7500,
      recurrence: {
        frequency: "monthly",
        startDate: "2026-11-20",
        endDate: "2027-05-07",
        anchorDate: "2026-11-15",
      },
    };
    const { bridge } = createFakeBridge(docWith([loan]));
    const onClose = vi.fn();
    mount(h(FinancialEditorModal, { bridge, itemId: loan.id, onClose }));
    expect(field("Fecha").value).toBe("2026-11-20");
    choose(field<HTMLSelectElement>("Frecuencia"), "once");
    click(mustButton(document, "Guardar"));
    expect(bridge.replaceItem).toHaveBeenCalledTimes(1);
    const saved = bridge.replaceItem.mock.calls[0]![0];
    expect(saved.recurrence).toEqual({
      frequency: "once",
      startDate: "2026-11-20",
      endDate: "2026-11-20",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("a kind switch that lands on 'once' does not keep the old anchor", () => {
    const card: FinancialItem = {
      id: "fin-card",
      kind: "credit-card",
      name: "Tarjeta",
      balance: 0,
      annualRate: 50,
      cutDay: 1,
      dueDay: 10,
      minimumPayment: 0,
      recurrence: {
        frequency: "monthly",
        startDate: "2026-11-20",
        anchorDate: "2026-11-13",
      },
    };
    const { bridge } = createFakeBridge(docWith([card]));
    mount(h(FinancialEditorModal, { bridge, itemId: card.id, onClose: () => {} }));
    choose(field<HTMLSelectElement>("Tipo"), "expense");
    click(mustButton(document, "Guardar"));
    const saved = bridge.replaceItem.mock.calls[0]![0];
    expect(saved.kind).toBe("expense");
    expect(saved.recurrence).toEqual({
      frequency: "once",
      startDate: "2026-11-20",
      endDate: "2026-11-20",
    });
  });
});

// --- react-3 -----------------------------------------------------------------

const NU: FinancialItem = {
  id: "fin-nu",
  kind: "credit-card",
  name: "Nu",
  balance: 30069,
  annualRate: 99.9,
  cutDay: 15,
  dueDay: 26,
  minimumPayment: 1500,
  recurrence: { frequency: "monthly", startDate: START },
};

describe("react-3: converting a card never picks itself / a dead card blocks nothing", () => {
  it("switchKind does not use the edited card as the new MSI's card", () => {
    const doc = docWith([NU]);
    const next = switchKind(NU, "installment-plan", doc);
    expect(next.kind).toBe("installment-plan");
    expect(next.kind === "installment-plan" ? next.cardId : "n/a").toBeUndefined();
  });

  it("only card → Tipo MSI: no error, Guardar enabled, saved without a card", () => {
    const { bridge } = createFakeBridge(docWith([NU]));
    mount(h(FinancialEditorModal, { bridge, itemId: NU.id, onClose: () => {} }));
    choose(field<HTMLSelectElement>("Tipo"), "installment-plan");
    expect(errorText()).toBe("");
    const save = mustButton(document, "Guardar");
    expect(save.disabled).toBe(false);
    click(save);
    const saved = bridge.replaceItem.mock.calls[0]![0];
    expect(saved.kind).toBe("installment-plan");
    expect("cardId" in saved).toBe(false);
  });

  it("an MSI whose card was deleted shows it as a selectable-away option", () => {
    const msi: FinancialItem = {
      id: "fin-msi",
      kind: "installment-plan",
      name: "Laptop",
      cardId: "fin-gone",
      originalAmount: 1200,
      installmentsTotal: 12,
      installmentsPaid: 0,
      recurrence: { frequency: "monthly", startDate: START },
    };
    const { bridge } = createFakeBridge(docWith([msi]));
    mount(h(FinancialEditorModal, { bridge, itemId: msi.id, onClose: () => {} }));
    expect(errorText()).toBe("Tarjeta: la tarjeta ya no existe.");
    const select = field<HTMLSelectElement>("Tarjeta");
    // The dead id is the selected option, so "— Sin tarjeta —" is a REAL
    // change for the browser (picking the selected option fires nothing).
    expect(select.value).toBe("fin-gone");
    expect(select.selectedOptions[0]?.textContent).toBe("(tarjeta eliminada)");
    choose(select, "");
    expect(errorText()).toBe("");
    expect(mustButton(document, "Guardar").disabled).toBe(false);
  });
});

// --- react-4 -----------------------------------------------------------------

describe("react-4: '+ Ingreso' creates nothing until Guardar", () => {
  it("summary bar '+ Ingreso' hands a draft to the shell and adds nothing", () => {
    const { bridge } = createFakeBridge(createDemoFinancialDocument(START));
    const before = bridge.getDocument().items.length;
    const onCreateDraft = vi.fn();
    mount(h(FinancialSummaryBar, { bridge, onCreateDraft }));
    click(mustButton(document, "+ Ingreso"));
    expect(bridge.createDraftItem).toHaveBeenCalledWith("income");
    expect(onCreateDraft).toHaveBeenCalledTimes(1);
    expect(onCreateDraft.mock.calls[0]![0]).toBe(
      bridge.createDraftItem.mock.results[0]!.value,
    );
    expect(bridge.addItem).not.toHaveBeenCalled();
    expect(bridge.getDocument().items.length).toBe(before);
  });

  it.each([
    ["Cancelar", () => click(mustButton(document, "Cancelar"))],
    ["×", () => click(mustButton(document, "×"))],
    ["Escape", () => pressEscape()],
    [
      "overlay",
      () => click(document.querySelector(".playlist-shell__modal-overlay") as HTMLElement),
    ],
  ])("closing a draft with %s adds nothing", (_name, close) => {
    const { bridge } = createFakeBridge(createDemoFinancialDocument(START));
    const before = bridge.getProjection().finalCash;
    const draft = bridge.createDraftItem("income");
    const onClose = vi.fn();
    mount(h(FinancialEditorModal, { bridge, draft, onClose }));
    close();
    expect(onClose).toHaveBeenCalled();
    expect(bridge.addItem).not.toHaveBeenCalled();
    expect(bridge.getDocument().items.length).toBe(7);
    expect(bridge.getProjection().finalCash).toBe(before);
  });

  it("draft mode: 'Nuevo …' title, no Eliminar, Guardar adds the item once", () => {
    const { bridge } = createFakeBridge(createDemoFinancialDocument(START));
    const draft = bridge.createDraftItem("income");
    const onClose = vi.fn();
    mount(h(FinancialEditorModal, { bridge, draft, onClose }));
    expect(document.querySelector(".fin-editor__title")?.textContent).toBe(
      "Nuevo Ingreso",
    );
    expect(buttonByText(document, "Eliminar")).toBeNull();
    click(mustButton(document, "Guardar"));
    expect(bridge.addItem).toHaveBeenCalledTimes(1);
    expect(bridge.addItem.mock.calls[0]![0]).toEqual(normalizeForSave(draft));
    expect(bridge.replaceItem).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bridge.getDocument().items.length).toBe(8);
  });

  it("an invalid draft (purchase without cards) cannot be saved nor leaks on cancel", () => {
    const { bridge } = createFakeBridge(docWith([]));
    const draft = bridge.createDraftItem("card-purchase");
    mount(h(FinancialEditorModal, { bridge, draft, onClose: () => {} }));
    expect(errorText()).toBe("Tarjeta: selecciona una tarjeta.");
    expect(mustButton(document, "Guardar").disabled).toBe(true);
    click(mustButton(document, "Cancelar"));
    expect(bridge.addItem).not.toHaveBeenCalled();
    expect(bridge.getProjection().finalDebt).toBe(0);
  });
});

// --- react-7 / SYNC-13 ---------------------------------------------------------

describe("react-7 / SYNC-13: locked track → read-only editor, failures stay open", () => {
  const GASTO: FinancialItem = {
    id: "fin-gasto",
    kind: "expense",
    name: "Gasto",
    amount: 2000,
    recurrence: { frequency: "once", startDate: "2026-11-20", endDate: "2026-11-20" },
  };

  it("opens read-only with 'Pista bloqueada' when the item's track is locked", () => {
    const { bridge, locked } = createFakeBridge(docWith([GASTO]));
    locked.add(GASTO.id);
    mount(h(FinancialEditorModal, { bridge, itemId: GASTO.id, onClose: () => {} }));
    expect(document.querySelector(".fin-editor__locked")?.textContent).toContain(
      "Pista bloqueada",
    );
    const controls = document.querySelectorAll(".fin-editor input, .fin-editor select");
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.matches(":disabled")).toBe(true);
    expect(mustButton(document, "Guardar").disabled).toBe(true);
    const remove = mustButton(document, "Eliminar");
    expect(remove.disabled).toBe(true);
    click(remove);
    expect(bridge.deleteItem).not.toHaveBeenCalled();
    expect(bridge.getItem(GASTO.id)).not.toBeNull();
  });

  it("becomes read-only when the track gets locked while the editor is open", () => {
    const { bridge, locked, fakeCore } = createFakeBridge(docWith([GASTO]));
    mount(h(FinancialEditorModal, { bridge, itemId: GASTO.id, onClose: () => {} }));
    expect(mustButton(document, "Eliminar").disabled).toBe(false);
    locked.add(GASTO.id);
    act(() => fakeCore.touchTracks());
    expect(mustButton(document, "Eliminar").disabled).toBe(true);
    expect(mustButton(document, "Guardar").disabled).toBe(true);
  });

  it("Eliminar refused by the bridge keeps the modal open with an error", () => {
    const { bridge } = createFakeBridge(docWith([GASTO]), { failWrites: true });
    const onClose = vi.fn();
    mount(h(FinancialEditorModal, { bridge, itemId: GASTO.id, onClose }));
    click(mustButton(document, "Eliminar"));
    expect(bridge.deleteItem).toHaveBeenCalledWith(GASTO.id);
    expect(onClose).not.toHaveBeenCalled();
    expect(errorText()).toMatch(/No se eliminó/);
  });

  it("Guardar refused by the bridge keeps the modal open with an error", () => {
    const { bridge } = createFakeBridge(docWith([GASTO]), { failWrites: true });
    const onClose = vi.fn();
    mount(h(FinancialEditorModal, { bridge, itemId: GASTO.id, onClose }));
    click(mustButton(document, "Guardar"));
    expect(bridge.replaceItem).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(errorText()).toMatch(/No se guardó/);
  });
});

// --- react-8 -----------------------------------------------------------------

describe("react-8: the editor gives focus back on close", () => {
  const GASTO: FinancialItem = {
    id: "fin-gasto",
    kind: "expense",
    name: "Gasto",
    amount: 2000,
    recurrence: { frequency: "once", startDate: "2026-11-20", endDate: "2026-11-20" },
  };

  it("restores focus to the element focused before opening", () => {
    const { bridge } = createFakeBridge(docWith([GASTO]));
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    mount(h(FinancialEditorModal, { bridge, itemId: GASTO.id, onClose: () => {} }));
    expect(document.activeElement).toBe(field("Nombre"));
    unmount();
    expect(document.activeElement).toBe(opener);
  });

  it("falls back (canvas host) when the opener was <body> or is gone", () => {
    const { bridge } = createFakeBridge(docWith([GASTO]));
    const host = document.createElement("div");
    host.tabIndex = 0;
    document.body.appendChild(host);
    (document.activeElement as HTMLElement | null)?.blur();
    mount(
      h(FinancialEditorModal, {
        bridge,
        itemId: GASTO.id,
        onClose: () => {},
        returnFocusFallback: () => host,
      }),
    );
    unmount();
    expect(document.activeElement).toBe(host);

    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    mount(
      h(FinancialEditorModal, {
        bridge,
        itemId: GASTO.id,
        onClose: () => {},
        returnFocusFallback: () => host,
      }),
    );
    opener.remove();
    unmount();
    expect(document.activeElement).toBe(host);
  });
});

// --- react-6 -----------------------------------------------------------------

describe("react-6: the pinned scenario base survives closing the rail", () => {
  it("Fijar base → close rail → reopen: the base and Δ column are still there", () => {
    const { bridge } = createFakeBridge(createDemoFinancialDocument(START));
    mount(h(FinancialSidePanel, { bridge, defaultOpen: true }));
    click(mustButton(document, "Fijar base"));
    expect(buttonByText(document, "Soltar base")).not.toBeNull();
    click(
      document.querySelector('[aria-label="Cerrar análisis financiero"]') as HTMLElement,
    );
    expect(buttonByText(document, "Soltar base")).toBeNull();
    click(
      document.querySelector('[aria-label="Abrir análisis financiero"]') as HTMLElement,
    );
    expect(buttonByText(document, "Soltar base")).not.toBeNull();
    expect(mustButton(document, "Re-fijar base")).toBeTruthy();
    expect(document.querySelectorAll(".fin-table__delta").length).toBe(3);
    click(mustButton(document, "Soltar base"));
    expect(buttonByText(document, "Soltar base")).toBeNull();
  });
});

// --- react-5 -----------------------------------------------------------------

describe("react-5: avalanche uses the debts still owed at the playhead day", () => {
  function rows() {
    return [...document.querySelectorAll(".fin-table tbody tr")].map((tr) => {
      const cells = tr.querySelectorAll("td");
      return {
        name: cells[1]?.textContent ?? "",
        balance: cells[3]?.textContent ?? "",
      };
    });
  }

  it("day 0 lists every opening debt (loan included)", () => {
    const { bridge } = createFakeBridge(createDemoFinancialDocument(START), { time: 0 });
    mount(h(DebtStrategyPanel, { bridge }));
    expect(rows().map((r) => r.name)).toContain("Préstamo personal");
  });

  it("day 250 drops the paid-off loan and shows that day's balances", () => {
    const { bridge } = createFakeBridge(createDemoFinancialDocument(START), {
      time: 250,
    });
    mount(h(DebtStrategyPanel, { bridge }));
    const date = bridge.dateAtBeat(250);
    expect(date).toBe("2027-07-15");
    const balances = debtByAccountAt(bridge.getProjection(), date);
    const shown = rows();
    expect(shown.map((r) => r.name)).not.toContain("Préstamo personal");
    const byName = new Map(shown.map((r) => [r.name, r.balance]));
    expect(byName.get("Laptop 12 MSI")).toBe(
      formatMoneyWhole(balances.get("fin-laptop-msi") ?? 0),
    );
    expect(byName.get("Nu")).toBe(formatMoneyWhole(balances.get("fin-nu") ?? 0));
    expect(byName.get("Nu")).not.toBe(formatMoneyWhole(30069));
  });

  it("follows the playhead day", () => {
    const { bridge, fakeCore } = createFakeBridge(createDemoFinancialDocument(START), {
      time: 0,
    });
    mount(h(DebtStrategyPanel, { bridge }));
    expect(rows().map((r) => r.name)).toContain("Préstamo personal");
    act(() =>
      (fakeCore.core as unknown as { setPlayPosition(t: number): void }).setPlayPosition(
        250,
      ),
    );
    expect(rows().map((r) => r.name)).not.toContain("Préstamo personal");
  });
});
