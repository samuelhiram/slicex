// The item editor's ONE form (item-form-spec.ts): the same skeleton for every
// kind, and the error summary reading the fields in the order they show.
import { describe, expect, it } from "vitest";
import { createDefaultFinancialItem, type FinancialItem, type FinancialItemKind } from "@slicex/core";
import {
  FORM_PATH_ORDER,
  FORM_SECTIONS,
  ITEM_FORM_SPEC,
  formPathOrder,
  sectionFields,
} from "../src/finance/item-form-spec";
import { firstErrorPath, firstFieldError, itemFormErrors } from "../src/finance/item-schema";
import { blankDraft } from "../src/finance/components/FinancialEditorModal";
import { KIND_ORDER } from "../src/finance/labels";

const START = "2026-11-11";

function draftOf(kind: FinancialItemKind): FinancialItem {
  return createDefaultFinancialItem(kind, `draft-${kind}`, START);
}

describe("item-form-spec: one skeleton for the six kinds", () => {
  it("the sections are Tipo · Nombre → Cuánto → Cuándo → Detalles, in that order", () => {
    expect(FORM_SECTIONS.map((section) => section.title)).toEqual([null, "Cuánto", "Cuándo", "Detalles"]);
  });

  it.each(KIND_ORDER)("%s: the head is Tipo · Nombre", (kind) => {
    expect(sectionFields(draftOf(kind), "head").map((field) => field.control)).toEqual(["kind", "text"]);
  });

  it.each(KIND_ORDER)("%s: 'Cuándo' is Se repite → first date → … → Termina, always last", (kind) => {
    const when = ITEM_FORM_SPEC[kind].when.map((field) => field.control);
    expect(when[0]).toBe("repeat");
    expect(when[1]).toBe("start");
    expect(when[when.length - 1]).toBe("end");
    expect(when.filter((control) => control === "end")).toHaveLength(1);
  });

  it.each(KIND_ORDER)("%s: every amount lives in 'Cuánto' (none in the other sections)", (kind) => {
    const spec = ITEM_FORM_SPEC[kind];
    expect(spec.amount.length).toBeGreaterThan(0);
    for (const field of [...spec.when, ...spec.details]) expect(field.control).not.toBe("money");
  });

  it("a loan's payments left are its Termina (count); an MSI's is derived; the rest choose", () => {
    expect(ITEM_FORM_SPEC.loan.end).toBe("count");
    expect(ITEM_FORM_SPEC["installment-plan"].end).toBe("derived");
    for (const kind of ["income", "expense", "card-purchase", "credit-card"] as const) {
      expect(ITEM_FORM_SPEC[kind].end).toBe("choice");
    }
  });

  it("a single occurrence has no Termina; a card's monthly payment hides for a totalero", () => {
    const once = { ...draftOf("expense"), recurrence: { frequency: "once", startDate: START, endDate: START } } as FinancialItem;
    expect(sectionFields(once, "when").map((field) => field.control)).not.toContain("end");
    const card = draftOf("credit-card");
    expect(sectionFields(card, "amount").map((field) => field.path)).toContain("paymentAmount");
    const totalero = { ...card, paymentMode: "statement" } as FinancialItem;
    expect(sectionFields(totalero, "amount").map((field) => field.path)).not.toContain("paymentAmount");
  });
});

describe("item-form-spec: the summary reads the form in its own order", () => {
  it.each(KIND_ORDER)("%s: every error of a blank form is a field of the spec", (kind) => {
    const blank = { ...blankDraft(draftOf(kind), []), name: "" } as FinancialItem;
    const order = formPathOrder(kind);
    for (const path of Object.keys(itemFormErrors(blank, []))) expect(order).toContain(path);
  });

  it("the first error named is the first wrong field on screen", () => {
    const loan = { ...blankDraft(draftOf("loan"), []), name: "" } as FinancialItem;
    const errors = itemFormErrors(loan, []);
    // Nombre (head) comes before ¿Cuánto pagas? (Cuánto) and Termina (Cuándo).
    expect(firstErrorPath(errors, "loan")).toBe("name");
    const named = { ...loan, name: "Auto" } as FinancialItem;
    expect(firstFieldError(itemFormErrors(named, []), named)).toBe("¿Cuánto pagas?: escribe cuánto pagas.");
    const paid = { ...named, paymentAmount: 1500 } as FinancialItem;
    expect(firstFieldError(itemFormErrors(paid, []), paid)).toBe("Termina: escribe cuántos pagos te faltan.");
  });

  it("without a kind, the shared order starts with Tipo · Nombre and keeps each path once", () => {
    expect(FORM_PATH_ORDER.slice(0, 2)).toEqual(["kind", "name"]);
    expect(new Set(FORM_PATH_ORDER).size).toBe(FORM_PATH_ORDER.length);
  });
});
