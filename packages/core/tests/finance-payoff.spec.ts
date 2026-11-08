// estimateDebtPayoffs: per-account payoff simulation, cross-checked against
// the projection (same arithmetic) and against hand-computed schedules. The
// timing budget lives in finance-payoff-perf.spec.ts (own worker, clean heap).
import { describe, expect, it } from "vitest";
import {
  accountActivity,
  addDays,
  addMonths,
  createDemoFinancialDocument,
  debtByAccountAt,
  estimateDebtPayoffs,
  projectFinancialDocument,
} from "../src/finance";
import type {
  CardPurchaseItem,
  CreditCardItem,
  DebtPayoffEstimate,
  FinancialDocument,
  FinancialItem,
  FinancialProjection,
  InstallmentPlanItem,
  LoanItem,
} from "../src/finance";

const START = "2026-11-07";

function doc(items: FinancialItem[], over: Partial<FinancialDocument> = {}): FinancialDocument {
  return {
    id: "t",
    name: "t",
    startDate: START,
    initialCash: 0,
    minimumCashReserve: 0,
    horizonMonths: 12,
    items,
    ...over,
  };
}

function card(over: Partial<CreditCardItem> = {}): CreditCardItem {
  return {
    id: "card",
    kind: "credit-card",
    name: "Card",
    balance: 1000,
    annualRate: 0,
    cutDay: 15,
    dueDay: 26,
    minimumPayment: 0,
    paymentAmount: 3000,
    recurrence: { frequency: "monthly", startDate: START },
    ...over,
  };
}

function purchase(id: string, amount: number, recurrence: CardPurchaseItem["recurrence"], cardId = "card"): CardPurchaseItem {
  return { id, kind: "card-purchase", name: id, cardId, amount, recurrence };
}

function payoffOf(d: FinancialDocument, id: string, maxMonths?: number): DebtPayoffEstimate {
  const estimate = estimateDebtPayoffs(d, maxMonths === undefined ? undefined : { maxMonths }).get(id);
  expect(estimate, id).toBeDefined();
  return estimate!;
}

/** First interest point of `accountId` strictly after `date` (the residual the projection posts after a payoff). */
function nextInterestAfter(projection: FinancialProjection, accountId: string, date: string): number {
  const point = projection.points.find((p) => p.accountId === accountId && p.type === "credit-card-interest" && p.date > date);
  return point ? point.debtDelta : 0;
}

describe("estimateDebtPayoffs — demo document", () => {
  const demo = createDemoFinancialDocument(START);
  const payoffs = estimateDebtPayoffs(demo);

  it("estimates every enabled debt account (cards, loan, MSI) and nothing else", () => {
    expect([...payoffs.keys()]).toEqual(["fin-prestamo", "fin-nu", "fin-bbva", "fin-laptop-msi"]);
    expect(payoffs.get("fin-nu")!.kind).toBe("credit-card");
    expect(payoffs.get("fin-prestamo")!.kind).toBe("loan");
    expect(payoffs.get("fin-laptop-msi")!.kind).toBe("installment-plan");
  });

  it("Nu at 99.9 % paying 3 000 a month is paid off in 2028 with large interest", () => {
    const nu = payoffs.get("fin-nu")!;
    expect(nu).toEqual({
      accountId: "fin-nu",
      name: "Nu",
      kind: "credit-card",
      payoffDate: "2028-08-26",
      totalInterest: 33356.52,
      totalPaid: 63425.52,
      finalDebt: 0,
    });
    // Everything paid = opening balance + interest (no purchases on the card).
    expect(nu.totalPaid).toBeCloseTo(30069 + nu.totalInterest, 2);
    // A payoff on the card's due day.
    expect(nu.payoffDate!.slice(8)).toBe("26");
  });

  it("BBVA (39 %, minimum 2 500) takes longer; loan and MSI end with their schedules", () => {
    expect(payoffs.get("fin-bbva")!.payoffDate).toBe("2030-11-27");
    expect(payoffs.get("fin-bbva")!.totalPaid).toBeCloseTo(60941 + payoffs.get("fin-bbva")!.totalInterest, 2);
    // Loan without balance: owes its 6 payments of 7 500 (15th of each month, until 2027-05-07).
    expect(payoffs.get("fin-prestamo")).toMatchObject({ payoffDate: "2027-04-15", totalInterest: 0, totalPaid: 45000, finalDebt: 0 });
    // Laptop: 9 installments of 1 500 left, on BBVA's due day (27).
    expect(payoffs.get("fin-laptop-msi")).toMatchObject({ payoffDate: "2027-07-27", totalInterest: 0, totalPaid: 13500, finalDebt: 0 });
  });

  it("matches a long projection: debt hits 0 on the payoff date; interest and payments agree", () => {
    const projection = projectFinancialDocument({ ...demo, horizonMonths: 60 });
    for (const estimate of payoffs.values()) {
      const id = estimate.accountId;
      const date = estimate.payoffDate!;
      expect(debtByAccountAt(projection, date).get(id), id).toBe(0);
      expect(debtByAccountAt(projection, addDays(date, -1)).get(id)!, id).toBeGreaterThan(0);
      // The projection posts the last stretch's interest at the next cut and the next payment settles it.
      const residual = nextInterestAfter(projection, id, date);
      const activity = accountActivity(projection, id, START, date);
      expect(estimate.totalInterest, id).toBeCloseTo(activity.interest + residual, 2);
      expect(estimate.totalPaid, id).toBeCloseTo(activity.payments + residual, 2);
    }
    expect(nextInterestAfter(projection, "fin-nu", "2028-08-26")).toBeGreaterThan(0);
  });

  it("is deterministic and returns a new map per call", () => {
    const again = estimateDebtPayoffs(demo);
    expect(again).not.toBe(payoffs);
    expect([...again.entries()]).toEqual([...payoffs.entries()]);
  });
});

describe("estimateDebtPayoffs — credit cards", () => {
  it("a payment below the monthly interest never pays the card off (null) and the debt compounds", () => {
    // 30 000 at 99.9 %: ~2 500 of interest a month vs a 2 000 payment.
    const d = doc([card({ balance: 30000, annualRate: 99.9, paymentAmount: 2000 })]);
    const yearly = payoffOf(d, "card", 12);
    expect(yearly.payoffDate).toBeNull();
    expect(yearly.finalDebt).toBeGreaterThan(30000);
    expect(yearly.totalInterest).toBeGreaterThan(25000);
    // 12 due dates (the 26th) in [2026-11-07, 2027-11-07].
    expect(yearly.totalPaid).toBe(24000);
    expect(yearly.totalPaid).toBeCloseTo(30000 + yearly.totalInterest - yearly.finalDebt, 2);
    // The final debt includes the interest accrued since the last cut: >= the projection's posted debt.
    const projection = projectFinancialDocument(d);
    const posted = debtByAccountAt(projection, projection.endDate).get("card")!;
    expect(yearly.finalDebt).toBeGreaterThan(posted);
    // At most ~25 days of interest accrued since the last cut (2027-10-15).
    expect(yearly.finalDebt - posted).toBeLessThan((posted * 99.9 * 25) / 36000);
    // Default window (30 years): still null, still finite.
    const capped = payoffOf(d, "card");
    expect(capped.payoffDate).toBeNull();
    expect(Number.isFinite(capped.finalDebt)).toBe(true);
    expect(capped.finalDebt).toBeGreaterThan(yearly.finalDebt);
  });

  it("no planned payment (minimum 0) → null; no balance and no purchases → paid off from the start", () => {
    const unpaid = doc([card({ balance: 5000, paymentAmount: undefined, minimumPayment: 0 })]);
    expect(payoffOf(unpaid, "card", 24)).toMatchObject({ payoffDate: null, totalPaid: 0, finalDebt: 5000 });
    const clean = doc([card({ balance: 0 })]);
    expect(payoffOf(clean, "card")).toEqual({
      accountId: "card",
      name: "Card",
      kind: "credit-card",
      payoffDate: START,
      totalInterest: 0,
      totalPaid: 0,
      finalDebt: 0,
    });
  });

  it("the payment is capped at the debt: one due date clears a small balance", () => {
    expect(payoffOf(doc([card({ balance: 1000 })]), "card")).toMatchObject({
      payoffDate: "2026-11-26",
      totalPaid: 1000,
      totalInterest: 0,
    });
  });

  it("a later one-off purchase moves the payoff after it; a covered subscription does not", () => {
    // 5 000 bought on 2027-02-10, paid 3 000 + 2 000 on the next two due dates.
    const later = doc([card(), purchase("tv", 5000, { frequency: "once", startDate: "2027-02-10", endDate: "2027-02-10" })]);
    expect(payoffOf(later, "card")).toMatchObject({ payoffDate: "2027-03-26", totalPaid: 6000, finalDebt: 0 });
    // 200 a month forever, cleared by every payment: the balance is gone on the first due date.
    const subscription = doc([card(), purchase("netflix", 200, { frequency: "monthly", startDate: "2026-11-10" })]);
    expect(payoffOf(subscription, "card")).toMatchObject({ payoffDate: "2026-11-26", totalPaid: 1200, finalDebt: 0 });
    // No opening balance + a covered subscription: nothing is ever carried.
    const fresh = doc([card({ balance: 0 }), purchase("netflix", 200, { frequency: "monthly", startDate: "2026-11-10" })]);
    expect(payoffOf(fresh, "card").payoffDate).toBe(START);
  });

  it("a subscription larger than the payment, or one that outlives the payments, is never paid off", () => {
    const heavy = doc([card(), purchase("rent", 5000, { frequency: "monthly", startDate: "2026-11-10" })]);
    expect(payoffOf(heavy, "card", 24).payoffDate).toBeNull();
    // Payments stop after 2027-05-07; the subscription keeps charging.
    const stopped = doc([
      card({ balance: 0, recurrence: { frequency: "monthly", startDate: START, endDate: "2027-05-07" } }),
      purchase("netflix", 200, { frequency: "monthly", startDate: "2026-11-10" }),
    ]);
    const estimate = payoffOf(stopped, "card", 24);
    expect(estimate.payoffDate).toBeNull();
    expect(estimate.finalDebt).toBeGreaterThan(0);
  });

  it("purchases charged to another / missing card or disabled are ignored", () => {
    const d = doc([
      card(),
      purchase("other", 9000, { frequency: "once", startDate: "2027-02-10" }, "other-card"),
      { ...purchase("off", 9000, { frequency: "once", startDate: "2027-02-10" }), enabled: false },
    ]);
    expect(payoffOf(d, "card").payoffDate).toBe("2026-11-26");
  });

  it("interest matches the projection cut by cut while the card is owed", () => {
    const d = doc(
      [
        card({ balance: 20000, annualRate: 45, paymentAmount: 2500 }),
        purchase("gas", 800, { frequency: "biweekly", startDate: "2026-11-12", endDate: "2027-06-30" }),
        purchase("tv", 7000, { frequency: "once", startDate: "2027-01-03" }),
      ],
      { horizonMonths: 48 },
    );
    const estimate = payoffOf(d, "card");
    const date = estimate.payoffDate!;
    expect(date > "2027-06-30").toBe(true);
    const projection = projectFinancialDocument(d);
    expect(debtByAccountAt(projection, date).get("card")).toBe(0);
    expect(debtByAccountAt(projection, addDays(date, -1)).get("card")!).toBeGreaterThan(0);
    const activity = accountActivity(projection, "card", START, date);
    const residual = nextInterestAfter(projection, "card", date);
    expect(estimate.totalInterest).toBeCloseTo(activity.interest + residual, 2);
    expect(estimate.totalPaid).toBeCloseTo(20000 + activity.charges + estimate.totalInterest, 2);
  });
});

describe("estimateDebtPayoffs — loans and MSI", () => {
  function loan(over: Partial<LoanItem> = {}): LoanItem {
    return {
      id: "loan",
      kind: "loan",
      name: "Loan",
      paymentAmount: 3000,
      recurrence: { frequency: "monthly", startDate: START },
      ...over,
    };
  }

  it("a loan with a balance is paid off by the payment that covers the rest", () => {
    // 3 000 + 3 000 + 3 000 + 1 000 (capped) on the 7th of each month.
    expect(payoffOf(doc([loan({ balance: 10000 })]), "loan")).toEqual({
      accountId: "loan",
      name: "Loan",
      kind: "loan",
      payoffDate: "2027-02-07",
      totalInterest: 0,
      totalPaid: 10000,
      finalDebt: 0,
    });
  });

  it("a loan that outlasts the window is null with the rest still owed", () => {
    // 13 payments in [2026-11-07, 2027-11-07].
    expect(payoffOf(doc([loan({ balance: 100000, paymentAmount: 1000 })]), "loan", 12)).toMatchObject({
      payoffDate: null,
      totalPaid: 13000,
      finalDebt: 87000,
    });
  });

  it("a loan without balance owes its schedule up to endDate (beyond the horizon too)", () => {
    const endDate = addMonths(START, 30);
    const estimate = payoffOf(doc([loan({ recurrence: { frequency: "monthly", startDate: START, endDate } })]), "loan");
    expect(estimate).toMatchObject({ payoffDate: endDate, totalPaid: 31 * 3000, finalDebt: 0 });
    // Unknown debt (no balance, no end): nothing owed.
    expect(payoffOf(doc([loan()]), "loan").payoffDate).toBe(START);
  });

  it("MSI: the last installment pays it off and absorbs the cents", () => {
    const plan: InstallmentPlanItem = {
      id: "msi",
      kind: "installment-plan",
      name: "3 MSI",
      originalAmount: 1000,
      installmentsTotal: 3,
      installmentsPaid: 0,
      recurrence: { frequency: "monthly", startDate: START },
    };
    // Not a future purchase (starts on the document start): owed from the start, paid on the 7th.
    expect(payoffOf(doc([plan]), "msi")).toMatchObject({ payoffDate: "2027-01-07", totalPaid: 1000, finalDebt: 0 });
  });

  it("future MSI on a card opens on its start date and pays on the card's due day", () => {
    const plan: InstallmentPlanItem = {
      id: "msi",
      kind: "installment-plan",
      name: "6 MSI",
      cardId: "card",
      originalAmount: 6000,
      installmentsTotal: 6,
      installmentsPaid: 0,
      recurrence: { frequency: "monthly", startDate: "2027-01-10" },
    };
    const d = doc([card({ balance: 0 }), plan], { horizonMonths: 12 });
    // Due day 26: 2027-01-26 … 2027-06-26. The card itself owes nothing (MSI is its own account).
    expect(payoffOf(d, "msi")).toMatchObject({ payoffDate: "2027-06-26", totalPaid: 6000, totalInterest: 0, finalDebt: 0 });
    expect(payoffOf(d, "card").payoffDate).toBe(START);
    const projection = projectFinancialDocument(d);
    expect(debtByAccountAt(projection, "2027-06-25").get("msi")).toBe(1000);
    expect(debtByAccountAt(projection, "2027-06-26").get("msi")).toBe(0);
    // A window that ends before the last installment: still owed.
    expect(payoffOf(d, "msi", 6)).toMatchObject({ payoffDate: null, totalPaid: 4000, finalDebt: 2000 });
  });
});

describe("estimateDebtPayoffs — inputs", () => {
  it("skips disabled accounts and repeated ids; invalid start → empty map", () => {
    const d = doc([card({ enabled: false }), card({ id: "b", name: "B" }), card({ id: "b", name: "B2", balance: 99999 })]);
    const payoffs = estimateDebtPayoffs(d);
    expect([...payoffs.keys()]).toEqual(["b"]);
    expect(payoffs.get("b")!.name).toBe("B");
    expect(estimateDebtPayoffs({ ...d, startDate: "not-a-date" }).size).toBe(0);
  });

  it("maxMonths 0 limits the window to the start date; non-finite falls back to 360", () => {
    const d = doc([card({ balance: 1000 })]);
    expect(payoffOf(d, "card", 0)).toMatchObject({ payoffDate: null, finalDebt: 1000, totalPaid: 0 });
    expect(payoffOf(d, "card", Number.NaN).payoffDate).toBe("2026-11-26");
  });
});
