// @vitest-environment jsdom
// UX audit 2026-11-11, group C (conciliar, analizar y simular): Rec, the "/"
// bar, the valley card, futures, the scenario / avalanche rail and the
// statement dialog. Logic against a REAL FinancialBridge + playlist core
// (undo is the core's history); components rendered headless.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  addDays,
  createDefaultFinancialItem,
  createDemoFinancialDocument,
  projectFinancialDocument,
  type FinancialDocument,
  type FinancialItem,
} from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import { FinancialBridge } from "../src/finance/financial-bridge";
import { FINANCE_PLAYLIST_METRICS, createFinancialPlaylistState } from "../src/finance/mapping";
import {
  applyRecCorrections,
  bootstrapPlan,
  recResultCash,
  type RecState,
} from "../src/finance/bootstrap";
import { inOneUndoStep } from "../src/finance/undo-step";
import type { SavedPlan } from "../src/finance/persistence";
import {
  cardNeverPaidOff,
  explainNoAmount,
  firstInstallmentDate,
  interpretCommand,
  parseCommand,
} from "../src/finance/command";
import { formatMoneyWhole } from "../src/finance/format";
import { CommandBar } from "../src/finance/components/CommandBar";
import { AnnouncerProvider } from "../src/ui/announcer";
import { Futures, MAIN_BRANCH_ID, uniqueFutureName } from "../src/finance/futures";
import {
  ValleyCard,
  VALLEY_HOVER_GRACE_MS,
  VALLEY_TRAVEL_GRACE_MS,
} from "../src/finance/components/ValleyCard";
import { StatementDialog } from "../src/finance/components/StatementDialog";
import { DebtStrategyPanel, todayExtraPayment } from "../src/finance/components/DebtStrategyPanel";
import { FuturesMenu, FuturesPeekChip } from "../src/finance/components/FuturesMenu";
import { RecDialog, recResultLine } from "../src/finance/components/RecDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;
const TODAY = "2026-11-11";

function setup(doc: FinancialDocument) {
  const core = createPlaylistCore(createFinancialPlaylistState(doc), {
    metrics: FINANCE_PLAYLIST_METRICS,
    stretchEnabled: false,
  });
  const bridge = new FinancialBridge(core, doc);
  return { core, bridge };
}

function savedPlanOf(doc: FinancialDocument): SavedPlan {
  return {
    v: 1,
    activeId: "main",
    compareId: null,
    branches: [{ id: "main", name: "Plan principal", forkDate: null, doc }],
    ledger: [],
  };
}

/** The demo plan saved 14 days ago, rolled to TODAY (Rec pending). */
function recSession() {
  const since = addDays(TODAY, -14);
  const plan = bootstrapPlan(TODAY, savedPlanOf(createDemoFinancialDocument(since)));
  if (!plan.rec) throw new Error("expected a pending Rec");
  const { core, bridge } = setup(plan.doc);
  return { core, bridge, rec: plan.rec as RecState, assumedCash: plan.doc.initialCash };
}

// --- DOM helpers -------------------------------------------------------------

let root: Root | null = null;

function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

// --- UX-02 -------------------------------------------------------------------

describe("UX-02: Rec's 'Saldo real hoy' is today's cash, absolute", () => {
  it("encabezado 11,400 + Rec 11,400 ⇒ 11,400 (no double correction)", () => {
    const { bridge, rec } = recSession();
    bridge.setInitialCash(11400);
    applyRecCorrections(bridge, rec, TODAY, [], 11400);
    expect(bridge.getDocument().initialCash).toBe(11400);
  });

  it("Rec 11,400 sin edición previa ⇒ 11,400", () => {
    const { bridge, rec, assumedCash } = recSession();
    expect(assumedCash).not.toBe(11400);
    applyRecCorrections(bridge, rec, TODAY, [], 11400);
    expect(bridge.getDocument().initialCash).toBe(11400);
  });

  it("without a real balance, a row correction moves the CURRENT cash by its difference", () => {
    const { bridge, rec } = recSession();
    const expense = rec.pending.find((point) => point.cashDelta < 0)!;
    bridge.setInitialCash(20000);
    applyRecCorrections(bridge, rec, TODAY, [{ eventId: expense.eventId, status: "skipped" }], undefined);
    expect(bridge.getDocument().initialCash).toBe(20000 - expense.cashDelta);
  });

  it("recResultCash: the dialog's live result agrees with what is applied", () => {
    const { bridge, rec } = recSession();
    const expense = rec.pending.find((point) => point.cashDelta < 0)!;
    const actuals = [{ eventId: expense.eventId, status: "skipped" as const }];
    const current = bridge.getDocument().initialCash;
    expect(recResultCash(rec, TODAY, [], undefined, current)).toBe(current);
    expect(recResultCash(rec, TODAY, actuals, 9000, current)).toBe(9000);
    const predicted = recResultCash(rec, TODAY, actuals, undefined, current);
    applyRecCorrections(bridge, rec, TODAY, actuals, undefined);
    expect(bridge.getDocument().initialCash).toBe(predicted);
  });

  it("applied in one undo step: one Ctrl+Z takes cash and balances back", () => {
    const { core, bridge, rec } = recSession();
    const before = bridge.getDocument();
    const card = rec.pending.find((point) => point.type === "credit-card-payment");
    const actuals = card ? [{ eventId: card.eventId, status: "skipped" as const }] : [];
    inOneUndoStep(core, () => applyRecCorrections(bridge, rec, TODAY, actuals, 11400));
    expect(bridge.getDocument().initialCash).toBe(11400);
    expect(core.undo()).toBe(true);
    expect(bridge.getDocument().initialCash).toBe(before.initialCash);
    expect(bridge.getDocument().items).toEqual(before.items);
  });
});

// --- UX-05 / UX-33 / UX-45: the "/" bar --------------------------------------

function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(target: HTMLElement, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.click();
  });
}

function buttonByText(text: string): HTMLButtonElement | null {
  return [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text)) ?? null;
}

function liveText(): string {
  return document.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? "";
}

describe("UX-05: the '/' bar understands balances, card payments and the past", () => {
  const doc = createDemoFinancialDocument(TODAY);
  const ctx = { today: TODAY, doc };

  it("interpretCommand: balance phrases are today's cash, not a Gasto", () => {
    for (const text of ["tengo 11400 en el banco", "me quedan 11,400", "mi saldo es 11400", "tengo 11400"]) {
      expect(interpretCommand(text, ctx), text).toEqual({ type: "balance", amount: 11400 });
    }
    // Not balances: a card's balance, an expense.
    expect(interpretCommand("tarjeta nu saldo 30000", ctx)?.type).toBe("item");
    expect(interpretCommand("tengo que pagar renta 8000", ctx)?.type).toBe("item");
  });

  it("interpretCommand: 'pagué la tarjeta nu 3000' pays Nu; a purchase 'con nu' does not", () => {
    expect(interpretCommand("pagué la tarjeta nu 3000", ctx)).toMatchObject({
      type: "card-payment",
      cardId: "fin-nu",
      amount: 3000,
      date: TODAY,
    });
    expect(interpretCommand("abono a bbva 1500", ctx)).toMatchObject({ type: "card-payment", cardId: "fin-bbva" });
    expect(interpretCommand("tele 9000 con nu", ctx)?.type).toBe("item");
  });

  it("interpretCommand: a past one-off is flagged; a guessed kind needs a choice", () => {
    expect(interpretCommand("gasté 300 en uber ayer", ctx)).toMatchObject({ type: "item", past: true, needsKind: false });
    expect(interpretCommand("uber 300 mañana", ctx)).toMatchObject({ type: "item", past: false });
    expect(interpretCommand("bicicleta 2000", ctx)).toMatchObject({ type: "item", needsKind: true });
  });

  function openBar() {
    const { core, bridge } = setup(createDemoFinancialDocument(TODAY));
    const onClose = vi.fn();
    mount(h(AnnouncerProvider, null, h(CommandBar, { bridge, today: TODAY, onClose })));
    const input = document.querySelector<HTMLInputElement>(".fin-command__input")!;
    return { core, bridge, onClose, input, items: () => bridge.getDocument().items.length };
  }

  it("'tengo 11400 en el banco': preview 'Liquidez hoy $A → $B', Enter sets it, Deshacer brings it back", () => {
    const { bridge, input, items, onClose } = openBar();
    const before = bridge.getDocument().initialCash;
    const count = items();
    typeInto(input, "tengo 11400 en el banco");
    expect(document.querySelector(".fin-command__what")!.textContent).toContain(
      `Liquidez hoy ${formatMoneyWhole(before)} → $11,400`,
    );
    expect(bridge.getPreview()?.kind).toBe("document");
    press(input, "Enter");
    expect(bridge.getDocument().initialCash).toBe(11400);
    expect(items()).toBe(count);
    expect(onClose).toHaveBeenCalled();
    expect(liveText()).toContain("Liquidez hoy");
    click(buttonByText("Deshacer")!);
    expect(bridge.getDocument().initialCash).toBe(before);
  });

  it("'pagué la tarjeta nu 3000': Nu's balance and today's cash go down in one undo step", () => {
    const { core, bridge, input, items } = openBar();
    const nu = () => bridge.getItem("fin-nu") as Extract<FinancialItem, { kind: "credit-card" }>;
    const balance = nu().balance;
    const cash = bridge.getDocument().initialCash;
    const count = items();
    typeInto(input, "pagué la tarjeta nu 3000");
    press(input, "Enter");
    expect(nu().balance).toBe(balance - 3000);
    expect(bridge.getDocument().initialCash).toBe(cash - 3000);
    expect(items()).toBe(count);
    core.undo();
    expect(nu().balance).toBe(balance);
    expect(bridge.getDocument().initialCash).toBe(cash);
  });

  it("'gasté 300 en uber ayer': Enter discounts it from today's cash; 'Anotarlo igual' is explicit", () => {
    const { bridge, input, items } = openBar();
    const cash = bridge.getDocument().initialCash;
    const count = items();
    typeInto(input, "gasté 300 en uber ayer");
    expect(document.querySelector(".fin-command__warning")!.textContent).toContain("Ya pasó");
    expect(buttonByText("Anotarlo igual")).not.toBeNull();
    press(input, "Enter");
    expect(items()).toBe(count);
    expect(bridge.getDocument().initialCash).toBe(cash - 300);
  });

  it("a guessed kind: Enter adds nothing; the person picks Gasto / Ingreso / Es mi saldo", () => {
    const { bridge, input, items } = openBar();
    const count = items();
    typeInto(input, "bicicleta 2000");
    press(input, "Enter");
    expect(items()).toBe(count);
    expect(document.activeElement?.textContent).toContain("Gasto");
    click(buttonByText("Ingreso")!);
    expect(items()).toBe(count + 1);
    const added = bridge.getDocument().items[bridge.getDocument().items.length - 1]!;
    expect(added).toMatchObject({ kind: "income", amount: 2000 });
  });

  it("Escape closes through the Escape stack (no listener of its own)", () => {
    const { input, onClose } = openBar();
    press(input, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("UX-45: the bar teaches its syntax and says why nothing happens", () => {
  it("examples are always in sight with the bar empty", () => {
    const { bridge } = setup(createDemoFinancialDocument(TODAY));
    mount(h(CommandBar, { bridge, today: TODAY, onClose: () => {} }));
    expect(document.querySelector(".fin-command__examples")!.textContent).toContain("tengo 11400 en el banco");
  });

  it("explainNoAmount: one message per cause", () => {
    expect(explainNoAmount("deshacer")).toContain("Ctrl+Z");
    expect(explainNoAmount("borra netflix")).toContain("selecciona el objeto y pulsa Supr");
    expect(explainNoAmount("ayuda")).toContain("renta 8000 el 1");
    expect(explainNoAmount("renta")).toContain("Falta el monto");
  });
});

describe("UX-33: '/' and the editor give the same first installment for the same MSI", () => {
  function firstInstallment(doc: FinancialDocument, item: FinancialItem): string | undefined {
    const projection = projectFinancialDocument({ ...doc, items: [...doc.items, item] });
    return projection.points.find((p) => p.itemId === item.id && p.type === "installment-payment")?.date;
  }

  it("bought today on Nu: both pay first on Nu's payment day", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const parsed = parseCommand("laptop 18000 a 12 msi con nu", { today: TODAY, doc })!;
    const slash = { ...parsed.item, id: "msi-slash" } as FinancialItem;
    const draft = createDefaultFinancialItem("installment-plan", "msi-editor", TODAY, doc);
    const editor = {
      ...draft,
      name: "Laptop",
      originalAmount: 18000,
      installmentsTotal: 12,
      cardId: "fin-nu",
    } as FinancialItem;
    const viaSlash = firstInstallment(doc, slash);
    expect(viaSlash).toBeDefined();
    expect(viaSlash).toBe(firstInstallment(doc, editor));
    expect(slash.recurrence.startDate).toBe(editor.recurrence.startDate);
    expect(firstInstallmentDate(slash as Extract<FinancialItem, { kind: "installment-plan" }>, doc)).toBe(viaSlash);
  });

  it("without a card too (the purchase day's day of month)", () => {
    const doc: FinancialDocument = { ...createDemoFinancialDocument(TODAY), items: [] };
    const parsed = parseCommand("tele 9000 6 msi", { today: TODAY, doc })!;
    const slash = { ...parsed.item, id: "msi-slash" } as FinancialItem;
    const editor = {
      ...createDefaultFinancialItem("installment-plan", "msi-editor", TODAY, doc),
      originalAmount: 9000,
    } as FinancialItem;
    expect(firstInstallment(doc, slash)).toBe(firstInstallment(doc, editor));
  });
});

// --- UX-21 / UX-54 / UX-20: futures -------------------------------------------

describe("UX-21: 'Probar cambios' never edits the real plan until you keep it", () => {
  function futuresSession() {
    const doc = createDemoFinancialDocument(TODAY);
    const { core, bridge } = setup(doc);
    const futures = new Futures(bridge, null);
    return { core, bridge, futures };
  }
  const laptop = (): FinancialItem => ({
    id: "",
    kind: "expense",
    name: "Laptop",
    amount: 25000,
    recurrence: { frequency: "once", startDate: TODAY, endDate: TODAY },
  });

  it("Descartar: horizon and saved plan identical to before", () => {
    const { bridge, futures } = futuresSession();
    const before = futures.toSaved();
    const horizon = bridge.getProjection().finalCash;
    futures.startTrial(TODAY);
    expect(futures.activeTrial()).not.toBeNull();
    bridge.addItem(laptop());
    expect(bridge.getProjection().finalCash).toBe(horizon - 25000);
    futures.discardTrial();
    expect(futures.activeTrial()).toBeNull();
    expect(futures.getActiveId()).toBe(MAIN_BRANCH_ID);
    expect(bridge.getProjection().finalCash).toBe(horizon);
    expect(futures.toSaved()).toEqual(before);
  });

  it("Quedarme con los cambios: the main plan has them; Deshacer goes back to the trial", () => {
    const { bridge, futures } = futuresSession();
    const horizon = bridge.getProjection().finalCash;
    futures.startTrial(TODAY);
    bridge.addItem(laptop());
    const undo = futures.keepTrial()!;
    expect(futures.getActiveId()).toBe(MAIN_BRANCH_ID);
    expect(futures.list().map((b) => b.name)).toEqual(["Plan principal"]);
    expect(futures.toSaved().branches[0]!.doc.items.some((item) => item.name === "Laptop")).toBe(true);
    expect(bridge.getProjection().finalCash).toBe(horizon - 25000);
    futures.restore(undo);
    expect(futures.activeTrial()).not.toBeNull();
    expect(futures.list()).toHaveLength(2);
  });

  it("Descartar is undoable: the trial comes back with its changes", () => {
    const { bridge, futures } = futuresSession();
    const horizon = bridge.getProjection().finalCash;
    const trial = futures.startTrial(TODAY);
    bridge.addItem(laptop());
    const undo = futures.discardTrial()!;
    expect(bridge.getProjection().finalCash).toBe(horizon);
    futures.restore(undo);
    expect(futures.getActiveId()).toBe(trial.id);
    expect(bridge.getProjection().finalCash).toBe(horizon - 25000);
  });
});

describe("UX-54 / UX-20: futures have unique names, a decision and figures", () => {
  it("two forks the same day never share a name; rename keeps names unique", () => {
    const { bridge } = setup(createDemoFinancialDocument(TODAY));
    const futures = new Futures(bridge, null);
    const a = futures.fork(TODAY);
    futures.switchTo(MAIN_BRANCH_ID);
    const b = futures.fork(TODAY);
    expect(a.name).not.toBe(b.name);
    futures.rename(b.id, a.name);
    const names = futures.list().map((branch) => branch.name);
    expect(new Set(names).size).toBe(names.length);
    expect(uniqueFutureName("Otra versión", ["Otra versión", "Otra versión 2"])).toBe("Otra versión 3");
  });

  it("'Hacer este mi plan principal' in one action (undoable)", () => {
    const { bridge } = setup(createDemoFinancialDocument(TODAY));
    const futures = new Futures(bridge, null);
    const fork = futures.fork(TODAY);
    bridge.setInitialCash(99999);
    const undo = futures.adopt(fork.id)!;
    expect(futures.getActiveId()).toBe(MAIN_BRANCH_ID);
    expect(futures.list()).toHaveLength(1);
    expect(futures.toSaved().branches[0]!.doc.initialCash).toBe(99999);
    futures.restore(undo);
    expect(futures.getActiveId()).toBe(fork.id);
    expect(futures.list()).toHaveLength(2);
  });

  it("figures per future are cached per document (same object until it changes)", () => {
    const { bridge } = setup(createDemoFinancialDocument(TODAY));
    const futures = new Futures(bridge, null);
    futures.fork(TODAY);
    const main = futures.summaryOf(MAIN_BRANCH_ID)!;
    expect(futures.summaryOf(MAIN_BRANCH_ID)).toBe(main);
    const active = futures.summaryOf(futures.getActiveId())!;
    expect(futures.summaryOf(futures.getActiveId())).toBe(active);
    bridge.setInitialCash(bridge.getDocument().initialCash + 1000);
    const changed = futures.summaryOf(futures.getActiveId())!;
    expect(changed).not.toBe(active);
    expect(changed.finalCash).toBe(active.finalCash + 1000);
    expect(futures.summaryOf(MAIN_BRANCH_ID)).toBe(main);
  });
});

// --- UX-06 / UX-50 / UX-26 / UX-27 / UX-58: the valley card -----------------------

describe("UX-06 / UX-50: the valley card shows each fix's cost and keeps one primary", () => {
  function openValley() {
    const doc = createDemoFinancialDocument(TODAY);
    const { core, bridge } = setup(doc);
    const warning = bridge.getWarnings()[0]!;
    const day = bridge.beatAtDate(warning.date);
    core.setPlayPosition(day);
    mount(h(AnnouncerProvider, null, h(ValleyCard, { bridge, hoverDay: null })));
    return { core, bridge, day };
  }

  it("each fix: 'tu punto más bajo', the horizon, and a warning when it pays a debt late", () => {
    openValley();
    const fixes = [...document.querySelectorAll(".fin-valley__fix")];
    expect(fixes.length).toBeGreaterThan(0);
    for (const fix of fixes) {
      expect(fix.textContent).toContain("tu punto más bajo");
      expect(fix.textContent).not.toMatch(/· mínimo \$/);
      expect(fix.querySelector(".fin-valley__fix-cost")!.textContent).toMatch(/^Al horizonte: caja /);
    }
    const loan = fixes.find((fix) => fix.textContent!.includes("Préstamo personal"))!;
    expect(loan.getAttribute("data-risk")).toBe("debt");
    expect(loan.querySelector(".fin-valley__fix-warning")!.textContent).toContain("intereses moratorios");
    // One filled primary, never the one that pays a debt late.
    const primaries = document.querySelectorAll(".fin-valley__apply.fin-button--primary");
    expect(primaries.length).toBe(1);
    expect(loan.querySelector(".fin-button--primary")).toBeNull();
  });

  it("headings and a full accessible name; the title is focusable (#fin-valley-title)", () => {
    openValley();
    const card = document.querySelector<HTMLElement>(".fin-valley")!;
    const name = card
      .getAttribute("aria-labelledby")!
      .split(" ")
      .map((id) => document.getElementById(id)!.textContent)
      .join(" ");
    expect(name).toMatch(/^Te quedas en rojo [−-]?\$[\d,]+ el \d+ nov$/);
    const title = document.getElementById("fin-valley-title")!;
    expect(title.tagName).toBe("H2");
    expect(title.tabIndex).toBe(-1);
    expect([...card.querySelectorAll("h3")].map((el) => el.textContent)).toEqual(["Lo cavan", "Arreglos"]);
  });

  it("focusing a fix previews it on the lane (deferred); Aplicar is announced with Deshacer", () => {
    vi.useFakeTimers();
    const { bridge } = openValley();
    const before = bridge.getDocument();
    const apply = document.querySelector<HTMLButtonElement>(".fin-valley__apply.fin-button--primary")!;
    act(() => apply.focus());
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(bridge.getPreview()?.kind).toBe("document");
    expect(document.querySelector(".fin-valley__effect")!.textContent).toMatch(/^Tu caja: /);
    click(apply);
    expect(bridge.getDocument()).not.toBe(before);
    expect(liveText()).toMatch(/aplicado\. Tu punto más bajo/);
    click(buttonByText("Deshacer")!);
    expect(bridge.getDocument().items).toEqual(before.items);
  });

  it("UX-50: from the valley to the card within the grace it stays; 'Dejar abierta' keeps it", () => {
    vi.useFakeTimers();
    const doc = createDemoFinancialDocument(TODAY);
    const { bridge } = setup(doc);
    const day = bridge.beatAtDate(bridge.getWarnings()[0]!.date);
    const render = (hoverDay: number | null) =>
      act(() => root!.render(h(AnnouncerProvider, null, h(ValleyCard, { bridge, hoverDay }))));
    mount(h(AnnouncerProvider, null, h(ValleyCard, { bridge, hoverDay: day })));
    expect(document.querySelector(".fin-valley")).not.toBeNull();
    // The pointer leaves the lane on its way to the card…
    render(null);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(document.querySelector(".fin-valley")).not.toBeNull();
    // …and enters the card before the grace ends: it stays.
    act(() => {
      document.querySelector(".fin-valley")!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(document.querySelector(".fin-valley")).not.toBeNull();
    click(buttonByText("Dejar abierta")!);
    act(() => {
      document.querySelector(".fin-valley")!.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(document.querySelector(".fin-valley")).not.toBeNull();
    // Kept: Escape from inside closes it.
    const close = document.querySelector<HTMLButtonElement>(".fin-valley__close")!;
    act(() => close.focus());
    press(close, "Escape");
    expect(document.querySelector(".fin-valley")).toBeNull();
  });

  it("without the pointer reaching the card, the hover card goes after the travel grace", () => {
    vi.useFakeTimers();
    const doc = createDemoFinancialDocument(TODAY);
    const { bridge } = setup(doc);
    const day = bridge.beatAtDate(bridge.getWarnings()[0]!.date);
    mount(h(ValleyCard, { bridge, hoverDay: day }));
    act(() => root!.render(h(ValleyCard, { bridge, hoverDay: null })));
    act(() => {
      vi.advanceTimersByTime(VALLEY_HOVER_GRACE_MS + 50);
    });
    expect(document.querySelector(".fin-valley")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(VALLEY_TRAVEL_GRACE_MS);
    });
    expect(document.querySelector(".fin-valley")).toBeNull();
  });

  it("crossing lane days without a valley on the way does not replace the card at once", () => {
    vi.useFakeTimers();
    const doc = createDemoFinancialDocument(TODAY);
    const { bridge } = setup(doc);
    const warning = bridge.getWarnings()[0]!;
    const day = bridge.beatAtDate(warning.date);
    const calm = bridge.beatAtDate(addDays(warning.date, 40));
    expect(bridge.valleyAt(calm)).toBeNull();
    mount(h(ValleyCard, { bridge, hoverDay: day }));
    act(() => root!.render(h(ValleyCard, { bridge, hoverDay: calm })));
    expect(document.querySelector(".fin-valley")).not.toBeNull();
    act(() => root!.render(h(ValleyCard, { bridge, hoverDay: calm + 1 })));
    act(() => {
      vi.advanceTimersByTime(VALLEY_HOVER_GRACE_MS + 50);
    });
    expect(document.querySelector(".fin-valley")).toBeNull();
  });
});

// --- UX-52 / UX-26 / UX-58: the statement ------------------------------------------

describe("UX-52: the statement says what each row does in words", () => {
  const CARD: FinancialItem = {
    id: "card-oro",
    kind: "credit-card",
    name: "Oro",
    balance: 1000,
    annualRate: 40,
    cutDay: 5,
    dueDay: 25,
    minimumPayment: 200,
    recurrence: { frequency: "monthly", startDate: TODAY },
  };

  function typeIntoArea(area: HTMLTextAreaElement, text: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(area, text);
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("two sections with headings, Cargo / Abono columns, no signs; one undo step, announced", () => {
    const doc: FinancialDocument = { ...createDemoFinancialDocument(TODAY), items: [CARD] };
    const { core, bridge } = setup(doc);
    const onClose = vi.fn();
    mount(h(AnnouncerProvider, null, h(StatementDialog, { bridge, cardId: CARD.id, today: TODAY, onClose })));
    expect(document.querySelector(".fin-statement h2")!.textContent).toBe("Estado de cuenta · Oro");
    const area = document.querySelector<HTMLTextAreaElement>(".fin-statement__input")!;
    typeIntoArea(area, "01/11/2026 OXXO 500\n05/11/2026 PAGO RECIBIDO -200\n20/11/2026 TIENDA 300");
    const headings = [...document.querySelectorAll(".fin-statement__heading")].map((el) => el.textContent);
    expect(headings).toEqual(["Ya los debes (hasta hoy)", "Cargos futuros"]);
    const heads = [...document.querySelectorAll(".fin-statement thead th")].map((el) => el.textContent);
    expect(heads).toContain("Cargo");
    expect(heads).toContain("Abono");
    const cells = [...document.querySelectorAll(".fin-statement tbody td")].map((el) => el.textContent ?? "");
    expect(cells.some((text) => /^[+−-]/.test(text))).toBe(false);
    expect(document.body.textContent).toContain("línea de tiempo");
    expect(document.body.textContent).not.toContain("timeline");
    click(buttonByText("Aplicar")!);
    expect((bridge.getItem(CARD.id) as Extract<FinancialItem, { kind: "credit-card" }>).balance).toBe(1300);
    expect(bridge.getDocument().items.filter((item) => item.kind === "card-purchase")).toHaveLength(1);
    expect(liveText()).toContain("Estado de cuenta aplicado");
    // One Ctrl+Z takes the balance AND the purchase back.
    core.undo();
    expect(bridge.getDocument().items).toEqual([CARD]);
    expect(onClose).toHaveBeenCalled();
  });
});

// --- UX-55: the avalanche becomes a decision ----------------------------------------

describe("UX-55: 'Abonar $X a <deuda> hoy' never breaks the reserve and is undoable", () => {
  const rich = (): FinancialDocument => ({
    id: "rich",
    name: "Con margen",
    startDate: TODAY,
    initialCash: 50000,
    minimumCashReserve: 5000,
    horizonMonths: 12,
    items: [
      {
        id: "sueldo",
        kind: "income",
        name: "Sueldo",
        amount: 20000,
        recurrence: { frequency: "monthly", startDate: addDays(TODAY, 4) },
      },
      {
        id: "nu",
        kind: "credit-card",
        name: "Nu",
        balance: 12000,
        annualRate: 90,
        cutDay: 15,
        dueDay: 26,
        minimumPayment: 1000,
        recurrence: { frequency: "monthly", startDate: TODAY },
      },
    ],
  });

  it("todayExtraPayment: the most expensive debt, at most what keeps the reserve all year", () => {
    const doc = rich();
    const projection = projectFinancialDocument(doc);
    const plan = todayExtraPayment(doc, projection);
    expect(plan.kind).toBe("pay");
    if (plan.kind !== "pay") return;
    expect(plan.payment.debtId).toBe("nu");
    expect(plan.payment.amount).toBeLessThanOrEqual(projection.minimumCash.cash - doc.minimumCashReserve);
    const after = projectFinancialDocument(plan.payment.doc);
    expect(after.minimumCash.cash).toBeGreaterThanOrEqual(doc.minimumCashReserve);
  });

  it("with a valley below the reserve it says why there is nothing to spare", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const plan = todayExtraPayment(doc, projectFinancialDocument(doc));
    expect(plan).toMatchObject({ kind: "none" });
    expect(plan.kind === "none" && plan.reason).toMatch(/27 nov/);
  });

  it("the panel applies it in one undo step and announces it", () => {
    const { core, bridge } = setup(rich());
    mount(h(AnnouncerProvider, null, h(DebtStrategyPanel, { bridge })));
    expect(document.body.textContent).toContain("va primero a la deuda con la tasa más alta");
    const button = buttonByText("Abonar")!;
    const cash = bridge.getDocument().initialCash;
    click(button);
    const nu = bridge.getItem("nu") as Extract<FinancialItem, { kind: "credit-card" }>;
    expect(nu.balance).toBeLessThan(12000);
    expect(bridge.getDocument().initialCash).toBe(cash - (12000 - nu.balance));
    expect(liveText()).toMatch(/^Abonaste \$[\d,]+ a Nu hoy/);
    core.undo();
    expect((bridge.getItem("nu") as Extract<FinancialItem, { kind: "credit-card" }>).balance).toBe(12000);
    expect(bridge.getDocument().initialCash).toBe(cash);
  });
});

// --- UX-57 / UX-20 / UX-54: the futures menu -----------------------------------------

describe("UX-57: the futures menu holds only menu items; its notes sit outside", () => {
  it("role=menu children are menuitem* / separator / none; figures per future", () => {
    const { bridge } = setup(createDemoFinancialDocument(TODAY));
    const futures = new Futures(bridge, null);
    futures.fork(TODAY);
    mount(h(AnnouncerProvider, null, h(FuturesMenu, { bridge, futures })));
    click(document.querySelector<HTMLButtonElement>(".fin-futures__trigger")!);
    const menu = document.querySelector('[role="menu"]')!;
    const allowed = new Set(["menuitem", "menuitemradio", "menuitemcheckbox", "separator", "none", "group"]);
    for (const child of menu.children) expect(allowed.has(child.getAttribute("role") ?? "")).toBe(true);
    for (const row of menu.querySelectorAll('[role="none"]')) {
      for (const child of row.children) expect(child.getAttribute("role")).toMatch(/^menuitem/);
    }
    expect(menu.querySelector("p")).toBeNull();
    expect(document.querySelector(".fin-futures__hint")!.closest('[role="menu"]')).toBeNull();
    expect(document.querySelector(".fin-futures__meta")!.textContent).toMatch(/^Al horizonte \$[\d,]+ · punto más bajo/);
    expect(menu.textContent).toContain("Hacer este mi plan principal");
    expect(menu.textContent).toContain("Descartar este futuro");
    expect(menu.textContent).not.toContain("Reiniciar");
    expect(menu.textContent).not.toContain("Bifurcar");
  });

  it("Escape closes it and gives the focus back to its button", () => {
    const { bridge } = setup(createDemoFinancialDocument(TODAY));
    const futures = new Futures(bridge, null);
    mount(h(FuturesMenu, { bridge, futures }));
    const trigger = document.querySelector<HTMLButtonElement>(".fin-futures__trigger")!;
    act(() => trigger.focus());
    click(trigger);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    press(document.activeElement as HTMLElement, "Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("FuturesPeekChip: the other future in figures; 'Asomarte' toggles the peek, Escape ends it", () => {
    const { bridge } = setup(createDemoFinancialDocument(TODAY));
    const futures = new Futures(bridge, null);
    futures.fork(TODAY);
    bridge.setInitialCash(bridge.getDocument().initialCash - 25000);
    const onPeek = vi.fn();
    const onEndPeek = vi.fn();
    mount(h(FuturesPeekChip, { bridge, futures, peeking: false, onPeek, onEndPeek }));
    expect(document.querySelector(".fin-compare__text")!.textContent).toBe(
      "Otra versión contra Plan principal: horizonte −$25,000 · punto más bajo −$25,000",
    );
    click(buttonByText("Asomarte")!);
    expect(onPeek).toHaveBeenCalledWith(MAIN_BRANCH_ID);
    act(() => root!.render(h(FuturesPeekChip, { bridge, futures, peeking: true, onPeek, onEndPeek })));
    expect(buttonByText("Volver")!.getAttribute("aria-pressed")).toBe("true");
    press(document.body, "Escape");
    expect(onEndPeek).toHaveBeenCalled();
  });
});

// --- UX-22 / UX-27 / UX-58 / UX-62: the Rec dialog ------------------------------------

describe("UX-22: Rec shows what it assumes and what changes before Aplicar", () => {
  it("assumed cash, a live result, a heading, 'Aplicar'; Escape closes", () => {
    const { rec, bridge } = recSession();
    const onClose = vi.fn();
    const current = bridge.getDocument().initialCash;
    const moved = rec.pending.filter((p) => p.cashDelta !== 0).length;
    mount(
      h(RecDialog, {
        pending: rec.pending,
        since: rec.since,
        onApply: () => {},
        onClose,
        currentCash: current,
        resultCash: (actuals, cash) => recResultCash(rec, TODAY, actuals, cash, current),
      }),
    );
    expect(document.querySelector(".fin-rec__assumed")!.textContent).toBe(
      "Hoy SliceX supone que tienes " + formatMoneyWhole(current) + " (" + moved + " movimientos desde el 28 oct).",
    );
    const dialog = document.querySelector(".fin-rec")!;
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)!.tagName).toBe("H2");
    expect(document.querySelector(".fin-rec__result")!.textContent).toContain("sin cambio");
    const cash = document.querySelector<HTMLInputElement>(".fin-rec__cash input")!;
    typeInto(cash, "11400");
    expect(document.querySelector(".fin-rec__result")!.textContent).toBe(recResultLine(current, 11400));
    expect(buttonByText("Aplicar")).not.toBeNull();
    expect(buttonByText("Guardar")).toBeNull();
    press(cash, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// --- UX-01 through "/": a card with a balance and $0 a month ------------------------

describe("UX-01 via '/': a card that would never be paid off needs a payment or a choice", () => {
  it("parses the monthly payment ('pago 2000 al mes') and 'totalero'", () => {
    const paid = parseCommand("tarjeta oro 20000 pago 2000 al mes", { today: TODAY, doc: { ...createDemoFinancialDocument(TODAY), items: [] } })!;
    expect(paid.item).toMatchObject({ kind: "credit-card", balance: 20000, paymentAmount: 2000 });
    expect(paid.summary).toContain("pagas $2,000 al mes");
    expect(cardNeverPaidOff(paid.item)).toBe(false);
    const total = parseCommand("tarjeta oro 20000 totalero", { today: TODAY, doc: { ...createDemoFinancialDocument(TODAY), items: [] } })!;
    expect(total.item).toMatchObject({ kind: "credit-card", balance: 20000, paymentMode: "statement" });
    expect(cardNeverPaidOff(total.item)).toBe(false);
    const bare = parseCommand("tarjeta oro 20000", { today: TODAY, doc: { ...createDemoFinancialDocument(TODAY), items: [] } })!;
    expect(cardNeverPaidOff(bare.item)).toBe(true);
  });

  it("'tarjeta oro 20000': says it is never paid off; Enter adds nothing; 'totalero' is explicit", () => {
    const { bridge } = setup(createDemoFinancialDocument(TODAY));
    mount(h(AnnouncerProvider, null, h(CommandBar, { bridge, today: TODAY, onClose: () => {} })));
    const input = document.querySelector<HTMLInputElement>(".fin-command__input")!;
    const count = bridge.getDocument().items.length;
    typeInto(input, "tarjeta oro 20000");
    expect(document.querySelector(".fin-command__warning")!.textContent).toContain("no se liquida");
    press(input, "Enter");
    expect(bridge.getDocument().items.length).toBe(count);
    click(buttonByText("Pago el total cada mes")!);
    expect(bridge.getDocument().items.length).toBe(count + 1);
    const card = bridge.getDocument().items[bridge.getDocument().items.length - 1]!;
    expect(card).toMatchObject({ kind: "credit-card", balance: 20000, paymentMode: "statement" });
  });

  it("with a payment it is added on Enter", () => {
    const { bridge } = setup(createDemoFinancialDocument(TODAY));
    mount(h(AnnouncerProvider, null, h(CommandBar, { bridge, today: TODAY, onClose: () => {} })));
    const input = document.querySelector<HTMLInputElement>(".fin-command__input")!;
    const count = bridge.getDocument().items.length;
    typeInto(input, "tarjeta oro 20000 pago 2000 al mes");
    expect(document.querySelector(".fin-command__warning")).toBeNull();
    press(input, "Enter");
    expect(bridge.getDocument().items.length).toBe(count + 1);
  });
});
