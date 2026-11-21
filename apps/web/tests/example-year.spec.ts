// "El año de ejemplo" (createExampleYearDocument): what a first visit and
// "Reiniciar con el ejemplo…" open. Every kind of object, each with an icon
// of the catalog; valid for the editor's schema; cash positive all year
// with a valley under the reserve to fix.
import { describe, expect, it } from "vitest";
import {
  createExampleYearDocument,
  findLiquidityWarnings,
  projectFinancialDocument,
  summarizeProjection,
} from "@slicex/core";
import { FinancialItemSchemaStrict } from "@slicex/contracts";
import { bootstrapPlan } from "../src/finance/bootstrap";
import { iconDef } from "../src/finance/icons";

const TODAY = "2026-11-20";

describe("el año de ejemplo", () => {
  it("is what a first visit opens", () => {
    const boot = bootstrapPlan(TODAY, null);
    expect(boot.firstVisit).toBe(true);
    expect(boot.doc).toEqual(createExampleYearDocument(TODAY));
  });

  it("has every kind of object, each valid and with a known icon", () => {
    const doc = createExampleYearDocument(TODAY);
    const kinds = new Set(doc.items.map((item) => item.kind));
    for (const kind of ["income", "expense", "loan", "credit-card", "installment-plan"]) {
      expect(kinds.has(kind as never)).toBe(true);
    }
    expect(new Set(doc.items.map((item) => item.id)).size).toBe(doc.items.length);
    for (const item of doc.items) {
      expect(FinancialItemSchemaStrict.safeParse(item).success).toBe(true);
      expect(iconDef(item.icon)).not.toBeNull();
    }
  });

  it("keeps cash positive all year, with a valley under the reserve", () => {
    const doc = createExampleYearDocument(TODAY);
    const projection = projectFinancialDocument(doc);
    const summary = summarizeProjection(projection);
    expect(summary.minimumCash).toBeGreaterThan(0);
    expect(summary.finalCash).toBeGreaterThan(doc.initialCash);
    expect(findLiquidityWarnings(projection, doc.minimumCashReserve).length).toBeGreaterThan(0);
  });
});
