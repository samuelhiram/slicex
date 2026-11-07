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
 * Pays every minimum (capped at the balance), keeps the reserve, and pours
 * the rest into the debts in the given order up to each remaining balance.
 */
export function suggestAvalanchePayments(input: {
  debts: DebtRankEntry[];
  availableCash: number;
  minimumCashReserve: number;
}): AvalanchePlan {
  const minimums = input.debts.map((d) =>
    roundMoney(Math.min(positiveMoney(d.minimumPayment), positiveMoney(d.balance))),
  );
  let sumMinimums = 0;
  for (const m of minimums) sumMinimums = roundMoney(sumMinimums + m);
  const availableForExtra = roundMoney(
    Math.max(0, roundMoney(input.availableCash) - roundMoney(input.minimumCashReserve) - sumMinimums),
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
