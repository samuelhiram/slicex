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
export { expandRecurrence, MAX_RECURRENCE_INTERVAL, recurrenceInterval } from "./recurrence";
export { MAX_MONEY } from "./money";
export { expandFinancialEvents, getProjectionRange } from "./events";
export {
  canChangeCadence,
  canEditOccurrences,
  clearOccurrenceEdit,
  editItemOccurrence,
  hasRuleEdits,
  isScheduledOn,
  itemRuleAmount,
  occurrenceAmount,
  occurrenceEditAmounts,
  removeRuleChange,
  ruleChangeStartingAt,
  ruleOccurrenceDates,
  ruleSegmentAt,
  ruleSegments,
  scheduledTotal,
  shiftItemRules,
  sortedRuleChanges,
  withAmountInForce,
  withoutRuleChangeAt,
  withRuleAmount,
} from "./rules";
export type { OccurrenceEditRequest, OccurrenceScope, RuleSegment } from "./rules";
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
export { cardCycleDates, nextCutDate, statementDueDate } from "./card-cycles";
export { rankDebtsByAvalanche, statementCardCommitments, suggestAvalanchePayments } from "./strategy";
export { cloneFinancialDocument, compareProjections, summarizeProjection } from "./scenario";
export {
  createDefaultFinancialItem,
  itemCashDirection,
  monthlyInstallment,
  remainingInstallmentDebt,
} from "./items";
export { createDemoFinancialDocument, createExampleYearDocument, createRememberedPlanDocument } from "./demo";
export { rollForward } from "./rollforward";
export { extendHistory, historyStart, openingCashAt, rebuildHistory } from "./history";
export type {
  ActualRecord,
  ActualStatus,
  LedgerEntry,
  RollForwardOptions,
  RollForwardResult,
} from "./rollforward";
export { suggestMexicanYear } from "./mx-year";
export type { YearSuggestion } from "./mx-year";
export { solveDebtPayment } from "./goalseek";
export { amortizedPayment, loanPaymentCount, periodsPerYear } from "./amortization";
export type { DebtPaymentSolution } from "./goalseek";
export { explainValley, suggestValleyFixes } from "./valley";
export {
  applyMovementEffect,
  compareMovementsNewestFirst,
  EMPTY_MOVEMENT_EFFECT,
  EXPENSE_CATEGORIES,
  filterMovements,
  INCOME_CATEGORIES,
  invertMovementEffect,
  isEmptyMovementEffect,
  movementChangeEffect,
  movementEffect,
  movementSearchText,
  normalizeSearchText,
  quickCategories,
  summarizeMovements,
  totalsByCategory,
  UNCATEGORIZED,
  usedCategories,
  withCardDebtDelta,
} from "./movements";
export type {
  CategoryTotal,
  Movement,
  MovementEffect,
  MovementFilter,
  MovementKind,
  MovementLike,
  MovementTotals,
} from "./movements";
export type { ValleyCause, ValleyExplanation, ValleyFix } from "./valley";
