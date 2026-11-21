// solveDebtPayment: goal seek of a debt's planned payment from a target
// payoff date. Every card solution is cross-checked against
// estimateDebtPayoffs on the FULL document with the default 360-month
// window (the solver itself only simulates a reduced document / window).
import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildProjectionAccounts,
  createDemoFinancialDocument,
  estimateDebtPayoffs,
  solveDebtPayment,
} from "../src/finance";
import type {
  CardPurchaseItem,
  CreditCardItem,
  DebtPaymentSolution,
  FinancialDocument,
  FinancialItem,
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
    balance: 20000,
    annualRate: 60,
    cutDay: 15,
    dueDay: 26,
    minimumPayment: 500,
    paymentAmount: 2000,
    recurrence: { frequency: "monthly", startDate: START },
    ...over,
  };
}

function purchase(id: string, amount: number, recurrence: CardPurchaseItem["recurrence"], cardId = "card"): CardPurchaseItem {
  return { id, kind: "card-purchase", name: id, cardId, amount, recurrence };
}

function loan(over: Partial<LoanItem> = {}): LoanItem {
  return {
    id: "loan",
    kind: "loan",
    name: "Loan",
    paymentAmount: 1000,
    recurrence: { frequency: "monthly", startDate: "2026-12-01" },
    ...over,
  };
}

/** `d` with item `id` replaced by `patch(item)`. */
function patched(d: FinancialDocument, id: string, patch: (item: FinancialItem) => FinancialItem): FinancialDocument {
  return { ...d, items: d.items.map((item) => (item.id === id ? patch(item) : item)) };
}

/** Payoff date of card `id` in `d` (full document, default 360-month window) with `payment`. */
function cardPayoffWith(d: FinancialDocument, id: string, payment: number): string | null {
  const withPayment = patched(d, id, (item) => ({ ...(item as CreditCardItem), paymentAmount: payment }));
  return estimateDebtPayoffs(withPayment).get(id)!.payoffDate;
}

function solve(d: FinancialDocument, id: string, target: string): DebtPaymentSolution {
  const solution = solveDebtPayment(d, id, target);
  expect(solution, `${id} → ${target}`).not.toBeNull();
  return solution!;
}

/** The solved payment reaches the target; one peso less does not (unless it is already the floor). */
function expectMinimalCardSolution(d: FinancialDocument, id: string, target: string): DebtPaymentSolution {
  const solution = solve(d, id, target);
  const item = d.items.find((i) => i.id === id) as CreditCardItem;
  const floor = Math.max(1, Math.ceil(item.minimumPayment));
  expect(Number.isInteger(solution.paymentAmount)).toBe(true);
  expect(solution.feasible).toBe(true);
  expect(solution.payoffDate! <= target).toBe(true);
  const full = estimateDebtPayoffs(patched(d, id, (i) => ({ ...(i as CreditCardItem), paymentAmount: solution.paymentAmount })));
  expect(full.get(id)!.payoffDate).toBe(solution.payoffDate);
  expect(full.get(id)!.totalInterest).toBe(solution.totalInterest);
  if (solution.paymentAmount > floor) {
    const below = cardPayoffWith(d, id, solution.paymentAmount - 1);
    expect(below === null || below > target, `${solution.paymentAmount - 1} misses ${target}`).toBe(true);
  } else {
    expect(solution.paymentAmount).toBe(floor);
  }
  return solution;
}

describe("solveDebtPayment — credit cards", () => {
  const demo = createDemoFinancialDocument(START);

  it("Nu: the solved payment reaches the target and one peso less does not", () => {
    const solution = expectMinimalCardSolution(demo, "fin-nu", "2027-06-30");
    expect(solution).toEqual({
      accountId: "fin-nu",
      paymentAmount: 5141,
      payoffDate: "2027-06-26",
      feasible: true,
      totalInterest: solution.totalInterest,
    });
    // Paying faster than the planned 3 000 a month costs far less interest.
    expect(solution.totalInterest).toBeLessThan(estimateDebtPayoffs(demo).get("fin-nu")!.totalInterest);
    expect(solution.endDate).toBeUndefined();
  });

  it("dragging the end later lowers the payment (monotonic), and the current payoff gives back ~the current payment", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const target of ["2026-12-26", "2027-03-31", "2027-11-30", "2028-08-26", "2030-12-31", addMonths(START, 300)]) {
      const solution = expectMinimalCardSolution(demo, "fin-nu", target);
      expect(solution.paymentAmount).toBeLessThanOrEqual(previous);
      previous = solution.paymentAmount;
    }
    // The planned 3 000 pays Nu off on 2028-08-26: the minimal payment for that date is at most 3 000.
    expect(solve(demo, "fin-nu", "2028-08-26").paymentAmount).toBeLessThanOrEqual(3000);
  });

  it("BBVA: a target past the payoff at the minimum payment returns the minimum", () => {
    const solution = expectMinimalCardSolution(demo, "fin-bbva", "2031-06-30");
    expect(solution.paymentAmount).toBe(2500);
    expect(solution.payoffDate).toBe("2030-11-27");
    expectMinimalCardSolution(demo, "fin-bbva", "2028-01-31");
  });

  it("a target before the first due date that can clear the card is infeasible: earliest payoff, minimal payment for it", () => {
    // Nu's first due date is 2026-11-26 (after the 2026-11-15 cut posts interest).
    for (const target of ["2026-11-20", "2026-11-01"]) {
      const solution = solve(demo, "fin-nu", target);
      expect(solution.feasible).toBe(false);
      expect(solution.payoffDate).toBe("2026-11-26");
      // The whole debt at the due date (30 069 + the cut's interest), rounded up to pesos.
      expect(solution.paymentAmount).toBe(30737);
      expect(cardPayoffWith(demo, "fin-nu", 30737)).toBe("2026-11-26");
      expect(cardPayoffWith(demo, "fin-nu", 30736)).not.toBe("2026-11-26");
    }
    // The due date itself is feasible with that same payment.
    expect(solve(demo, "fin-nu", "2026-11-26")).toMatchObject({ feasible: true, paymentAmount: 30737, payoffDate: "2026-11-26" });
  });

  it("the card's own purchases count: a finite purchase after the target makes it infeasible", () => {
    const d = doc([
      card(),
      purchase("tv", 6000, { frequency: "once", startDate: "2027-03-03", endDate: "2027-03-03" }),
      purchase("other-card", 50000, { frequency: "once", startDate: "2026-12-01" }, "elsewhere"),
    ]);
    // Clearing the card before the TV purchase does not count: it reopens the debt.
    const early = solve(d, "card", "2027-01-31");
    expect(early.feasible).toBe(false);
    expect(early.payoffDate).toBe("2027-03-26");
    expect(cardPayoffWith(d, "card", early.paymentAmount)).toBe("2027-03-26");
    expect(cardPayoffWith(d, "card", early.paymentAmount - 1)).not.toBe("2027-03-26");
    // After the purchase: a regular solution, cross-checked on the full document.
    expectMinimalCardSolution(d, "card", "2027-09-30");
  });

  it("subscriptions (steady charges) and a minimum below one peso are handled", () => {
    const d = doc([
      card({ minimumPayment: 0, balance: 8000, annualRate: 45 }),
      purchase("streaming", 199, { frequency: "monthly", startDate: "2026-11-20" }),
    ]);
    expectMinimalCardSolution(d, "card", "2027-04-30");
    expectMinimalCardSolution(d, "card", "2028-12-31");
  });

  it("statement-mode cards, installment plans, non-debts, unknown / disabled ids and empty cards → null", () => {
    const statement = doc([card({ paymentMode: "statement" })]);
    expect(solveDebtPayment(statement, "card", "2027-06-30")).toBeNull();
    // "fixed" explicitly behaves like undefined.
    expect(solveDebtPayment(doc([card({ paymentMode: "fixed" })]), "card", "2027-06-30")).not.toBeNull();
    expect(solveDebtPayment(demo, "fin-laptop-msi", "2027-06-30")).toBeNull();
    expect(solveDebtPayment(demo, "fin-sueldo", "2027-06-30")).toBeNull();
    expect(solveDebtPayment(demo, "nope", "2027-06-30")).toBeNull();
    expect(solveDebtPayment(doc([card({ enabled: false })]), "card", "2027-06-30")).toBeNull();
    expect(solveDebtPayment(doc([card({ balance: 0 })]), "card", "2027-06-30")).toBeNull();
    expect(solveDebtPayment(demo, "fin-nu", "2027-13-40")).toBeNull();
  });

  it("budget: a card with a ~30-year payoff solves in well under a frame", () => {
    // 100 000 at 12 %: interest ≈ 1 000 a month, so the payment for 30 years sits just above it.
    const d = doc([card({ balance: 100000, annualRate: 12, minimumPayment: 100, paymentAmount: 1500 })]);
    const target = addMonths(START, 359);
    const solution = expectMinimalCardSolution(d, "card", target);
    expect(solution.payoffDate! > addMonths(START, 300)).toBe(true);

    const time = (run: () => void): number => {
      for (let i = 0; i < 20; i++) run(); // JIT warm-up (unmeasured)
      const samples: number[] = [];
      for (let i = 0; i < 40; i++) {
        const t = performance.now();
        run();
        samples.push(performance.now() - t);
      }
      samples.sort((a, b) => a - b);
      return samples[samples.length >> 1]!;
    };
    const longMs = time(() => solveDebtPayment(d, "card", target));
    const nuMs = time(() => solveDebtPayment(demo, "fin-nu", addMonths(START, 358)));
    // Measured ≈ 0.3–0.6 ms on a laptop; 20 ms leaves room for slow CI.
    expect(longMs, `30-year card ${longMs.toFixed(3)} ms`).toBeLessThan(20);
    expect(nuMs, `Nu ${nuMs.toFixed(3)} ms`).toBeLessThan(20);
  });
});

describe("solveDebtPayment — loans", () => {
  it("with balance: ceil-to-cents(balance / payments up to the target)", () => {
    const d = doc([loan({ balance: 10000 })]);
    // 2026-12-01, 2027-01-01, 2027-02-01, 2027-03-01.
    expect(solve(d, "loan", "2027-03-15")).toEqual({
      accountId: "loan",
      paymentAmount: 2500,
      payoffDate: "2027-03-01",
      feasible: true,
      totalInterest: 0,
    });
    // Three payments: 3 333.34 (rounded UP, so the third one clears it).
    const three = solve(d, "loan", "2027-02-28");
    expect(three).toMatchObject({ paymentAmount: 3333.34, payoffDate: "2027-02-01", feasible: true });
    expect(three.endDate).toBeUndefined();
    const estimate = estimateDebtPayoffs(patched(d, "loan", (i) => ({ ...(i as LoanItem), paymentAmount: 3333.34 }))).get("loan")!;
    expect(estimate.payoffDate).toBe("2027-02-01");
    expect(estimateDebtPayoffs(patched(d, "loan", (i) => ({ ...(i as LoanItem), paymentAmount: 3333.33 }))).get("loan")!.payoffDate).toBe(
      "2027-03-01",
    );
  });

  it("with balance and no payment before the target: infeasible, the whole balance on the first payment", () => {
    const d = doc([loan({ balance: 10000 })]);
    expect(solve(d, "loan", "2026-11-30")).toEqual({
      accountId: "loan",
      paymentAmount: 10000,
      payoffDate: "2026-12-01",
      feasible: false,
      totalInterest: 0,
    });
  });

  it("with balance: the loan keeps its own window (payments stop at its endDate)", () => {
    const d = doc([loan({ balance: 9000, recurrence: { frequency: "monthly", startDate: "2026-12-01", endDate: "2027-02-01" } })]);
    // Only 3 payments exist, however late the target is.
    expect(solve(d, "loan", "2027-12-31")).toMatchObject({ paymentAmount: 3000, payoffDate: "2027-02-01", feasible: true });
  });

  it("without balance: keeps the total, moves endDate to the last payment ≤ target (demo loan)", () => {
    const demo = createDemoFinancialDocument(START);
    const totalBefore = buildProjectionAccounts(demo).find((a) => a.id === "fin-prestamo")!.openingDebt;
    expect(totalBefore).toBe(45000); // 6 × 7 500

    for (const [target, payment, endDate, n] of [
      ["2027-08-20", 4500, "2027-08-15", 10],
      ["2027-02-15", 11250, "2027-02-15", 4],
      ["2028-01-01", 3214.29, "2027-12-15", 14],
    ] as const) {
      const solution = solve(demo, "fin-prestamo", target);
      expect(solution).toEqual({
        accountId: "fin-prestamo",
        paymentAmount: payment,
        payoffDate: endDate,
        feasible: true,
        totalInterest: 0,
        endDate,
      });
      // Applying it: the debt is preserved (up to the cents rounded up) and paid off on endDate.
      const applied = patched(demo, "fin-prestamo", (i) => ({
        ...(i as LoanItem),
        paymentAmount: solution.paymentAmount,
        recurrence: { ...i.recurrence, endDate: solution.endDate! },
      }));
      const total = buildProjectionAccounts(applied).find((a) => a.id === "fin-prestamo")!.openingDebt;
      expect(total).toBeGreaterThanOrEqual(45000);
      expect(total - 45000).toBeLessThan(n * 0.01);
      expect(estimateDebtPayoffs(applied).get("fin-prestamo")!.payoffDate).toBe(endDate);
    }
  });

  it("without balance and no payment before the target: infeasible, everything on the first payment", () => {
    const demo = createDemoFinancialDocument(START);
    expect(solve(demo, "fin-prestamo", "2026-11-10")).toEqual({
      accountId: "fin-prestamo",
      paymentAmount: 45000,
      payoffDate: "2026-11-15",
      feasible: false,
      totalInterest: 0,
      endDate: "2026-11-15",
    });
  });

  it("nothing owed (no balance and no endDate, or balance 0) → null", () => {
    expect(solveDebtPayment(doc([loan()]), "loan", "2027-06-30")).toBeNull();
    expect(solveDebtPayment(doc([loan({ balance: 0 })]), "loan", "2027-06-30")).toBeNull();
  });
});
