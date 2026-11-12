// @vitest-environment jsdom
// UX audit 2026-11-11, group F (capture and editing): the item editor and the
// onboarding. Pure helpers (format, schedule-ui, item-schema,
// editor-readback, buildYear) and the forms headless against a small
// in-memory bridge (real @slicex/core projection, fake playlist core).
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  addDays,
  createDefaultFinancialItem,
  diffDays,
  findLiquidityWarnings,
  nextPayment,
  projectFinancialDocument,
  snapshotAt,
  type CreditCardItem,
  type FinancialDocument,
  type FinancialItem,
  type FinancialItemKind,
  type InstallmentPlanItem,
  type LoanItem,
} from "@slicex/core";
import type { PlaylistCore } from "@slicex/canvas";
import type { FinancialBridgeApi, FinancialPreview, PreviewEffect } from "../src/finance/bridge-api";
import { formatMoney, parseDateInput, parseNumberInput } from "../src/finance/format";
import { firstPayment, startOnFirstPayment, withPayday, withPaymentCount } from "../src/finance/schedule-ui";
import { fieldLabel, itemFormErrors } from "../src/finance/item-schema";
import {
  cardPayoffLine,
  cardPreview,
  cardSentence,
  installmentSchedule,
  installmentSentence,
  loanCheck,
  loanSuggestedPayment,
  payoffGoal,
} from "../src/finance/editor-readback";
import { FinancialEditorModal } from "../src/finance/components/FinancialEditorModal";
import { buildYear, defaultReserve, OnboardingDialog } from "../src/finance/components/Onboarding";
import { AnnouncerProvider } from "../src/ui/announcer";
import { SlicexMantineProvider } from "../src/mantine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;
const START = "2026-11-11";

// --- fakes -------------------------------------------------------------------

function createFakeBridge(initial: FinancialDocument) {
  let doc = initial;
  let projection = projectFinancialDocument(doc);
  let revision = 0;
  let preview: FinancialPreview | null = null;
  const listeners = new Set<() => void>();
  const coreListeners = new Set<(s: unknown) => void>();
  const coreState = {
    playPosition: { time: 0, isRunning: false },
    tracks: [] as unknown[],
    clips: [] as unknown[],
    viewport: { width: 1200, pxPerBeat: 10, scrollX: 0 },
  };
  const core = {
    getState: () => coreState,
    subscribe(listener: (s: unknown) => void) {
      coreListeners.add(listener);
      return { unsubscribe: () => coreListeners.delete(listener) };
    },
    undo: vi.fn(() => true),
  } as unknown as PlaylistCore;
  const commit = (next: FinancialDocument) => {
    doc = next;
    projection = projectFinancialDocument(doc);
    revision += 1;
    for (const l of [...listeners]) l();
  };
  const effect: PreviewEffect = {
    text: "",
    tone: "negative",
    minBefore: 1000,
    minAfter: -500,
    minAfterDate: "2026-11-27",
    finalBefore: 5000,
    finalAfter: 3000,
  };
  const bridge = {
    core,
    getRevision: () => revision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getDocument: () => doc,
    getProjection: () => projection,
    getItem: (id: string) => doc.items.find((item) => item.id === id) ?? null,
    replaceItem: vi.fn((item: FinancialItem) => {
      if (!doc.items.some((i) => i.id === item.id)) return false;
      commit({ ...doc, items: doc.items.map((i) => (i.id === item.id ? item : i)) });
      return true;
    }),
    deleteItem: vi.fn((id: string) => {
      commit({ ...doc, items: doc.items.filter((i) => i.id !== id) });
      return true;
    }),
    isItemLocked: () => false,
    createDraftItem: vi.fn((kind: FinancialItemKind) =>
      createDefaultFinancialItem(kind, `draft-${kind}`, doc.startDate, doc),
    ),
    addItem: vi.fn((item: FinancialItem) => {
      commit({ ...doc, items: [...doc.items, item] });
      return item.id;
    }),
    setInitialCash: (amount: number) => commit({ ...doc, initialCash: amount }),
    setMinimumCashReserve: (amount: number) => commit({ ...doc, minimumCashReserve: amount }),
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
    setPreview: vi.fn((next: FinancialPreview | null) => {
      preview = next;
    }),
    getPreview: () => preview,
    getPreviewEffect: () => (preview ? effect : null),
    setComparison: vi.fn(),
    getComparison: () => null,
    animateFrom: vi.fn(),
    isAnimating: () => false,
    exportSession: () => ({ session: { history: null }, doc }),
    importSession: vi.fn(),
    loadDocument: vi.fn((next: FinancialDocument) => commit(next)),
    destroy: () => listeners.clear(),
  } satisfies FinancialBridgeApi;
  return bridge;
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

const NU: CreditCardItem = {
  id: "fin-nu",
  kind: "credit-card",
  name: "Nu",
  balance: 20000,
  annualRate: 60,
  cutDay: 11,
  dueDay: 21,
  minimumPayment: 0,
  paymentAmount: 2000,
  recurrence: { frequency: "monthly", startDate: START },
};

const BBVA: CreditCardItem = { ...NU, id: "fin-bbva", name: "BBVA", balance: 0, paymentAmount: undefined };

// --- DOM helpers ---------------------------------------------------------------

let root: Root | null = null;

function mount(element: React.ReactElement): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      h(SlicexMantineProvider, { theme: "light", children: h(AnnouncerProvider, { children: element }) }),
    ),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function buttonByText(text: string): HTMLButtonElement | null {
  return [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) ?? null;
}

function mustButton(text: string): HTMLButtonElement {
  const button = buttonByText(text);
  if (!button) throw new Error(`button "${text}" not found`);
  return button;
}

/** The control of the field whose visible label is exactly `label` ("(opcional)" aside). */
function field<T extends HTMLElement = HTMLInputElement>(label: string): T {
  const named = [...document.querySelectorAll(".fin-editor__label")].find(
    (el) => el.textContent?.replace("(opcional)", "").trim() === label,
  );
  const byFor = named instanceof HTMLLabelElement && named.htmlFor ? document.getElementById(named.htmlFor) : null;
  const control = byFor ?? named?.closest(".fin-editor__field")?.querySelector("input, select");
  if (!control) throw new Error(`field "${label}" not found`);
  return control as T;
}

function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
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

function preset(text: string): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>(".fin-repeat__preset")].find(
    (candidate) => candidate.textContent === text,
  )!;
}

const errorText = () => document.querySelector(".fin-editor__error")?.textContent ?? "";
const checkLines = () => [...document.querySelectorAll(".fin-editor__check-line")].map((el) => el.textContent ?? "");
const readbacks = () => [...document.querySelectorAll(".fin-readback__sentence")].map((el) => el.textContent ?? "");
const title = () => document.querySelector(".fin-editor__title")?.textContent ?? "";

function openEditor(props: Record<string, unknown>) {
  mount(h(FinancialEditorModal, { onClose: () => {}, ...props } as never));
}

// --- UX-35: the parsers understand what "/" understands ---------------------------

describe("UX-35: parseNumberInput reads 'mil' and 'k'", () => {
  it.each([
    ["12 mil", 12000],
    ["8 mil 500", 8500],
    ["mil", 1000],
    ["12k", 12000],
    ["1.5k", 1500],
    ["-2k", -2000],
    ["12,000 pesos", 12000],
    ["1,234.5", 1234.5],
    ["12 MXN", 12],
  ])("%j → %d", (raw, value) => {
    expect(parseNumberInput(raw)).toBe(value);
  });

  it("empty is null; garbage is NaN; a currency sign is fine", () => {
    expect(parseNumberInput("$12 mil")).toBe(12000);
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("doce")).toBeNaN();
  });
});

describe("UX-35: parseDateInput reads relative words and a bare day", () => {
  const ref = "2026-11-07";
  const today = START; // Wednesday 11 nov 2026
  it.each([
    ["hoy", "2026-11-11"],
    ["mañana", "2026-11-12"],
    ["Pasado mañana", "2026-11-13"],
    ["ayer", "2026-11-10"],
    ["fin de mes", "2026-11-30"],
    ["fin del mes", "2026-11-30"],
    ["último día del mes", "2026-11-30"],
    ["15", "2026-11-15"],
    ["el 15", "2026-11-15"],
    ["día 15", "2026-11-15"],
    ["el día 15", "2026-11-15"],
    ["11", "2026-11-11"],
    ["10", "2026-12-10"],
    ["31", "2026-12-31"],
    ["el 15 de diciembre", "2026-12-15"],
  ])("%j → %s", (raw, iso) => {
    expect(parseDateInput(raw, ref, "nearest", today)).toBe(iso);
  });

  it("an end date (on-or-after) counts a bare day from its reference", () => {
    expect(parseDateInput("15", "2027-01-20", "on-or-after", today)).toBe("2027-02-15");
  });

  it("without `today`, the reference is today (still pure)", () => {
    expect(parseDateInput("mañana", ref)).toBe("2026-11-08");
    expect(parseDateInput("32", ref)).toBeNull();
  });
});

// --- UX-34: first payment and payday ---------------------------------------------

describe("UX-34: 'Primer pago' is the first payment; 'Día' moves it forward", () => {
  it("firstPayment / startOnFirstPayment keep the same payments", () => {
    const pay = { frequency: "monthly" as const, startDate: START, anchorDate: "2026-11-25" };
    expect(firstPayment(pay)).toBe("2026-11-25");
    expect(startOnFirstPayment(pay)).toEqual({ ...pay, startDate: "2026-11-25" });
    const quincena = { frequency: "semimonthly" as const, startDate: START };
    expect(startOnFirstPayment(quincena)).toEqual({ frequency: "semimonthly", startDate: "2026-11-15" });
    const weekly = { frequency: "weekly" as const, startDate: START };
    expect(startOnFirstPayment(weekly)).toBe(weekly);
  });

  it("withPayday: the next such day from the start, the count kept", () => {
    const rent = { frequency: "monthly" as const, startDate: START };
    expect(withPayday(rent, 1)).toMatchObject({ startDate: "2026-12-01", anchorDate: "2026-12-01" });
    expect(withPayday(rent, 25)).toMatchObject({ startDate: "2026-11-25" });
    expect(withPayday(rent, 31)).toMatchObject({ startDate: "2026-11-30", anchorDate: "2026-12-31" });
    const three = { ...rent, endDate: "2027-01-11" };
    expect(withPayday(three, 20)).toMatchObject({ startDate: "2026-11-20", endDate: "2027-01-20" });
  });
});

// --- item-schema: the editor's rules -----------------------------------------------

describe("item-schema: UX-01 / UX-07 / UX-08 / UX-30 / UX-32 rules", () => {
  it("UX-01: a card that owes money needs a payment (or totalero, or a minimum)", () => {
    const owes: CreditCardItem = { ...NU, paymentAmount: undefined };
    expect(itemFormErrors(owes, []).paymentAmount).toBe("Escribe cuánto pagas al mes (o elige totalero)");
    expect(itemFormErrors({ ...owes, paymentMode: "statement" }, []).paymentAmount).toBeUndefined();
    expect(itemFormErrors({ ...owes, minimumPayment: 500 }, []).paymentAmount).toBeUndefined();
    // A typed 0 is an answer (the live line says it never ends).
    expect(itemFormErrors({ ...owes, paymentAmount: 0 }, []).paymentAmount).toBeUndefined();
  });

  it("UX-08: a repeating loan asks how many payments are left", () => {
    const loan: LoanItem = {
      id: "l",
      kind: "loan",
      name: "Préstamo",
      paymentAmount: 1500,
      recurrence: { frequency: "monthly", startDate: START },
    };
    expect(itemFormErrors(loan, [])["recurrence.endDate"]).toBe("Escribe cuántos pagos te faltan");
    // One form: the end is "Termina" for every kind (a loan answers it with
    // the payments it still owes).
    expect(fieldLabel("recurrence.endDate", loan)).toBe("Termina");
  });

  it("UX-30 / UX-32: an empty amount says what to write, with the visible label", () => {
    const blank = { id: "e", kind: "expense", name: "Renta", amount: undefined, recurrence: { frequency: "once", startDate: START, endDate: START } } as unknown as FinancialItem;
    expect(itemFormErrors(blank, []).amount).toBe("Escribe el monto");
    expect(fieldLabel("recurrence.startDate", blank)).toBe("Fecha");
    const msi = { id: "m", kind: "installment-plan", name: "x", originalAmount: 1, installmentsTotal: 1, installmentsPaid: 0, recurrence: { frequency: "monthly", startDate: START } } as FinancialItem;
    expect(fieldLabel("recurrence.startDate", msi)).toBe("Fecha de compra");
  });

  it("UX-07: an MSI end that leaves installments out is an error of its end", () => {
    const plan: InstallmentPlanItem = {
      id: "tele",
      kind: "installment-plan",
      name: "Tele 12 MSI",
      cardId: NU.id,
      originalAmount: 12000,
      installmentsTotal: 12,
      installmentsPaid: 0,
      recurrence: { frequency: "monthly", startDate: START, endDate: "2027-02-11" },
    };
    const message = itemFormErrors(plan, [NU], { docStartDate: START })["recurrence.endDate"];
    expect(message).toBe("Deja fuera 9 abonos: el último es el jue 21 oct 2027");
    const open = { ...plan, recurrence: { frequency: "monthly" as const, startDate: START } };
    expect(itemFormErrors(open, [NU], { docStartDate: START })).toEqual({});
  });
});

// --- editor-readback ---------------------------------------------------------------

describe("editor-readback: what the editor says back (UX-01, UX-07, UX-08, UX-28, UX-33)", () => {
  const plan: InstallmentPlanItem = {
    id: "tele",
    kind: "installment-plan",
    name: "Tele",
    cardId: NU.id,
    originalAmount: 12000,
    installmentsTotal: 12,
    installmentsPaid: 0,
    recurrence: { frequency: "monthly", startDate: START },
  };

  it("MSI: first and last installment, on the card's payment day", () => {
    const schedule = installmentSchedule(plan, [NU], START)!;
    expect(schedule.all).toHaveLength(12);
    expect(installmentSentence(plan, schedule)).toBe(
      "Abonas $1,000 al mes con Nu: el primero el sáb 21 nov 2026 (1 de 12), el último el jue 21 oct 2027 (12 de 12).",
    );
  });

  it("card: cycle and next payment; payoff or 'no se liquida'", () => {
    const doc = docWith([NU]);
    const info = cardPreview(NU, doc);
    expect(cardSentence(NU, info)).toBe(
      "Cortas el 11 y pagas el 21 de cada mes. Próximo pago: sáb 21 nov 2026 · $2,000.",
    );
    expect(cardPayoffLine(NU, info)?.text).toMatch(/^Libre en [a-z]{3} \d{4} · intereses ≈ \$[\d,]+$/);
    const never = { ...NU, paymentAmount: undefined };
    expect(cardPayoffLine(never, cardPreview(never, doc))).toEqual({
      text: "Con $0 al mes no se liquida: la deuda solo crece con los intereses",
      tone: "warning",
    });
  });

  it("loan: balance × payment × count agree, or an adjustment is offered", () => {
    const loan = (count: number): LoanItem => ({
      id: "l",
      kind: "loan",
      name: "Préstamo",
      balance: 10000,
      paymentAmount: 1500,
      recurrence: withPaymentCount({ frequency: "monthly", startDate: "2026-11-20" }, count),
    });
    expect(loanCheck(loan(13))).toMatchObject({ tone: "warning", adjustTo: 7 });
    expect(loanCheck(loan(13))!.text).toBe(
      "13 × $1,500 = $19,500, más de lo que cuesta tu saldo de $10,000: lo liquidas en 7 pagos.",
    );
    expect(loanCheck(loan(5))!.text).toContain("te faltarían 2");
    expect(loanCheck(loan(7))).toMatchObject({ tone: "positive" });
    expect(loanSuggestedPayment({ ...loan(4), paymentAmount: 1 })).toBe(2500);
    expect(loanSuggestedPayment({ ...loan(12), balance: 100000, annualRate: 12 })).toBe(8884.88);
  });

  it("'Quiero liquidarla el …' speaks like the canvas pill", () => {
    const goal = payoffGoal({ ...NU, paymentAmount: undefined }, docWith([NU]), "2027-11-30")!;
    expect(goal.feasible).toBe(true);
    expect(goal.text).toMatch(/^Libre en [a-z]{3} 2027 · pagas \$[\d,]+\/mes$/);
    expect(goal.paymentAmount).toBeGreaterThan(1000);
  });
});

// --- the editor --------------------------------------------------------------------

describe("UX-01: a new card with a debt never saves 'paid by nobody'", () => {
  it("asks for the monthly payment, says when it ends, then saves", () => {
    const bridge = createFakeBridge(docWith([]));
    openEditor({ bridge, draft: bridge.createDraftItem("credit-card") });
    // UX-30: the balance is asked, not assumed.
    expect(field("¿Cuánto debes hoy?").value).toBe("");
    typeInto(field("¿Cuánto debes hoy?"), "20 mil");
    expect(checkLines()[0]).toBe("Con $0 al mes no se liquida: la deuda solo crece con los intereses");
    click(mustButton("Guardar"));
    expect(bridge.addItem).not.toHaveBeenCalled();
    expect(errorText()).toBe("¿Cuánto pagas al mes?: escribe cuánto pagas al mes (o elige totalero).");
    expect(document.activeElement).toBe(field("¿Cuánto pagas al mes?"));
    typeInto(field("¿Cuánto pagas al mes?"), "2,000");
    expect(checkLines()[0]).toMatch(/^Libre en [a-z]{3} \d{4} · intereses ≈ \$/);
    click(mustButton("Guardar"));
    expect(bridge.addItem).toHaveBeenCalledTimes(1);
    expect(bridge.addItem.mock.calls[0]![0]).toMatchObject({
      kind: "credit-card",
      balance: 20000,
      paymentAmount: 2000,
      minimumPayment: 0,
    });
  });

  it("totalero: no payment asked; rate and minimum are muted (UX-33)", () => {
    const bridge = createFakeBridge(docWith([]));
    openEditor({ bridge, draft: bridge.createDraftItem("credit-card") });
    typeInto(field("¿Cuánto debes hoy?"), "5000");
    choose(field<HTMLSelectElement>("Forma de pago"), "statement");
    expect(document.querySelector('[data-field-path="paymentAmount"]')).toBeNull();
    const rate = document.querySelector('[data-field-path="annualRate"]')!;
    expect(rate.classList.contains("fin-editor__field--muted")).toBe(true);
    expect(rate.textContent).toContain("No se usa si pagas el total");
    expect(checkLines()[0]).toMatch(/^Totalero: pagas cada estado de cuenta completo, sin intereses/);
    click(mustButton("Guardar"));
    expect(bridge.addItem.mock.calls[0]![0]).toMatchObject({ paymentMode: "statement", balance: 5000 });
  });
});

describe("UX-07 / UX-33: an MSI's 'Termina' is derived (no 'Nunca'); its installments are said", () => {
  it("new MSI on the only card: 'Fecha de compra' and first / last installment", () => {
    const bridge = createFakeBridge(docWith([NU]));
    openEditor({ bridge, draft: bridge.createDraftItem("installment-plan") });
    expect(document.querySelector("#fin-editor-end")).toBeNull();
    expect(field("Fecha de compra").value).toBe("11/11/2026");
    typeInto(field("Monto de la compra"), "12,000");
    typeInto(field("Meses"), "12");
    // The name that only said the months follows them.
    expect(field("Nombre").value).toBe("12 MSI");
    expect(readbacks()[0]).toBe(
      "Abonas $1,000 al mes con Nu: el primero el sáb 21 nov 2026 (1 de 12), el último el jue 21 oct 2027 (12 de 12).",
    );
    expect(document.body.textContent).not.toContain("Nunca");
  });

  it("an end that cuts installments blocks Guardar until removed", () => {
    const plan: InstallmentPlanItem = {
      id: "tele",
      kind: "installment-plan",
      name: "Tele",
      cardId: NU.id,
      originalAmount: 12000,
      installmentsTotal: 12,
      installmentsPaid: 0,
      recurrence: { frequency: "monthly", startDate: START, endDate: "2027-02-11" },
    };
    const bridge = createFakeBridge(docWith([NU, plan]));
    openEditor({ bridge, itemId: plan.id });
    click(mustButton("Guardar"));
    expect(bridge.replaceItem).not.toHaveBeenCalled();
    expect(errorText()).toBe("Termina: deja fuera 9 abonos: el último es el jue 21 oct 2027.");
    click(mustButton("Quitar la fecha de fin"));
    click(mustButton("Guardar"));
    expect(bridge.replaceItem).toHaveBeenCalledTimes(1);
    expect(bridge.replaceItem.mock.calls[0]![0].recurrence.endDate).toBeUndefined();
  });
});

describe("UX-08: a loan crosses balance, payment and payments left", () => {
  it("warns on a mismatch, adjusts the count, computes the payment", () => {
    const bridge = createFakeBridge(docWith([]));
    openEditor({ bridge, draft: bridge.createDraftItem("loan") });
    const labelsIn = (section: string) =>
      [...document.querySelectorAll(`.fin-editor__section--${section} .fin-editor__label`)].map((el) =>
        el.textContent?.replace("(opcional)", "").trim(),
      );
    // Ordered by the decision: owed → pay; the payments left are its
    // "Termina", in "Cuándo" like every kind's end.
    expect(labelsIn("amount")).toEqual(["¿Cuánto debes hoy?", "¿Cuánto pagas?"]);
    expect(labelsIn("when")).toContain("Termina");
    expect(field("Termina").value).toBe("");
    typeInto(field("¿Cuánto debes hoy?"), "10000");
    typeInto(field("¿Cuánto pagas?"), "1500");
    typeInto(field("Termina"), "13");
    expect(checkLines()[0]).toBe(
      "13 × $1,500 = $19,500, más de lo que cuesta tu saldo de $10,000: lo liquidas en 7 pagos.Ajustar a 7 pagos",
    );
    click(mustButton("Ajustar a 7 pagos"));
    expect(field("Termina").value).toBe("7");
    click(mustButton("Calcular pago: $1,428.58"));
    expect(field("¿Cuánto pagas?").value).toBe("1428.58");
    expect(document.querySelector(".fin-editor__check-line")!.getAttribute("data-tone")).toBe("positive");
    // The rate is said to be informative.
    expect(document.querySelector('[data-field-path="annualRate"]')!.textContent).toContain("tu pago ya los incluye");
    click(mustButton("Guardar"));
    expect(bridge.addItem.mock.calls[0]![0]).toMatchObject({ kind: "loan", balance: 10000, paymentAmount: 1428.58 });
  });
});

describe("UX-23: the editor shows what the item does to your cash", () => {
  it("previews the draft (key without the name), clears it on Cancelar", () => {
    vi.useFakeTimers();
    const bridge = createFakeBridge(docWith([]));
    const onClose = vi.fn();
    openEditor({ bridge, draft: bridge.createDraftItem("expense"), onClose });
    expect(bridge.setPreview).not.toHaveBeenCalled();
    typeInto(field("Monto"), "500");
    act(() => vi.advanceTimersByTime(200));
    expect(bridge.setPreview).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "add", item: expect.objectContaining({ amount: 500 }) }),
    );
    expect(document.querySelector(".fin-effect")?.textContent).toBe(
      "Tu caja: mínimo $1,000 → −$500 (27 nov) · al horizonte −$2,000 · entras en rojo",
    );
    const calls = bridge.setPreview.mock.calls.length;
    typeInto(field("Nombre"), "Renta de la oficina");
    act(() => vi.advanceTimersByTime(200));
    expect(bridge.setPreview.mock.calls.length).toBe(calls);
    act(() => root!.unmount());
    root = null;
    expect(bridge.setPreview).toHaveBeenLastCalledWith(null);
  });
});

describe("UX-24: a purchase without cards creates its card without losing the draft", () => {
  it("'Crear tarjeta…' → the card is added and chosen; the purchase keeps its amount", () => {
    const bridge = createFakeBridge(docWith([]));
    openEditor({ bridge, draft: bridge.createDraftItem("card-purchase") });
    typeInto(field("Monto"), "3000");
    expect(document.body.textContent).not.toContain("+ Tarjeta");
    click(mustButton("Crear tarjeta…"));
    typeInto(field("Nombre de la tarjeta"), "Nu");
    choose(field<HTMLSelectElement>("Día de corte"), "11");
    choose(field<HTMLSelectElement>("Día de pago"), "21");
    click(mustButton("Crear tarjeta"));
    expect(bridge.addItem).toHaveBeenCalledTimes(1);
    const card = bridge.addItem.mock.calls[0]![0];
    expect(card).toMatchObject({ kind: "credit-card", name: "Nu", cutDay: 11, dueDay: 21, paymentMode: "statement" });
    expect(field<HTMLSelectElement>("Tarjeta").value).toBe(card.id);
    expect(field("Monto").value).toBe("3000");
    expect(document.body.textContent).toContain("Tarjeta «Nu» creada");
    click(mustButton("Guardar"));
    expect(bridge.addItem.mock.calls[1]![0]).toMatchObject({ kind: "card-purchase", cardId: card.id, amount: 3000 });
  });
});

describe("UX-26: Guardar / Eliminar are announced, with Deshacer", () => {
  it("announces the saved item and undoes through the playlist history", () => {
    const bridge = createFakeBridge(docWith([]));
    openEditor({ bridge, draft: { ...bridge.createDraftItem("expense"), name: "Renta" } });
    typeInto(field("Monto"), "8000");
    click(mustButton("Guardar"));
    expect(document.body.textContent).toContain("Agregado: Renta.");
    click(mustButton("Deshacer"));
    expect(bridge.core.undo).toHaveBeenCalledTimes(1);
  });
});

describe("UX-28: 'Quiero liquidarla el …' without dragging", () => {
  it("solves the payment for a date and uses it", () => {
    const bridge = createFakeBridge(docWith([NU]));
    openEditor({ bridge, itemId: NU.id });
    typeInto(field("Quiero liquidarla el"), "30/11/2027");
    const preview = field("Quiero liquidarla el").closest(".fin-editor__field")!.querySelector(".fin-date__preview")!;
    expect(preview.textContent).toMatch(/^Libre en [a-z]{3} 2027 · pagas \$[\d,]+\/mes$/);
    const use = [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Usar "))!;
    click(use);
    click(mustButton("Guardar"));
    const saved = bridge.replaceItem.mock.calls[0]![0] as CreditCardItem;
    expect(saved.paymentAmount).toBeGreaterThan(2000);
    expect(use.textContent).toBe(`Usar ${formatMoney(saved.paymentAmount!)}`);
  });
});

describe("UX-30: amounts are asked, cards are not guessed", () => {
  it("an untouched draft asks for the amount; two cards → 'Selecciona…'", () => {
    const bridge = createFakeBridge(docWith([NU, BBVA]));
    openEditor({ bridge, draft: bridge.createDraftItem("card-purchase") });
    expect(field("Monto").value).toBe("");
    const select = field<HTMLSelectElement>("Tarjeta");
    expect(select.selectedOptions[0]?.textContent).toBe("Selecciona…");
    click(mustButton("Guardar"));
    expect(bridge.addItem).not.toHaveBeenCalled();
    expect(errorText()).toBe("Monto: escribe el monto.");
  });
});

describe("UX-31: the kind is a field of the one form; switching never loses what was typed", () => {
  it("Gasto 8,000 cada mes → Tarjeta → Gasto keeps 8,000 and 'Cada mes'", () => {
    const bridge = createFakeBridge(docWith([]));
    openEditor({ bridge, draft: bridge.createDraftItem("expense") });
    // "Tipo" is always there, first, like any other field.
    expect(field<HTMLSelectElement>("Tipo").value).toBe("expense");
    expect(buttonByText("Cambiar tipo…")).toBeNull();
    typeInto(field("Monto"), "8000");
    click(preset("Cada mes"));
    choose(field<HTMLSelectElement>("Tipo"), "credit-card");
    expect(title()).toBe("Nueva Tarjeta");
    expect(field("Nombre").value).toBe("Tarjeta");
    choose(field<HTMLSelectElement>("Tipo"), "expense");
    expect(title()).toBe("Nuevo Gasto");
    expect(field("Monto").value).toBe("8000");
    expect(preset("Cada mes").getAttribute("aria-checked")).toBe("true");
  });

  it("editing, a conversion is confirmed first", () => {
    const rent: FinancialItem = {
      id: "renta",
      kind: "expense",
      name: "Renta",
      amount: 8000,
      recurrence: { frequency: "monthly", startDate: START },
    };
    const bridge = createFakeBridge(docWith([rent]));
    openEditor({ bridge, itemId: rent.id });
    choose(field<HTMLSelectElement>("Tipo"), "income");
    expect(title()).toBe("Editar Gasto");
    expect(document.body.textContent).toContain("¿Convertir «Renta» de Gasto a Ingreso?");
    click(mustButton("Convertir"));
    expect(title()).toBe("Editar Ingreso");
  });
});

describe("UX-34: the onboarding's pay opens as 'Primer cobro 25/11/2026 · Día 25'", () => {
  it("a window that starts before its first payday shows the payday", () => {
    const pay: FinancialItem = {
      id: "mi-sueldo",
      kind: "income",
      name: "Sueldo",
      amount: 20000,
      recurrence: { frequency: "monthly", startDate: START, anchorDate: "2026-11-25" },
    };
    const bridge = createFakeBridge(docWith([pay]));
    openEditor({ bridge, itemId: pay.id });
    expect(field("Primer cobro").value).toBe("25/11/2026");
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Día de cobro"]')!.value).toBe("25");
  });
});

describe("UX-37: focus never changes 'Termina'; the readback is said once per pause", () => {
  const RENTA: FinancialItem = {
    id: "renta",
    kind: "expense",
    name: "Renta",
    amount: 8000,
    recurrence: { frequency: "monthly", startDate: "2026-11-20", endDate: "2027-05-20" },
  };

  it("Tab through 'Número de pagos' leaves 'El' chosen", () => {
    const bridge = createFakeBridge(docWith([RENTA]));
    openEditor({ bridge, itemId: RENTA.id });
    const el = [...document.querySelectorAll<HTMLLabelElement>(".fin-ends label")].find(
      (l) => l.textContent?.trim() === "El",
    )!.querySelector("input")!;
    expect(el.checked).toBe(true);
    const count = document.querySelector<HTMLInputElement>('[aria-label="Número de pagos"]')!;
    act(() => {
      count.focus();
      count.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(el.checked).toBe(true);
  });

  it("typing an amount produces one announcement, after the pause", () => {
    vi.useFakeTimers();
    const bridge = createFakeBridge(docWith([RENTA]));
    openEditor({ bridge, itemId: RENTA.id });
    const region = document.querySelector('.fin-editor [role="status"].fin-sr-only')!;
    typeInto(field("Monto"), "9");
    act(() => vi.advanceTimersByTime(300));
    typeInto(field("Monto"), "95");
    act(() => vi.advanceTimersByTime(300));
    typeInto(field("Monto"), "9500");
    act(() => vi.advanceTimersByTime(300));
    expect(region.textContent).toBe("");
    act(() => vi.advanceTimersByTime(400));
    expect(region.textContent).toContain("Pagas $9,500 cada mes, el día 20");
  });
});

describe("UX-51 / UX-27: unsaved changes are never dropped silently", () => {
  it("'Pegar estado de cuenta…' asks first when there are changes", () => {
    const bridge = createFakeBridge(docWith([NU]));
    const onImportStatement = vi.fn();
    openEditor({ bridge, itemId: NU.id, onImportStatement });
    typeInto(field("Nombre"), "Nu Oro");
    click(mustButton("Pegar estado de cuenta…"));
    expect(onImportStatement).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Guarda o descarta tus cambios antes de pegar el estado de cuenta.");
    click(mustButton("Guardar y pegar"));
    expect(bridge.replaceItem.mock.calls[0]![0]).toMatchObject({ name: "Nu Oro" });
    expect(onImportStatement).toHaveBeenCalledWith(NU.id);
  });

  it("without changes it opens at once", () => {
    const bridge = createFakeBridge(docWith([NU]));
    const onImportStatement = vi.fn();
    openEditor({ bridge, itemId: NU.id, onImportStatement });
    click(mustButton("Pegar estado de cuenta…"));
    expect(onImportStatement).toHaveBeenCalledWith(NU.id);
  });

  it("a press outside with changes asks; without changes it closes", () => {
    const bridge = createFakeBridge(docWith([NU]));
    const onClose = vi.fn();
    openEditor({ bridge, itemId: NU.id, onClose });
    typeInto(field("Nombre"), "Nu Oro");
    click(document.querySelector(".playlist-shell__modal-overlay") as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Tienes cambios sin guardar.");
    click(mustButton("Descartar cambios"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("UX-58: dialog titles are headings that name the dialog", () => {
  it("editor and onboarding", () => {
    const bridge = createFakeBridge(docWith([NU]));
    openEditor({ bridge, itemId: NU.id });
    const dialog = document.querySelector('.fin-editor[role="dialog"]')!;
    const heading = document.getElementById(dialog.getAttribute("aria-labelledby")!)!;
    expect(heading.tagName).toBe("H2");
    expect(heading.textContent).toBe("Editar Tarjeta");
    act(() => root!.unmount());
    mount(h(OnboardingDialog, { today: START, onCreate: () => {}, onClose: () => {} }));
    const onboarding = document.querySelector('.fin-onboarding[role="dialog"]')!;
    expect(document.getElementById(onboarding.getAttribute("aria-labelledby")!)!.tagName).toBe("H2");
  });
});

// --- the onboarding ------------------------------------------------------------------

describe("UX-12 / UX-24: the onboarding shows the year before creating it", () => {
  const input = (label: string) =>
    [...document.querySelectorAll<HTMLInputElement>(".fin-onboarding input")].find(
      (el) =>
        el.getAttribute("aria-label") === label ||
        el.closest("label")?.querySelector(".fin-editor__label")?.textContent?.startsWith(label),
    )!;
  const select = (label: string) => document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  const submit = () =>
    act(() => {
      document
        .querySelector<HTMLFormElement>(".fin-onboarding")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

  it("defaultReserve: one pay, never more than today's cash", () => {
    expect(defaultReserve(12000, 20000)).toBe(12000);
    expect(defaultReserve(12000, 9000)).toBe(9000);
    expect(defaultReserve(-500, 9000)).toBe(0);
  });

  it("buildYear: debts become a card / a loan that ends when paid; chosen suggestions with their amounts", () => {
    const doc = buildYear(START, {
      cash: 12000,
      frequency: "monthly",
      pay: 20000,
      nextPay: "2026-11-25",
      reserve: 5000,
      fixed: [{ name: "Renta", amount: 8000, day: 31 }],
      debts: [
        { kind: "card", name: "Nu", balance: 20000, payment: 2000, day: 21 },
        { kind: "loan", name: "Coche", balance: 10000, payment: 1500, day: 5 },
      ],
      withSuggestions: true,
      suggestions: [{ id: "sug-aguinaldo-2026", amount: 7000 }],
    });
    const card = doc.items.find((item) => item.name === "Nu") as CreditCardItem;
    expect(card).toMatchObject({ kind: "credit-card", balance: 20000, paymentAmount: 2000, dueDay: 21, cutDay: 1 });
    const loan = doc.items.find((item) => item.name === "Coche") as LoanItem;
    expect(loan.recurrence).toMatchObject({ frequency: "monthly", startDate: "2026-12-05", endDate: "2027-06-05" });
    const rent = doc.items.find((item) => item.name === "Renta")!;
    expect(rent.recurrence).toMatchObject({ startDate: "2026-11-30", anchorDate: "2026-12-31" });
    const extras = doc.items.filter((item) => item.id.startsWith("sug-"));
    expect(extras).toHaveLength(1);
    expect(extras[0]).toMatchObject({ name: "Aguinaldo", amount: 7000 });
  });

  it("answers → review (cushion, debts, each suggestion with box and amount, verdict) → create", () => {
    const onCreate = vi.fn();
    mount(h(OnboardingDialog, { today: START, onCreate, onClose: () => {} }));
    typeInto(input("¿Cuánto dinero tienes hoy?"), "12 mil");
    typeInto(input("¿Cuánto cada vez?"), "20000");
    // The cushion's default is said, not hidden in a placeholder.
    expect(document.body.textContent).toContain("Si lo dejas vacío: $12,000");
    click(mustButton("+ otra fila"));
    expect(input("Gasto fijo 4")).toBeDefined();
    typeInto(input("Nombre de la deuda 1"), "Nu");
    typeInto(input("Cuánto debes (deuda 1)"), "20,000");
    typeInto(input("Cuánto pagas al mes (deuda 1)"), "2,000");
    choose(select("Día de pago (deuda 1)"), "21");
    submit();
    expect(onCreate).not.toHaveBeenCalled();
    const review = document.querySelector(".fin-onboarding__review")!;
    expect(review.textContent).toContain("Nu: debes $20,000; pagas $2,000 el día 21");
    expect(input("Tu colchón").value).toBe("12000");
    const rows = [...document.querySelectorAll(".fin-onboarding__suggestion")];
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect(row.querySelector('input[type="checkbox"]')).not.toBeNull();
      expect((row.querySelector('input[type="text"]') as HTMLInputElement).value).not.toBe("");
    }
    const aguinaldo = rows.find((row) => row.textContent?.startsWith("Aguinaldo"))!;
    expect((aguinaldo.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    const buenFin = rows.find((row) => row.textContent?.startsWith("Buen Fin"))!;
    expect((buenFin.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    typeInto(aguinaldo.querySelector('input[type="text"]') as HTMLInputElement, "15000");
    expect(document.querySelector(".fin-onboarding__verdict")?.textContent).toMatch(/^Así queda tu año: tu punto más bajo es /);
    submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
    const doc = onCreate.mock.calls[0]![0] as FinancialDocument;
    expect(doc.minimumCashReserve).toBe(12000);
    expect(doc.items.find((item) => item.name === "Aguinaldo")).toMatchObject({ amount: 15000 });
    expect(doc.items.some((item) => item.name === "Buen Fin")).toBe(false);
    expect(doc.items.find((item) => item.name === "Nu")).toMatchObject({ kind: "credit-card", paymentAmount: 2000 });
  });

  it("a debt row half written is an error on its row; Escape closes (UX-27)", () => {
    const onClose = vi.fn();
    mount(h(OnboardingDialog, { today: START, onCreate: () => {}, onClose }));
    typeInto(input("¿Cuánto dinero tienes hoy?"), "0");
    typeInto(input("¿Cuánto cada vez?"), "9000");
    typeInto(input("Nombre de la deuda 1"), "Nu");
    submit();
    expect(document.querySelector(".fin-onboarding__review")).toBeNull();
    expect(input("Cuánto debes (deuda 1)").getAttribute("aria-invalid")).toBe("true");
    // UX-32: the focus lands on the first field to fix.
    expect(document.activeElement).toBe(input("Cuánto debes (deuda 1)"));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("integration: 'Guardar' without edits leaves the plan alone", () => {
  it("an untouched recurring item is not rewritten (its window start stays)", () => {
    const pay: FinancialItem = {
      id: "mi-sueldo",
      kind: "income",
      name: "Sueldo",
      amount: 20000,
      recurrence: { frequency: "monthly", startDate: START, anchorDate: "2026-11-25" },
    };
    const bridge = createFakeBridge(docWith([pay]));
    const onClose = vi.fn();
    openEditor({ bridge, itemId: pay.id, onClose });
    click(mustButton("Guardar"));
    expect(bridge.replaceItem).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bridge.getItem(pay.id)!.recurrence.startDate).toBe(START);
  });
});

// --- Formulario único: the same skeleton for the six kinds -------------------------

describe("Formulario único: every kind opens the same skeleton", () => {
  const sectionsInDom = () =>
    [...document.querySelectorAll(".fin-editor__section")].map((el) =>
      [...el.classList].find((name) => name.startsWith("fin-editor__section--"))!.replace("fin-editor__section--", ""),
    );
  const sectionLabels = (section: string) =>
    [...document.querySelectorAll(`.fin-editor__section--${section} .fin-editor__label`)].map((el) =>
      el.textContent?.replace("(opcional)", "").trim(),
    );

  it.each([
    ["income", ["head", "amount", "when", "outcome"]],
    ["expense", ["head", "amount", "when", "outcome"]],
    ["loan", ["head", "amount", "when", "details", "outcome"]],
    ["credit-card", ["head", "amount", "when", "details", "outcome"]],
    ["card-purchase", ["head", "amount", "when", "details", "outcome"]],
    ["installment-plan", ["head", "amount", "when", "details", "outcome"]],
  ] as const)("%s: Tipo · Nombre → Cuánto → Cuándo (→ Detalles) → readback", (kind, sections) => {
    const bridge = createFakeBridge(docWith([NU]));
    openEditor({ bridge, draft: bridge.createDraftItem(kind) });
    expect(sectionsInDom()).toEqual(sections);
    expect(sectionLabels("head")).toEqual(["Tipo", "Nombre"]);
    expect(field<HTMLSelectElement>("Tipo").value).toBe(kind);
    // "Cuándo" always starts with "Se repite" and the first date.
    expect(sectionLabels("when")[0]).toBe("Se repite");
    const titles = [...document.querySelectorAll(".fin-editor__section-title")].map((el) => el.textContent);
    expect(titles[0]).toBe("Cuánto");
    expect(titles[1]).toBe("Cuándo");
  });

  it("'Termina' is in the same place, with the same word, for every repeating kind", () => {
    for (const kind of ["income", "expense", "loan", "credit-card", "card-purchase", "installment-plan"] as const) {
      const bridge = createFakeBridge(docWith([NU]));
      openEditor({ bridge, draft: bridge.createDraftItem(kind) });
      // A single occurrence (a new expense / purchase) has no end: repeat it.
      if (preset("Una vez")?.getAttribute("aria-checked") === "true") click(preset("Cada mes"));
      const when = sectionLabels("when");
      expect(when[when.length - 1], kind).toBe("Termina");
      act(() => root?.unmount());
      document.body.innerHTML = "";
    }
  });

  it("a card and an MSI say 'Se repite: Cada mes'; an MSI's Termina is its last installment", () => {
    const bridge = createFakeBridge(docWith([NU]));
    openEditor({ bridge, draft: bridge.createDraftItem("installment-plan") });
    const reading = () =>
      [...document.querySelectorAll(".fin-editor__section--when .fin-editor__reading .fin-editor__computed-value")].map(
        (el) => el.textContent,
      );
    expect(reading()[0]).toBe("Cada mes");
    typeInto(field("Monto de la compra"), "12,000");
    typeInto(field("Meses"), "12");
    expect(reading()[1]).toBe("Con el abono 12 de 12, el jue 21 oct 2027");
  });

  it("switching Tipo rebuilds the sections of the new kind, the head stays", () => {
    const bridge = createFakeBridge(docWith([NU]));
    openEditor({ bridge, draft: bridge.createDraftItem("expense") });
    const name = field("Nombre");
    choose(field<HTMLSelectElement>("Tipo"), "loan");
    expect(field("Nombre")).toBe(name);
    expect(sectionLabels("amount")).toEqual(["¿Cuánto debes hoy?", "¿Cuánto pagas?"]);
    expect(sectionLabels("details")[0]).toBe("Tasa anual");
  });
});
