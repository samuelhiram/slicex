// Public API of the financial engine (pure TS: no IO, no DOM, no clock).
export * from "./types";
export {
  addDays,
  addMonths,
  clampedDayOfMonth,
  compareISODate,
  daysInMonth,
  diffDays,
  fromDayNumber,
  isISODate,
  toDayNumber,
} from "./dates";
export { expandRecurrence } from "./recurrence";
export { expandFinancialEvents, getProjectionRange } from "./events";
export {
  buildProjectionAccounts,
  projectFinancialDocument,
  projectFinancialTimeline,
} from "./projection";
export {
  accountActivity,
  annualItemImpact,
  debtByAccountAt,
  findLiquidityWarnings,
  nextPayment,
  snapshotAt,
} from "./queries";
export { estimateDebtPayoffs } from "./payoff";
export { rankDebtsByAvalanche, suggestAvalanchePayments } from "./strategy";
export { cloneFinancialDocument, compareProjections, summarizeProjection } from "./scenario";
export {
  createDefaultFinancialItem,
  itemCashDirection,
  monthlyInstallment,
  remainingInstallmentDebt,
} from "./items";
export { createDemoFinancialDocument } from "./demo";
