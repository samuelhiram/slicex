// Local persistence of the plan (every future + the ledger of what really
// happened) in the browser's localStorage. Server persistence (the dormant
// @slicex/db / /api/timelines scaffolding) is a later step; this keeps a
// person's year across reloads today.
//
// Never throws: a blocked / full / corrupted storage just means "no save".
import type { FinancialDocument, ISODate, LedgerEntry } from "@slicex/core";
import { parseTrackLayout, type FinancialTrackLayout } from "./mapping";

export const PLAN_STORAGE_KEY = "slicex.plan.v1";

export interface SavedBranch {
  id: string;
  name: string;
  /** Day the future forked from its parent (null for the main plan). */
  forkDate: ISODate | null;
  doc: FinancialDocument;
  /** The playlist rows of this future (empty ones too) and who sits where. */
  layout?: FinancialTrackLayout | null;
}

export interface SavedPlan {
  v: 1;
  activeId: string;
  /** Branch drawn as a ghost under the active one (null = none). */
  compareId: string | null;
  branches: SavedBranch[];
  /** What really happened, as recorded by "Rec" (oldest first). */
  ledger: LedgerEntry[];
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isDocument(value: unknown): value is FinancialDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<FinancialDocument>;
  return (
    typeof doc.startDate === "string" &&
    typeof doc.initialCash === "number" &&
    typeof doc.minimumCashReserve === "number" &&
    typeof doc.horizonMonths === "number" &&
    Array.isArray(doc.items)
  );
}

export function parsePlan(raw: string | null): SavedPlan | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedPlan>;
    if (value.v !== 1 || !Array.isArray(value.branches) || value.branches.length === 0) {
      return null;
    }
    const branches = value.branches.filter(
      (branch): branch is SavedBranch =>
        !!branch &&
        typeof branch.id === "string" &&
        typeof branch.name === "string" &&
        isDocument(branch.doc),
    );
    if (branches.length === 0) return null;
    const activeId = branches.some((branch) => branch.id === value.activeId)
      ? (value.activeId as string)
      : branches[0]!.id;
    const compareId =
      typeof value.compareId === "string" &&
      value.compareId !== activeId &&
      branches.some((branch) => branch.id === value.compareId)
        ? value.compareId
        : null;
    return {
      v: 1,
      activeId,
      compareId,
      branches: branches.map((branch) => {
        const { layout: rawLayout, ...rest } = branch;
        const layout = parseTrackLayout(rawLayout);
        return {
          ...rest,
          forkDate: typeof branch.forkDate === "string" ? branch.forkDate : null,
          ...(layout ? { layout } : {}),
        };
      }),
      ledger: Array.isArray(value.ledger) ? value.ledger : [],
    };
  } catch {
    return null;
  }
}

export function loadPlan(): SavedPlan | null {
  try {
    return parsePlan(storage()?.getItem(PLAN_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function savePlan(plan: SavedPlan): boolean {
  try {
    storage()?.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan));
    return true;
  } catch {
    return false;
  }
}

export function clearPlan(): void {
  try {
    storage()?.removeItem(PLAN_STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}
