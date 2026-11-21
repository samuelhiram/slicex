// Debt payoff strategy (avalanche: highest rate first).
import { getProjectionRange } from "./events";
import { monthlyInstallment } from "./items";
import { positiveMoney, roundMoney } from "./money";
import { installmentOpeningDebt, loanOpeningDebt } from "./projection";
import type { AvalancheAllocation, AvalanchePlan, DebtRankEntry, FinancialDocument } from "./types";

function rate(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Enabled cards, loans and installment plans with balance > 0, ordered
 * annualRate desc, then balance asc, then name (plain string order,
 * locale-independent).
 *
 * Cards in "statement" payment mode are NOT ranked: they are paid in full
 * every month and never accrue interest, so they are no avalanche target
 * (an extra payment saves nothing). The cash they still need is
 * `statementCardCommitments`, to pass to `suggestAvalanchePayments` as
 * `committedPayments`.
 *
 * Balances: from `balances` when given — typically
 * `debtByAccountAt(projection, date)`, so the ranking matches the date the
 * available cash is read at (paid-off debts drop out, card debt that comes
 * only from purchases / interest counts; a missing id counts as 0; accounts
 * without a card / loan / plan item of their own are ignored). Without
 * `balances`: the opening balances at the document start (a future MSI
 * purchase is not owed yet).
 */
export function rankDebtsByAvalanche(
  doc: FinancialDocument,
  balances?: ReadonlyMap<string, number>,
): DebtRankEntry[] {
  // Only the opening balances need the projection range (loans without a balance).
  const openingRange = balances ? null : getProjectionRange(doc);
  const debts: DebtRankEntry[] = [];
  for (const item of doc.items) {
    if (item.enabled === false) continue;
    let entry: DebtRankEntry | null = null;
    switch (item.kind) {
      case "credit-card":
        if (item.paymentMode === "statement") break;
        entry = {
          id: item.id,
          name: item.name,
          kind: "credit-card",
          annualRate: rate(item.annualRate),
          balance: balances ? positiveMoney(balances.get(item.id)) : positiveMoney(item.balance),
          minimumPayment: positiveMoney(item.minimumPayment),
        };
        break;
      case "loan":
        entry = {
          id: item.id,
          name: item.name,
          kind: "loan",
          annualRate: rate(item.annualRate),
          balance: openingRange ? loanOpeningDebt(item, openingRange) : positiveMoney(balances?.get(item.id)),
          minimumPayment: positiveMoney(item.paymentAmount),
        };
        break;
      case "installment-plan":
        entry = {
          id: item.id,
          name: item.name,
          kind: "installment-plan",
          annualRate: 0,
          balance: balances
            ? positiveMoney(balances.get(item.id))
            : installmentOpeningDebt(item, doc.startDate),
          minimumPayment: monthlyInstallment(item),
        };
        break;
      default:
        break;
    }
    if (entry && entry.balance > 0) debts.push(entry);
  }
  debts.sort((a, b) => {
    if (a.annualRate !== b.annualRate) return b.annualRate - a.annualRate;
    if (a.balance !== b.balance) return a.balance - b.balance;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return debts;
}

/**
 * Cash the enabled "statement"-mode cards will take to pay the debt they
 * already carry: the sum of their balances — from `balances` when given
 * (same map as `rankDebtsByAvalanche`; a missing id counts as 0), else the
 * opening balances. Pass it to `suggestAvalanchePayments` as
 * `committedPayments` so `availableForExtra` does not count that cash.
 *
 * Choice: the WHOLE balance, not only the next statement. A statement card
 * pays every peso it owes from cash, in full, at the next due date (debt
 * from before the last cut) or the following one (debt from after it), and
 * prepaying it saves no interest; so all of it is the card's "minimum" in
 * the sense `suggestAvalanchePayments` gives minimums (cash set aside, capped
 * at the balance). Between a due date and the next cut this IS the next
 * statement (future purchases aside); between a cut and its due date it also
 * covers the post-cut purchases due a month later — conservative: it never
 * overstates the cash left for extra payments. Needs no projection and no
 * cut / due arithmetic. O(items).
 */
export function statementCardCommitments(doc: FinancialDocument, balances?: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const item of doc.items) {
    if (item.enabled === false || item.kind !== "credit-card" || item.paymentMode !== "statement") continue;
    total = roundMoney(total + (balances ? positiveMoney(balances.get(item.id)) : positiveMoney(item.balance)));
  }
  return total;
}

/**
 * Pays every minimum (capped at the balance), keeps the reserve, and pours
 * the rest into the debts in the given order up to each remaining balance.
 *
 * `committedPayments` (optional, default 0; non-positive / non-finite → 0):
 * cash already promised to obligations outside `debts` — typically
 * `statementCardCommitments` for the "statement" cards that
 * `rankDebtsByAvalanche` leaves out. It is set aside exactly like the
 * minimums: availableForExtra = max(0, availableCash − minimumCashReserve −
 * Σ minimums − committedPayments). It gets no allocation.
 */
export function suggestAvalanchePayments(input: {
  debts: DebtRankEntry[];
  availableCash: number;
  minimumCashReserve: number;
  committedPayments?: number;
}): AvalanchePlan {
  const minimums = input.debts.map((d) =>
    roundMoney(Math.min(positiveMoney(d.minimumPayment), positiveMoney(d.balance))),
  );
  let sumMinimums = 0;
  for (const m of minimums) sumMinimums = roundMoney(sumMinimums + m);
  // 0 when absent: x − 0 === x, so plans without commitments are unchanged.
  const committed = positiveMoney(input.committedPayments);
  const availableForExtra = roundMoney(
    Math.max(0, roundMoney(input.availableCash) - roundMoney(input.minimumCashReserve) - sumMinimums - committed),
  );
  let left = availableForExtra;
  const allocations: AvalancheAllocation[] = input.debts.map((debt, i) => {
    const minimum = minimums[i]!;
    const room = Math.max(0, roundMoney(positiveMoney(debt.balance) - minimum));
    const extra = roundMoney(Math.min(room, left));
    left = roundMoney(left - extra);
    return { id: debt.id, name: debt.name, minimum, extra, total: roundMoney(minimum + extra) };
  });
  return { availableForExtra, allocations };
}
