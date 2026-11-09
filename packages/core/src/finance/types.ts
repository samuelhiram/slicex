// Financial domain model — pure data, no IO, no React/Pixi/DOM.
//
// Conventions (whole module):
// - Dates are ISO calendar dates "YYYY-MM-DD" (no time, no timezone). All
//   arithmetic is done on UTC day numbers, so DST never shifts a date.
// - Amounts on items are POSITIVE magnitudes. The item kind / event type
//   decides the sign of the cash effect.
// - Money is rounded to cents after every arithmetic step.
// - `annualRate` is a PERCENTAGE (99.9 means 99.9 %/year).

export type ISODate = string;

export type RecurrenceFrequency =
  | "once"
  | "weekly"
  | "biweekly"
  // "Quincenal" (MX payroll): the 15th and the last day of every month.
  | "semimonthly"
  | "monthly";

export interface FinancialRecurrence {
  frequency: RecurrenceFrequency;
  /** Window start (inclusive). No occurrence happens before this date. */
  startDate: ISODate;
  /**
   * Window end (inclusive). `undefined` = indefinite: the schedule runs to
   * the projection horizon.
   */
  endDate?: ISODate;
  /**
   * Phase anchor of the schedule. Defaults to `startDate`.
   * - once:        the single occurrence date (still clipped by the window).
   * - weekly:      anchor + k*7 days, k any integer (anchor may be in the past).
   * - biweekly:    anchor + k*14 days.
   * - monthly:     the anchor's day-of-month every month, clamped to the
   *                month length (31 → 30/28) without drifting (Mar 31 again).
   * - semimonthly: ignored — always the 15th and the last day of the month.
   * Moving an item shifts anchor + window together; cropping the window
   * (resizing an edge) leaves the anchor alone so paydays don't move.
   */
  anchorDate?: ISODate;
}

export type FinancialItemKind =
  | "income"
  | "expense"
  | "loan"
  | "credit-card"
  | "card-purchase"
  | "installment-plan";

export interface FinancialItemBase {
  id: string;
  kind: FinancialItemKind;
  name: string;
  /** `false` excludes the item from the projection (muted). Default true. */
  enabled?: boolean;
  /** Optional UI colour override (hex). The engine ignores it. */
  color?: string;
  recurrence: FinancialRecurrence;
}

/** Adds `amount` to cash on every occurrence. */
export interface IncomeItem extends FinancialItemBase {
  kind: "income";
  amount: number;
}

/** Subtracts `amount` from cash on every occurrence. */
export interface ExpenseItem extends FinancialItemBase {
  kind: "expense";
  amount: number;
}

/**
 * Pays `paymentAmount` from cash on every occurrence.
 * Debt tracked for the loan: `balance` when given; otherwise, when the
 * recurrence has an `endDate`, the sum of every scheduled payment from the
 * document start to `endDate` (NOT capped at the projection horizon, so a
 * loan longer than the horizon keeps its remainder in `finalDebt`; counted
 * arithmetically, never by expanding the schedule); otherwise 0 (unknown).
 * The debt is on the books from the document start (`startDate` is the first
 * payment, not the origination). Each payment reduces the loan debt (never
 * below 0). `annualRate` is informative (avalanche ranking); the MVP does not
 * accrue loan interest.
 */
export interface LoanItem extends FinancialItemBase {
  kind: "loan";
  paymentAmount: number;
  balance?: number;
  annualRate?: number;
}

/**
 * How a revolving card is paid (see CreditCardItem):
 * - "fixed": a planned amount every due date; interest on the carried debt.
 * - "statement" ("pago para no generar intereses", being "totalero"): every
 *   due date pays exactly the statement — the debt at the last cut — so the
 *   card never accrues interest.
 */
export type CreditCardPaymentMode = "fixed" | "statement";

/**
 * Revolving credit card.
 * - `balance`: debt at the document start date.
 * - `cutDay` / `dueDay`: day of month of the cut and of the payment, clamped
 *   to the month length (31 → 30/28, no drift).
 * - `recurrence`: only its window matters (when the payments happen);
 *   `recurrence.frequency` is ignored.
 *
 * `paymentMode` "fixed" (default, also when undefined):
 * - Payments: every month on `dueDay` inside the recurrence window; planned
 *   amount = `paymentAmount ?? minimumPayment`, capped at the outstanding card
 *   debt.
 * - Interest (ESTIMATE, average daily balance): every month on `cutDay`, over
 *   the whole projection range, the card is charged
 *   Σ debt_i × (annualRate / 100 / 360) × days_i
 *   over the stretches since the previous cut (the first cycle counts from
 *   the projection start) during which the debt stayed at debt_i. A purchase
 *   one day before the cut costs one day of interest; a payment one day
 *   before the cut removes one day. Posted (rounded to cents) to the card
 *   debt, no cash effect.
 *
 * `paymentMode` "statement" (pay the statement in full, never any interest):
 * - The pending statement starts as the opening `balance`. At every cut
 *   (every month on `cutDay`, over the whole projection range), AFTER that
 *   day's other events — a purchase dated on the cut day belongs to that
 *   statement; a payment due that same day pays the previous one — the
 *   statement becomes the card's whole current debt (an unpaid previous
 *   statement included).
 * - Payments: every month on `dueDay` inside the recurrence window, the card
 *   pays min(statement, debt) and the statement drops to 0. A purchase one
 *   day before the cut is paid on the next due date; one day after the cut,
 *   a month later (`statementDueDate`).
 * - No interest is ever charged; `annualRate`, `minimumPayment` and
 *   `paymentAmount` are kept but ignored by the projection and the payoff
 *   estimate.
 *
 * Either way, card purchases add to the card debt and MSI plans on the card
 * are their own accounts (paid on the card's `dueDay`).
 */
export interface CreditCardItem extends FinancialItemBase {
  kind: "credit-card";
  balance: number;
  annualRate: number;
  cutDay: number;
  dueDay: number;
  minimumPayment: number;
  paymentAmount?: number;
  /** Default "fixed" (undefined). See the interface doc. */
  paymentMode?: CreditCardPaymentMode;
}

/** A purchase charged to card `cardId`: adds `amount` to that card's debt, no cash effect. */
export interface CardPurchaseItem extends FinancialItemBase {
  kind: "card-purchase";
  cardId: string;
  amount: number;
}

/**
 * MSI — meses sin intereses. Zero interest, differentiated from revolving
 * debt. Monthly installment = originalAmount / installmentsTotal rounded to
 * cents; the LAST installment (number `installmentsTotal`) absorbs the cent
 * remainder, so the installments add up exactly to `originalAmount`.
 * Remaining debt = originalAmount − installment × installmentsPaid (0 when no
 * installment remains).
 * `installmentsPaid` is counted at the document start. A plan with
 * `installmentsPaid === 0` whose `recurrence.startDate` is after the document
 * start is a FUTURE purchase: its debt is 0 until `startDate`, where a no-cash
 * "debt-opening" event books it. Any other plan carries its remaining debt
 * from the document start.
 * Payments: monthly, on the card's `dueDay` when `cardId` points to a card in
 * the document, otherwise on the recurrence anchor's day-of-month; only
 * inside the window, from max(startDate, document start), and at most the
 * number of remaining installments.
 */
export interface InstallmentPlanItem extends FinancialItemBase {
  kind: "installment-plan";
  cardId?: string;
  originalAmount: number;
  installmentsTotal: number;
  installmentsPaid: number;
}

export type FinancialItem =
  | IncomeItem
  | ExpenseItem
  | LoanItem
  | CreditCardItem
  | CardPurchaseItem
  | InstallmentPlanItem;

export interface FinancialDocument {
  id: string;
  name: string;
  /** t0: the date `initialCash` is measured. Projection starts here (inclusive). */
  startDate: ISODate;
  initialCash: number;
  minimumCashReserve: number;
  /** Projection length; range is [startDate, addMonths(startDate, horizonMonths)]. */
  horizonMonths: number;
  items: FinancialItem[];
}

export type FinancialEventType =
  | "income"
  | "expense"
  | "loan-payment"
  | "credit-card-payment"
  | "credit-card-purchase"
  | "credit-card-interest"
  | "installment-payment"
  /**
   * No-cash opening of a debt account on the account's start date (a future
   * MSI purchase): adds `amount` to account `accountId`, like a card purchase.
   */
  | "debt-opening";

/** One dated occurrence of an item, produced by `expandFinancialEvents`. */
export interface FinancialEvent {
  /** `${itemId}@${date}`, plus `#n` when one item emits several events that day. */
  id: string;
  itemId: string;
  type: FinancialEventType;
  date: ISODate;
  /**
   * Positive planned magnitude. Interest events and the payments of a card in
   * "statement" mode carry 0 (computed by the projection).
   */
  amount: number;
  name: string;
  /** Debt account touched (card / loan / installment-plan id). */
  accountId?: string;
}

export interface FinancialProjectionPoint {
  eventId: string;
  itemId: string;
  type: FinancialEventType;
  name: string;
  date: ISODate;
  cashBefore: number;
  cashAfter: number;
  /** Signed effect on cash (cashAfter − cashBefore). */
  cashDelta: number;
  /** Signed effect on total debt. */
  debtDelta: number;
  /** Total debt (all accounts, each floored at 0) after this event. */
  debtAfter: number;
  /** Debt account the event touched (card / loan / installment-plan id). */
  accountId?: string;
  /** Debt of account `accountId` after this event (≥ 0). Set whenever `accountId` is set. */
  accountDebtAfter?: number;
  /** True for values that are estimates (card interest). */
  estimated?: boolean;
}

/** A debt account tracked by the projection. */
export interface ProjectionAccount {
  id: string;
  name: string;
  kind: "credit-card" | "loan" | "installment-plan";
  /** Debt at the projection start (≥ 0). */
  openingDebt: number;
  annualRate: number;
  /**
   * Credit cards in "statement" payment mode only (absent otherwise): the
   * card's cut day of month (1..31). The projection then closes a statement
   * at every cut (cutDay clamped to the month length, after that day's
   * events), pays the pending statement on every "credit-card-payment" event
   * of the account (the event amount is ignored) and charges no interest
   * (`annualRate` stays informative). See CreditCardItem.
   */
  statementCutDay?: number;
}

export interface FinancialProjection {
  startDate: ISODate;
  endDate: ISODate;
  initialCash: number;
  initialDebt: number;
  /**
   * Accounts the projection ran with (input order, duplicate ids merged),
   * followed by the accounts created on the fly (purchases on an unknown card
   * id: kind "credit-card", rate 0, opening 0).
   */
  accounts: ProjectionAccount[];
  /** Chronological. Events whose applied amount is 0 produce no point. */
  points: FinancialProjectionPoint[];
  finalCash: number;
  finalDebt: number;
  /** Lowest cash over the range (initialCash at startDate when nothing dips lower). */
  minimumCash: { date: ISODate; cash: number };
}

// ---------------------------------------------------------------------------
// Query / strategy / scenario result shapes (implemented in queries.ts,
// strategy.ts, scenario.ts).

/** Cash and total debt at the END of `date` (after that day's events). */
export interface FinancialSnapshot {
  date: ISODate;
  cash: number;
  debt: number;
}

/** One contiguous episode where cash stays below the reserve. */
export interface LiquidityWarning {
  /** Date of the lowest cash inside the episode. */
  date: ISODate;
  /** Lowest cash inside the episode. */
  cash: number;
  /** First date the cash dropped below the reserve. */
  startDate: ISODate;
  /** The point that hit the episode minimum. */
  eventId: string;
  itemId: string;
  name: string;
  severity: "below-reserve" | "negative";
}

/** Next cash outflow. `amount` is a positive magnitude. */
export interface UpcomingPayment {
  date: ISODate;
  itemId: string;
  name: string;
  amount: number;
  type: FinancialEventType;
}

export interface DebtRankEntry {
  id: string;
  name: string;
  kind: "credit-card" | "loan" | "installment-plan";
  annualRate: number;
  balance: number;
  minimumPayment: number;
}

export interface AvalancheAllocation {
  id: string;
  name: string;
  minimum: number;
  extra: number;
  total: number;
}

export interface AvalanchePlan {
  /** Cash available after keeping the reserve and paying every minimum (≥ 0). */
  availableForExtra: number;
  /** Same order as the ranked debts. */
  allocations: AvalancheAllocation[];
}

export interface ProjectionSummary {
  finalCash: number;
  finalDebt: number;
  minimumCash: number;
  minimumCashDate: ISODate;
}

export interface ProjectionComparison {
  base: ProjectionSummary;
  scenario: ProjectionSummary;
  /** scenario − base */
  finalCashDelta: number;
  finalDebtDelta: number;
  minimumCashDelta: number;
}

// ---------------------------------------------------------------------------
// Payoff estimates and per-account activity (implemented in payoff.ts and
// queries.ts).

export interface DebtPayoffOptions {
  /** Simulation window in months from `doc.startDate` (default 360). */
  maxMonths?: number;
}

/** When a debt account is paid off, simulating only that account's own events. */
export interface DebtPayoffEstimate {
  accountId: string;
  name: string;
  kind: "credit-card" | "loan" | "installment-plan";
  /**
   * Date of the payment that clears the account for good (see
   * `estimateDebtPayoffs`); `doc.startDate` when nothing is owed from the
   * start; null = still owing after `maxMonths`.
   */
  payoffDate: ISODate | null;
  /** Interest accrued from `doc.startDate` to the payoff (or to the end of the cap date). */
  totalInterest: number;
  /** Payments applied to the debt up to the payoff (or the cap), interest included. */
  totalPaid: number;
  /** Debt at the payoff (0) or at the end of the cap date (accrued interest included). */
  finalDebt: number;
}

/** Account movements over a date range, as positive magnitudes. */
export interface AccountActivity {
  /** Card interest posted to the account. */
  interest: number;
  /** Cash paid to the account (card / loan / MSI payments). */
  payments: number;
  /** Purchases charged and debts opened on the account. */
  charges: number;
}
