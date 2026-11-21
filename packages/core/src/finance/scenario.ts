// Scenario helpers: clone a document, summarise and compare projections.
import { roundMoney } from "./money";
import type {
  FinancialDocument,
  FinancialProjection,
  ProjectionComparison,
  ProjectionSummary,
} from "./types";

function clonePlain<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = clonePlain(value[i]);
    return out as T;
  }
  const out: Record<string, unknown> = {};
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    const v = source[key];
    if (v !== undefined && typeof v !== "function") out[key] = clonePlain(v);
  }
  return out as T;
}

/** Deep, JSON-safe copy (undefined / function fields dropped) with optional id / name overrides. */
export function cloneFinancialDocument(
  doc: FinancialDocument,
  overrides?: { id?: string; name?: string },
): FinancialDocument {
  const copy = clonePlain(doc);
  if (overrides?.id !== undefined) copy.id = overrides.id;
  if (overrides?.name !== undefined) copy.name = overrides.name;
  return copy;
}

export function summarizeProjection(projection: FinancialProjection): ProjectionSummary {
  return {
    finalCash: projection.finalCash,
    finalDebt: projection.finalDebt,
    minimumCash: projection.minimumCash.cash,
    minimumCashDate: projection.minimumCash.date,
  };
}

/** Deltas are scenario − base. */
export function compareProjections(
  base: FinancialProjection,
  scenario: FinancialProjection,
): ProjectionComparison {
  const b = summarizeProjection(base);
  const s = summarizeProjection(scenario);
  return {
    base: b,
    scenario: s,
    finalCashDelta: roundMoney(s.finalCash - b.finalCash),
    finalDebtDelta: roundMoney(s.finalDebt - b.finalDebt),
    minimumCashDelta: roundMoney(s.minimumCash - b.minimumCash),
  };
}
