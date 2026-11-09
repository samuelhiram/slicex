// How a session starts: the saved plan rolled forward to today ("Rec"
// assumes everything happened as planned until the person says otherwise),
// or — on a first visit — the example year plus the onboarding banner.
// Pure apart from the bridge calls in applyRecCorrections.
import {
  createDemoFinancialDocument,
  rollForward,
  type ActualRecord,
  type FinancialDocument,
  type FinancialItem,
  type FinancialProjectionPoint,
  type ISODate,
  type LedgerEntry,
} from "@slicex/core";
import type { FinancialBridgeApi } from "./bridge-api";
import type { FinancialTrackLayout } from "./mapping";
import type { SavedPlan } from "./persistence";

export interface RecState {
  /** Day the plan was saved on (its old start). */
  since: ISODate;
  /** The plan as saved (before rolling forward). */
  original: FinancialDocument;
  /** Past events the person may correct. */
  pending: FinancialProjectionPoint[];
  /** Ledger as rolled (everything "planned"). */
  ledger: LedgerEntry[];
}

export interface PlanBootstrap {
  doc: FinancialDocument;
  /** The active future's rows and placements (null: default layout). */
  layout: FinancialTrackLayout | null;
  /** The saved plan with every future rolled to today (null on a first visit). */
  saved: SavedPlan | null;
  rec: RecState | null;
  firstVisit: boolean;
}

export function bootstrapPlan(today: ISODate, saved: SavedPlan | null): PlanBootstrap {
  if (!saved) {
    return {
      doc: createDemoFinancialDocument(today),
      layout: null,
      saved: null,
      rec: null,
      firstVisit: true,
    };
  }
  const active = saved.branches.find((branch) => branch.id === saved.activeId) ?? saved.branches[0]!;
  let rec: RecState | null = null;
  const branches = saved.branches.map((branch) => {
    if (branch.doc.startDate >= today) return branch;
    const rolled = rollForward(branch.doc, today);
    if (branch.id === active.id) {
      rec = {
        since: branch.doc.startDate,
        original: branch.doc,
        pending: rolled.pending,
        ledger: rolled.ledger,
      };
    }
    return { ...branch, doc: rolled.doc };
  });
  const doc = branches.find((branch) => branch.id === active.id)!.doc;
  const ledger = rec ? [...saved.ledger, ...(rec as RecState).ledger] : saved.ledger;
  return {
    doc,
    layout: active.layout ?? null,
    saved: { ...saved, activeId: active.id, branches, ledger },
    rec,
    firstVisit: false,
  };
}

function balanceOf(item: FinancialItem): number | null {
  if (item.kind === "credit-card") return item.balance;
  if (item.kind === "loan" && item.balance !== undefined) return item.balance;
  return null;
}

/**
 * Applies the person's corrections ("no pasó", "otro monto", real balance)
 * to the CURRENT plan as deltas against what was assumed at load, so edits
 * made since are kept. Returns the corrected ledger entries.
 */
export function applyRecCorrections(
  bridge: FinancialBridgeApi,
  rec: RecState,
  today: ISODate,
  actuals: ActualRecord[],
  cashOverride: number | undefined,
): LedgerEntry[] {
  const assumed = rollForward(rec.original, today);
  const corrected = rollForward(rec.original, today, { actuals, cashOverride });

  const cashDelta = corrected.doc.initialCash - assumed.doc.initialCash;
  if (Math.abs(cashDelta) > 0.004) {
    const current = bridge.getDocument().initialCash;
    bridge.setInitialCash(Math.round((current + cashDelta) * 100) / 100);
  }

  const assumedById = new Map<string, FinancialItem>();
  for (const item of assumed.doc.items) assumedById.set(item.id, item);
  for (const item of corrected.doc.items) {
    const before = assumedById.get(item.id);
    const current = bridge.getItem(item.id);
    if (!before || !current) continue;
    const correctedBalance = balanceOf(item);
    const assumedBalance = balanceOf(before);
    const currentBalance = balanceOf(current);
    if (correctedBalance !== null && assumedBalance !== null && currentBalance !== null) {
      const delta = correctedBalance - assumedBalance;
      if (Math.abs(delta) > 0.004) {
        bridge.replaceItem({
          ...current,
          balance: Math.max(0, Math.round((currentBalance + delta) * 100) / 100),
        } as FinancialItem);
      }
    }
    if (
      item.kind === "installment-plan" &&
      before.kind === "installment-plan" &&
      current.kind === "installment-plan" &&
      item.installmentsPaid !== before.installmentsPaid
    ) {
      bridge.replaceItem({
        ...current,
        installmentsPaid: Math.max(
          0,
          current.installmentsPaid + item.installmentsPaid - before.installmentsPaid,
        ),
      });
    }
  }
  return corrected.ledger;
}
