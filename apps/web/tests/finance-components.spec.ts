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
  type FinancialProjectionPoint,
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
import { OnboardingDialog } from "../src/finance/components/Onboarding";
import { FinancialSidePanel } from "../src/finance/components/FinancialSidePanel";
import { DebtStrategyPanel } from "../src/finance/components/DebtStrategyPanel";
import { RecDialog } from "../src/finance/components/RecDialog";
import { StatementDialog } from "../src/finance/components/StatementDialog";
import { SlicexMantineProvider } from "../src/mantine";

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
    getClipContent: () => null,
    getOverviewData: () => null,
    getDragAnnotation: () => null,
    getTrackMeta: () => null,
    isHighlighted: () => false,
    canExtend: () => true,
    getDayDetail: () => null,
    getTrackLayout: () => ({ tracks: [], placement: {} }),
    levelDrag: () => null,
    valleyAt: () => null,
    applyValleyFix: vi.fn(() => false),
    setHighlight: vi.fn(),
    setPreview: vi.fn(),
    getPreview: () => null,
    getPreviewEffect: () => null,
    setComparison: vi.fn(),
    getComparison: () => null,
    animateFrom: vi.fn(),
    isAnimating: () => false,
    exportSession: () => ({ session: { history: null }, doc }),
    importSession: vi.fn(),
    loadDocument: vi.fn((next: FinancialDocument) => commit(next)),
    destroy: () => listeners.clear(),
  } satisfies FinancialBridgeApi;
  return { bridge, locked, fakeCore };
}

// --- DOM helpers -------------------------------------------------------------

let root: Root | null = null;
let container: HTMLElement | null = null;

/** Renders inside the app's Mantine provider (the forms' DateField needs it), as the shell does. */
function mount(element: React.ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(h(SlicexMantineProvider, { theme: "light", children: element })));
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
  // The control the label names (htmlFor), else the field's first one.
  const named =
    span instanceof HTMLLabelElement && span.htmlFor ? document.getElementById(span.htmlFor) : null;
  const control = named ?? span?.closest(".fin-editor__field")?.querySelector("input, select");
  if (!control) throw new Error(`field "${label}" not found`);
  return control as T;
}

/** Types into a React-controlled text <input> like a user would. */
function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Types into a React-controlled <textarea> like a user would. */
function typeIntoArea(area: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The message an input's aria-describedby points at ("" when none). */
function describedText(input: HTMLElement): string {
  const id = input.getAttribute("aria-describedby");
  return id ? (document.getElementById(id)?.textContent ?? "") : "";
}

function pressKey(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}

function blur(input: HTMLElement) {
  act(() => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    input.blur();
  });
}

/** The live preview / validation line under a date field. */
function datePreview(label: string): HTMLElement {
  const input = field(label);
  return input.closest(".fin-editor__field")!.querySelector(".fin-date__preview")!;
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

/** A "Se repite" preset (one-click schedule) by its text. */
function preset(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>(".fin-repeat__preset")].find(
    (candidate) => candidate.textContent === text,
  );
  if (!button) throw new Error(`preset "${text}" not found`);
  return button;
}

/** A "Termina" option's radio by its words ("Nunca", "El", "Después de"). */
function endOption(text: string): HTMLInputElement {
  const label = [...document.querySelectorAll<HTMLLabelElement>(".fin-ends label")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!label) throw new Error(`end option "${text}" not found`);
  return label.querySelector<HTMLInputElement>('input[type="radio"]')!;
}

const endDateInput = () => document.querySelector<HTMLInputElement>('[aria-label="Fecha de fin"]')!;
const readback = () => document.querySelector(".fin-readback__sentence")?.textContent ?? "";
const upcomingDates = () =>
  [...document.querySelectorAll(".fin-readback__date")].map((el) => el.textContent);

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

  it("Se repite → 'Una vez' on a left-cropped loan saves {once, Fecha}", () => {
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
    expect(field("Empieza").value).toBe("20/11/2026");
    click(preset("Una vez"));
    // Not repeating: the start is just "Fecha" and nothing "Termina".
    expect(field("Fecha").value).toBe("20/11/2026");
    expect(document.querySelector("#fin-editor-end")).toBeNull();
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

describe("react-4: 'Nuevo → Ingreso' creates nothing until Guardar", () => {
  it("summary bar 'Nuevo → Ingreso' hands a draft to the shell and adds nothing", () => {
    const { bridge } = createFakeBridge(createDemoFinancialDocument(START));
    const before = bridge.getDocument().items.length;
    const onCreateDraft = vi.fn();
    mount(h(FinancialSummaryBar, { bridge, onCreateDraft }));
    click(document.querySelector(".fin-new__trigger") as HTMLElement);
    const menu = document.querySelector('[role="menu"][aria-label="Nuevo objeto"]');
    expect(menu?.querySelectorAll(".fin-new__item").length).toBe(6);
    click(document.querySelector('.fin-new__item[data-kind="income"]') as HTMLElement);
    expect(document.querySelector(".fin-new__menu")).toBeNull();
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

// --- es-MX date fields ----------------------------------------------------------

describe("editor 'Cuándo': es-MX dates, presets, Termina, plain-words readback", () => {
  const RENTA: FinancialItem = {
    id: "fin-renta",
    kind: "expense",
    name: "Renta",
    amount: 8000,
    recurrence: { frequency: "monthly", startDate: "2026-11-20", endDate: "2027-05-20" },
  };

  function open(item: FinancialItem = RENTA) {
    const { bridge } = createFakeBridge(docWith([item]));
    mount(h(FinancialEditorModal, { bridge, itemId: item.id, onClose: () => {} }));
    return bridge;
  }

  it("shows dd/mm/aaaa text with the weekday preview; no type=date inputs", () => {
    open();
    expect(document.querySelector('.fin-editor input[type="date"]')).toBeNull();
    expect(field("Empieza").type).toBe("text");
    expect(field("Empieza").value).toBe("20/11/2026");
    expect(datePreview("Empieza").textContent).toBe("vie 20 nov 2026");
    // Termina "El 20/05/2027": 20 nov … 20 may = 7 payments, said in words.
    expect(endOption("El").checked).toBe(true);
    expect(endDateInput().value).toBe("20/05/2027");
    expect(readback()).toBe(
      "Pagas $8,000 cada mes, el día 20, desde el vie 20 nov 2026, hasta el jue 20 may 2027: 7 pagos.",
    );
    expect(upcomingDates()).toEqual(["vie 20 nov 2026", "dom 20 dic 2026", "mié 20 ene 2027", "sáb 20 feb 2027"]);
  });

  it("typing '15 dic' saves 2026-12-15 (year from today) and the preview follows", () => {
    const bridge = open();
    typeInto(field("Empieza"), "15 dic");
    expect(datePreview("Empieza").textContent).toBe("mar 15 dic 2026");
    expect(field("Empieza").getAttribute("aria-invalid")).toBe("false");
    blur(field("Empieza"));
    expect(field("Empieza").value).toBe("15/12/2026");
    click(mustButton(document, "Guardar"));
    const saved = bridge.replaceItem.mock.calls[0]![0];
    expect(saved.recurrence.startDate).toBe("2026-12-15");
    // Moving the date moves the schedule phase too.
    expect(saved.recurrence.anchorDate).toBe("2026-12-15");
  });

  it.each(["15/12/2026", "15-12-2026", "2026-12-15", "15 dic 2026", "mar 15 dic 2026"])(
    "accepts %s",
    (raw) => {
      const bridge = open();
      typeInto(field("Empieza"), raw);
      click(mustButton(document, "Guardar"));
      expect(bridge.replaceItem.mock.calls[0]![0].recurrence.startDate).toBe("2026-12-15");
    },
  );

  it("an unrecognised date shows inline validation and blocks Guardar", () => {
    const bridge = open();
    typeInto(field("Empieza"), "12/31/2026");
    const preview = datePreview("Empieza");
    expect(preview.dataset.state).toBe("invalid");
    expect(preview.textContent).toMatch(/no reconocida/i);
    expect(field("Empieza").getAttribute("aria-invalid")).toBe("true");
    expect(errorText()).toBe("Empieza: fecha inválida.");
    expect(mustButton(document, "Guardar").disabled).toBe(true);
    click(mustButton(document, "Guardar"));
    expect(bridge.replaceItem).not.toHaveBeenCalled();
    typeInto(field("Empieza"), "31/12/2026");
    expect(errorText()).toBe("");
    expect(datePreview("Empieza").textContent).toBe("jue 31 dic 2026");
  });

  it("↑ / ↓ move the date ±1 day (Shift: ±7)", () => {
    const bridge = open();
    pressKey(field("Empieza"), "ArrowUp");
    expect(field("Empieza").value).toBe("21/11/2026");
    pressKey(field("Empieza"), "ArrowDown", { shiftKey: true });
    expect(field("Empieza").value).toBe("14/11/2026");
    click(mustButton(document, "Guardar"));
    expect(bridge.replaceItem.mock.calls[0]![0].recurrence.startDate).toBe("2026-11-14");
  });

  it("Termina 'El [fecha]': the readback counts the payments; between paydays it saves on the last one", () => {
    const bridge = open();
    typeInto(endDateInput(), "5 feb 2027");
    expect(readback()).toContain("hasta el mié 20 ene 2027: 3 pagos.");
    click(mustButton(document, "Guardar"));
    expect(bridge.replaceItem.mock.calls[0]![0].recurrence.endDate).toBe("2027-01-20");
  });

  it("Termina 'Nunca' (no end) and 'Después de [N] pagos'", () => {
    const bridge = open();
    click(endOption("Nunca"));
    expect(endOption("Nunca").checked).toBe(true);
    expect(readback()).toContain("sin fecha de fin.");
    click(endOption("Después de"));
    // Back to a finite end: about a year of payments, said as a count.
    const count = document.querySelector<HTMLInputElement>('[aria-label="Número de pagos"]')!;
    expect(count.value).toBe("12");
    typeInto(count, "3");
    expect(readback()).toContain("hasta el mié 20 ene 2027: 3 pagos.");
    click(mustButton(document, "Guardar"));
    expect(bridge.replaceItem.mock.calls[0]![0].recurrence.endDate).toBe("2027-01-20");
  });

  it("a typed end date picks 'El' by itself (no disabled field to unlock first)", () => {
    open();
    click(endOption("Nunca"));
    expect(endDateInput().disabled).toBe(false);
    typeInto(endDateInput(), "20/03/2027");
    expect(endOption("El").checked).toBe(true);
    expect(readback()).toContain("5 pagos.");
  });

  it("the payday is the start's day; a month-end start can be 'siempre el último día'", () => {
    const bridge = open();
    const lastDay = () =>
      [...document.querySelectorAll<HTMLLabelElement>(".fin-editor__check")].find((label) =>
        label.textContent?.includes("último día del mes"),
      );
    expect(lastDay()).toBeUndefined(); // the 20th is not a month's end
    typeInto(field("Empieza"), "30/11/2026");
    expect(lastDay()).toBeDefined();
    click(lastDay()!.querySelector("input")!);
    expect(readback()).toContain("cada mes, el último día del mes");
    click(mustButton(document, "Guardar"));
    const saved = bridge.replaceItem.mock.calls[0]![0].recurrence;
    expect(saved.startDate).toBe("2026-11-30");
    expect(saved.anchorDate!.endsWith("-31")).toBe(true);
  });

  it("presets are one click; 'Personalizado…' opens 'Cada [N] [días | meses]'", () => {
    const bridge = open();
    expect(preset("Cada mes").getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector(".fin-repeat__every")).toBeNull();
    click(preset("Cada año"));
    expect(readback()).toContain("cada año, el 20 de noviembre");
    click(preset("Personalizado…"));
    expect(preset("Personalizado…").getAttribute("aria-checked")).toBe("true");
    const every = () => document.querySelector<HTMLInputElement>(".fin-repeat__every")!;
    typeInto(every(), "6");
    expect(readback()).toContain("cada 6 meses, el día 20");
    expect(upcomingDates().slice(0, 2)).toEqual(["vie 20 nov 2026", "jue 20 may 2027"]);
    choose(document.querySelector<HTMLSelectElement>(".fin-repeat__unit")!, "days");
    typeInto(every(), "10");
    expect(readback()).toContain("cada 10 días");
    // Typing 1 keeps the custom fields open (no collapse into "Cada mes").
    typeInto(every(), "1");
    expect(document.querySelector(".fin-repeat__every")).not.toBeNull();
    typeInto(every(), "10");
    click(mustButton(document, "Guardar"));
    const saved = bridge.replaceItem.mock.calls[0]![0].recurrence;
    expect(saved.frequency).toBe("daily");
    expect(saved.interval).toBe(10);
  });

  it("an end between paydays (start 16, end 15) is saved on its last payment", () => {
    const loan: FinancialItem = {
      id: "fin-prestamo",
      kind: "loan",
      name: "Préstamo",
      paymentAmount: 9000,
      recurrence: { frequency: "monthly", startDate: "2026-11-16", endDate: "2027-05-15" },
    };
    const bridge = open(loan);
    expect(endDateInput().value).toBe("15/05/2027");
    expect(readback()).toContain("hasta el vie 16 abr 2027: 6 pagos.");
    click(mustButton(document, "Guardar"));
    expect(bridge.replaceItem.mock.calls[0]![0].recurrence.endDate).toBe("2027-04-16");
  });
});

// --- Header menus (review fixes) ---------------------------------------------

describe("header menus: ARIA menu button, portal, outside close", () => {
  function key(target: Element, k: string) {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    });
  }

  function mountBar(inert = false) {
    const { bridge } = createFakeBridge(createDemoFinancialDocument(START));
    const onCreateDraft = vi.fn();
    mount(h(FinancialSummaryBar, { bridge, onCreateDraft, inert }));
    return { bridge, onCreateDraft };
  }

  const trigger = () => document.querySelector<HTMLButtonElement>(".fin-new__trigger")!;
  const menu = () => document.querySelector<HTMLElement>(".fin-new__menu");

  it("opening focuses the first item; arrows / Home / End move; Escape returns focus", () => {
    mountBar();
    click(trigger());
    const items = [...document.querySelectorAll<HTMLElement>(".fin-new__item")];
    expect(document.activeElement).toBe(items[0]);
    key(items[0]!, "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    key(items[1]!, "ArrowUp");
    key(items[0]!, "ArrowUp");
    expect(document.activeElement).toBe(items[items.length - 1]);
    key(items[items.length - 1]!, "Home");
    expect(document.activeElement).toBe(items[0]);
    key(items[0]!, "Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("Tab closes the menu and puts focus back on the trigger", () => {
    mountBar();
    click(trigger());
    key(document.activeElement!, "Tab");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("a pointerdown anywhere outside closes it (capture: the canvas can't swallow it)", () => {
    mountBar();
    click(trigger());
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.addEventListener("pointerdown", (event) => event.stopPropagation());
    act(() => {
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it("closes when the bar becomes inert (an editor opened)", () => {
    const { bridge } = createFakeBridge(createDemoFinancialDocument(START));
    const onCreateDraft = vi.fn();
    mount(h(FinancialSummaryBar, { bridge, onCreateDraft, inert: false }));
    click(trigger());
    expect(menu()).not.toBeNull();
    act(() => root!.render(h(FinancialSummaryBar, { bridge, onCreateDraft, inert: true })));
    expect(menu()).toBeNull();
  });

  it("popovers render in document.body, outside the masked metrics row", () => {
    mountBar();
    const chip = document.querySelector<HTMLButtonElement>("button.fin-summary__chip");
    expect(chip).not.toBeNull();
    // The alerts live in the fixed action group, never in the scroller.
    expect(chip!.closest(".fin-summary__actions")).not.toBeNull();
    expect(chip!.closest(".fin-summary__metrics")).toBeNull();
    click(chip!);
    const popover = document.querySelector<HTMLElement>('[aria-label="Alertas de liquidez"]');
    expect(popover).not.toBeNull();
    expect(popover!.parentElement).toBe(document.body);
    expect(popover!.closest(".fin-summary")).toBeNull();
    click(trigger());
    expect(menu()!.parentElement).toBe(document.body);
  });
});

describe("header metrics explain themselves (MetricHelp)", () => {
  function mountBar() {
    const { bridge } = createFakeBridge(createDemoFinancialDocument(START));
    mount(h(FinancialSummaryBar, { bridge, onCreateDraft: vi.fn() }));
    return { bridge };
  }
  const metric = (label: string) =>
    [...document.querySelectorAll<HTMLElement>(".fin-summary__metric")].find(
      (el) => el.querySelector(".fin-summary__label")?.textContent === label,
    )!;
  const tip = () => document.querySelector<HTMLElement>('[role="tooltip"].fin-help');

  it("focus shows what the number is and what yours say; Escape / blur close it", () => {
    const { bridge } = mountBar();
    const minimum = metric("Mínimo proyectado");
    act(() => minimum.focus());
    expect(tip()).not.toBeNull();
    expect(tip()!.parentElement).toBe(document.body);
    expect(minimum.getAttribute("aria-describedby")).toBe(tip()!.id);
    expect(tip()!.textContent).toContain("El saldo más bajo que tendrá tu caja");
    const projection = bridge.getProjection();
    const reserve = bridge.getDocument().minimumCashReserve;
    const detail = tip()!.querySelector<HTMLElement>(".fin-help__detail")!;
    if (projection.minimumCash.cash < 0) {
      expect(detail.dataset.tone).toBe("negative");
      expect(detail.textContent).toContain("te faltarían");
    } else if (projection.minimumCash.cash < reserve) {
      expect(detail.dataset.tone).toBe("low");
      expect(detail.textContent).toContain("por debajo de tu reserva mínima");
    } else {
      expect(detail.dataset.tone).toBe("ok");
    }
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(tip()).toBeNull();
    act(() => metric("Al horizonte").focus());
    expect(tip()!.textContent).toContain("al final de tu plan");
    act(() => metric("Al horizonte").blur());
    expect(tip()).toBeNull();
  });

  it("closed, every metric still has its description for screen readers", () => {
    mountBar();
    for (const label of ["Liquidez hoy", "Reserva mínima", "Deuda hoy", "Próximo pago", "Mínimo proyectado", "Al horizonte"]) {
      const el = metric(label);
      const id = el.getAttribute("aria-describedby")!;
      const description = document.getElementById(id)!;
      expect(description.classList.contains("fin-sr-only")).toBe(true);
      expect(description.textContent).toContain(label);
      // Out of the metric itself: not part of its accessible name.
      expect(el.contains(description)).toBe(false);
    }
  });
});

describe("editor field errors (Mantine Form + the shared Zod schema)", () => {
  it("an invalid amount shows its error under the field, tied to the input", () => {
    const item: FinancialItem = {
      id: "fin-renta",
      kind: "expense",
      name: "Renta",
      amount: 8000,
      recurrence: { frequency: "monthly", startDate: "2026-11-20" },
    };
    const { bridge } = createFakeBridge(docWith([item]));
    mount(h(FinancialEditorModal, { bridge, itemId: item.id, onClose: () => {} }));
    const amount = field("Monto");
    expect(amount.getAttribute("aria-invalid")).toBeNull();
    typeInto(amount, "-5");
    const describedBy = amount.getAttribute("aria-describedby")!;
    expect(amount.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(describedBy)!.textContent).toBe("No puede ser negativo");
    // The summary names the field; Guardar waits for a valid form.
    expect(errorText()).toBe("Monto: no puede ser negativo.");
    expect(mustButton(document, "Guardar").disabled).toBe(true);
    typeInto(amount, "7500");
    expect(amount.getAttribute("aria-invalid")).toBeNull();
    expect(errorText()).toBe("");
  });

  it("an empty name is an error of the name field", () => {
    const { bridge } = createFakeBridge(docWith([]));
    const draft = bridge.createDraftItem("income");
    mount(h(FinancialEditorModal, { bridge, draft, onClose: () => {} }));
    typeInto(field("Nombre"), "   ");
    expect(errorText()).toBe("Nombre: ponle un nombre.");
  });
});

describe("onboarding: Mantine Form (uncontrolled) + Zod, errors per field", () => {
  const TODAY = "2026-11-09";
  const input = (label: string) =>
    [...document.querySelectorAll<HTMLInputElement>(".fin-onboarding input")].find(
      (el) =>
        el.getAttribute("aria-label") === label ||
        el.closest("label")?.querySelector(".fin-editor__label")?.textContent?.startsWith(label),
    )!;
  const submit = () =>
    act(() => {
      document
        .querySelector<HTMLFormElement>(".fin-onboarding")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

  it("an empty submit marks the required fields and creates nothing", () => {
    const onCreate = vi.fn();
    mount(h(OnboardingDialog, { today: TODAY, onCreate, onClose: () => {} }));
    submit();
    expect(onCreate).not.toHaveBeenCalled();
    const cash = input("¿Cuánto dinero tienes hoy?");
    expect(cash.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(cash.getAttribute("aria-describedby")!)!.textContent).toBe(
      "Escribe cuánto dinero tienes hoy (puede ser 0)",
    );
    expect(input("¿Cuánto cada vez?").getAttribute("aria-invalid")).toBe("true");
    expect(errorText()).toBe("Escribe cuánto dinero tienes hoy (puede ser 0)");
  });

  it("valid answers build the year; a bad fixed-expense day is caught on its row", () => {
    const onCreate = vi.fn();
    mount(h(OnboardingDialog, { today: TODAY, onCreate, onClose: () => {} }));
    typeInto(input("¿Cuánto dinero tienes hoy?"), "12,000");
    typeInto(input("¿Cuánto cada vez?"), "9000");
    typeInto(input("Monto del gasto 1"), "8000");
    typeInto(input("Día del mes del gasto 1"), "40");
    submit();
    expect(onCreate).not.toHaveBeenCalled();
    expect(input("Día del mes del gasto 1").getAttribute("aria-invalid")).toBe("true");
    typeInto(input("Día del mes del gasto 1"), "1");
    submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
    const doc = onCreate.mock.calls[0]![0];
    expect(doc.initialCash).toBe(12000);
    expect(doc.items.find((item: FinancialItem) => item.name === "Sueldo")?.recurrence.frequency).toBe("semimonthly");
    expect(doc.items.find((item: FinancialItem) => item.name === "Renta")).toMatchObject({ amount: 8000 });
  });
});

// --- Forms integration: the shared DateField, Rec, statement, header amounts --

describe("the editor's dates are THE date field (typing + calendar)", () => {
  const RENTA: FinancialItem = {
    id: "fin-renta",
    kind: "expense",
    name: "Renta",
    amount: 8000,
    recurrence: { frequency: "monthly", startDate: "2026-11-20", endDate: "2027-05-20" },
  };

  it("the calendar picks a day: Spanish month, the field and the saved date follow", () => {
    const { bridge } = createFakeBridge(docWith([RENTA]));
    mount(h(FinancialEditorModal, { bridge, itemId: RENTA.id, onClose: () => {} }));
    click(document.querySelector<HTMLButtonElement>('[aria-label="Abrir calendario: Empieza"]')!);
    const calendar = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Calendario: Empieza"]');
    expect(calendar).not.toBeNull();
    expect(calendar!.textContent).toContain("Noviembre 2026");
    click(calendar!.querySelector<HTMLButtonElement>('button[aria-label="viernes 27 de noviembre de 2026"]')!);
    expect(field("Empieza").value).toBe("27/11/2026");
    expect(document.querySelector('[aria-label="Calendario: Empieza"]')).toBeNull();
    click(mustButton(document, "Guardar"));
    expect(bridge.replaceItem.mock.calls[0]![0].recurrence.startDate).toBe("2026-11-27");
  });

  it("Escape on the calendar button closes the calendar, not the editor", () => {
    const { bridge } = createFakeBridge(docWith([RENTA]));
    const onClose = vi.fn();
    mount(h(FinancialEditorModal, { bridge, itemId: RENTA.id, onClose }));
    const toggle = document.querySelector<HTMLButtonElement>('[aria-label="Abrir calendario: Empieza"]')!;
    click(toggle);
    expect(document.querySelector('[aria-label="Calendario: Empieza"]')).not.toBeNull();
    pressKey(toggle, "Escape");
    expect(document.querySelector('[aria-label="Calendario: Empieza"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the item vanishing while the editor is open closes it (no hook-order crash)", () => {
    const { bridge } = createFakeBridge(docWith([RENTA]));
    const onClose = vi.fn();
    mount(h(FinancialEditorModal, { bridge, itemId: RENTA.id, onClose }));
    act(() => {
      bridge.deleteItem(RENTA.id);
    });
    expect(onClose).toHaveBeenCalled();
    expect(document.querySelector(".fin-editor")).toBeNull();
  });
});

describe("onboarding: the next pay is THE date field", () => {
  const TODAY = "2026-11-09";
  const input = (label: string) =>
    [...document.querySelectorAll<HTMLInputElement>(".fin-onboarding input")].find(
      (el) => el.closest("label")?.querySelector(".fin-editor__label")?.textContent?.startsWith(label),
    )!;
  const submit = () =>
    act(() => {
      document
        .querySelector<HTMLFormElement>(".fin-onboarding")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

  it("es-MX text (or the calendar); an unrecognised date blocks 'Crear mi año' on its field", () => {
    const onCreate = vi.fn();
    mount(h(OnboardingDialog, { today: TODAY, onCreate, onClose: () => {} }));
    click(preset("Cada semana"));
    const nextPay = () => field("¿Cuándo es tu próximo pago?");
    expect(
      document.querySelector('[aria-label="Abrir calendario: ¿Cuándo es tu próximo pago?"]'),
    ).not.toBeNull();
    typeInto(input("¿Cuánto dinero tienes hoy?"), "1000");
    typeInto(input("¿Cuánto cada vez?"), "3000");
    typeInto(nextPay(), "13/31/2026");
    submit();
    expect(onCreate).not.toHaveBeenCalled();
    expect(nextPay().getAttribute("aria-invalid")).toBe("true");
    expect(errorText()).toBe("Fecha inválida");
    // "13 nov" is the NEXT 13 nov (the next pay is never behind you).
    typeInto(nextPay(), "13 nov");
    expect(datePreview("¿Cuándo es tu próximo pago?").textContent).toBe("vie 13 nov 2026");
    submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
    const sueldo = onCreate.mock.calls[0]![0].items.find((item: FinancialItem) => item.name === "Sueldo");
    expect(sueldo.recurrence).toMatchObject({ frequency: "weekly", anchorDate: "2026-11-13" });
  });

  it("left empty, the next pay is optional", () => {
    const onCreate = vi.fn();
    mount(h(OnboardingDialog, { today: TODAY, onCreate, onClose: () => {} }));
    click(preset("Cada semana"));
    typeInto(input("¿Cuánto dinero tienes hoy?"), "0");
    typeInto(input("¿Cuánto cada vez?"), "3000");
    submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe("Rec: Mantine Form + the shared schemas, errors on their row", () => {
  const point = (eventId: string, name: string, date: string, cashDelta: number): FinancialProjectionPoint => ({
    eventId,
    itemId: eventId,
    type: cashDelta < 0 ? "expense" : "income",
    name,
    date,
    cashBefore: 0,
    cashAfter: cashDelta,
    cashDelta,
    debtDelta: 0,
    debtAfter: 0,
  });
  const PENDING = [
    point("e-renta", "Renta", "2026-11-01", -8000),
    point("e-sueldo", "Sueldo", "2026-11-05", 9000),
  ];

  function openRec() {
    const onApply = vi.fn();
    mount(h(RecDialog, { pending: PENDING, since: "2026-11-01", onApply, onClose: () => {} }));
    return onApply;
  }
  const status = (name: string) =>
    document.querySelector<HTMLSelectElement>(`select[aria-label^="Qué pasó con ${name}"]`)!;
  const realAmount = () => document.querySelector<HTMLInputElement>('[aria-label="Monto real"]')!;
  const save = () => click(mustButton(document, "Guardar"));

  it("'Otro monto' needs a real amount (MoneySchema): its error sits on the row, nothing is applied", () => {
    const onApply = openRec();
    choose(status("Renta"), "edited");
    save();
    expect(onApply).not.toHaveBeenCalled();
    expect(realAmount().getAttribute("aria-invalid")).toBe("true");
    expect(describedText(realAmount())).toBe("Escribe el monto real");
    expect(errorText()).toBe("Escribe el monto real");
    typeInto(realAmount(), "-5");
    save();
    expect(describedText(realAmount())).toBe("No puede ser negativo");
    expect(onApply).not.toHaveBeenCalled();
    typeInto(realAmount(), "7,500");
    choose(status("Sueldo"), "skipped");
    save();
    expect(onApply).toHaveBeenCalledWith(
      [
        { eventId: "e-renta", status: "edited", amount: 7500 },
        { eventId: "e-sueldo", status: "skipped" },
      ],
      undefined,
    );
  });

  it("back to 'Pasó', a row has nothing left to fix", () => {
    const onApply = openRec();
    choose(status("Renta"), "edited");
    save();
    expect(errorText()).not.toBe("");
    choose(status("Renta"), "happened");
    expect(errorText()).toBe("");
    save();
    expect(onApply).toHaveBeenCalledWith([], undefined);
  });

  it("today's real cash: optional, may be negative (an overdraft), never garbage", () => {
    const onApply = openRec();
    const cash = field("Saldo real hoy");
    typeInto(cash, "abc");
    blur(cash);
    expect(cash.getAttribute("aria-invalid")).toBe("true");
    expect(describedText(cash)).toBe("Escribe un número");
    save();
    expect(onApply).not.toHaveBeenCalled();
    typeInto(cash, "-1,200");
    save();
    expect(onApply).toHaveBeenCalledWith([], -1200);
  });
});

describe("statement: the pasted text is checked as you type", () => {
  const CARD: FinancialItem = {
    id: "card-oro",
    kind: "credit-card",
    name: "Oro",
    balance: 1000,
    annualRate: 40,
    cutDay: 5,
    dueDay: 25,
    minimumPayment: 200,
    recurrence: { frequency: "monthly", startDate: START },
  };
  const area = () => document.querySelector<HTMLTextAreaElement>(".fin-statement__input")!;

  it("text without movements is an error of the text area; valid rows apply", () => {
    const { bridge } = createFakeBridge(docWith([CARD]));
    const onClose = vi.fn();
    mount(h(StatementDialog, { bridge, cardId: CARD.id, today: START, onClose }));
    expect(area().getAttribute("aria-invalid")).toBeNull();
    typeIntoArea(area(), "hola");
    expect(area().getAttribute("aria-invalid")).toBe("true");
    expect(describedText(area())).toBe("No encontré movimientos con fecha y monto.");
    expect(mustButton(document, "Aplicar").disabled).toBe(true);
    typeIntoArea(area(), "01/11/2026 OXXO 500\n20/11/2026 TIENDA 300");
    expect(area().getAttribute("aria-invalid")).toBeNull();
    click(mustButton(document, "Aplicar"));
    expect(bridge.replaceItem).toHaveBeenCalledWith(expect.objectContaining({ id: CARD.id, balance: 1500 }));
    expect(bridge.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "card-purchase",
        cardId: CARD.id,
        amount: 300,
        recurrence: { frequency: "once", startDate: "2026-11-20", endDate: "2026-11-20" },
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("text handed in (the slash command) is checked at once", () => {
    const { bridge } = createFakeBridge(docWith([CARD]));
    mount(h(StatementDialog, { bridge, cardId: CARD.id, today: START, initialText: "nada", onClose: () => {} }));
    expect(area().getAttribute("aria-invalid")).toBe("true");
  });
});

describe("header amounts follow the plan's shared schema", () => {
  function mountBar() {
    const { bridge } = createFakeBridge(docWith([]));
    mount(h(FinancialSummaryBar, { bridge, onCreateDraft: vi.fn() }));
    return bridge;
  }
  const amount = (label: string) =>
    document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

  it("Reserva mínima: a negative amount is marked while typing and reverts on Enter", () => {
    const bridge = mountBar();
    const reserve = amount("Reserva mínima");
    act(() => reserve.focus());
    typeInto(reserve, "-5");
    expect(reserve.getAttribute("aria-invalid")).toBe("true");
    expect(describedText(reserve)).toBe("No puede ser negativo");
    pressKey(reserve, "Enter");
    expect(reserve.getAttribute("aria-invalid")).toBeNull();
    expect(bridge.getDocument().minimumCashReserve).toBe(0);
  });

  it("Liquidez hoy: an overdraft is a valid amount", () => {
    const bridge = mountBar();
    const cash = amount("Liquidez hoy");
    act(() => cash.focus());
    typeInto(cash, "-1,500");
    expect(cash.getAttribute("aria-invalid")).toBeNull();
    pressKey(cash, "Enter");
    expect(bridge.getDocument().initialCash).toBe(-1500);
  });
});
