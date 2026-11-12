// Loan amortization for the editor (UX-08): "Calcular pago" and the live
// check that balance, payment and number of payments agree.
import { describe, expect, it } from "vitest";
import { amortizedPayment, loanPaymentCount, periodsPerYear } from "../src/finance";

describe("periodsPerYear", () => {
  it("counts the payments of a year for every schedule", () => {
    expect(periodsPerYear({ frequency: "monthly" })).toBe(12);
    expect(periodsPerYear({ frequency: "monthly", interval: 2 })).toBe(6);
    expect(periodsPerYear({ frequency: "semimonthly" })).toBe(24);
    expect(periodsPerYear({ frequency: "biweekly" })).toBe(26);
    expect(periodsPerYear({ frequency: "weekly" })).toBe(52);
    expect(periodsPerYear({ frequency: "daily", interval: 5 })).toBe(73);
    expect(periodsPerYear({ frequency: "once" })).toBe(1);
  });
});

describe("amortizedPayment", () => {
  it("without a rate spreads the balance evenly (rounded up to cents)", () => {
    expect(amortizedPayment(10_000, 0, 4, 12)).toBe(2500);
    expect(amortizedPayment(10_000, undefined, 3, 12)).toBe(3333.34);
  });

  it("with a rate is the standard French-amortization payment", () => {
    // 100,000 at 12 %/year, 12 monthly payments: 8,884.88.
    expect(amortizedPayment(100_000, 12, 12, 12)).toBe(8884.88);
    // 10,000 at 30 %/year, 12 monthly payments ≈ 974.87 → rounded up.
    expect(amortizedPayment(10_000, 30, 12, 12)).toBe(974.88);
  });

  it("is 0 when there is nothing to pay or no payment to spread it over", () => {
    expect(amortizedPayment(0, 12, 12, 12)).toBe(0);
    expect(amortizedPayment(-5, 12, 12, 12)).toBe(0);
    expect(amortizedPayment(10_000, 12, 0, 12)).toBe(0);
    expect(amortizedPayment(Number.NaN, 12, 12, 12)).toBe(0);
  });

  it("the rounded payment pays the balance off in exactly that many payments", () => {
    for (const [principal, rate, count] of [
      [10_000, 0, 7],
      [10_000, 30, 12],
      [250_000, 18.5, 48],
      [1_234.56, 99.9, 5],
    ] as const) {
      const payment = amortizedPayment(principal, rate, count, 12);
      expect(loanPaymentCount(principal, rate, payment, 12)).toBe(count);
    }
  });
});

describe("loanPaymentCount", () => {
  it("counts the payments to pay off a balance (the last may be smaller)", () => {
    expect(loanPaymentCount(10_000, 0, 1_500, 12)).toBe(7);
    expect(loanPaymentCount(10_000, 0, 2_500, 12)).toBe(4);
    expect(loanPaymentCount(10_000, 30, 1_000, 12)).toBe(12);
  });

  it("0 when nothing is owed; null when the payment never pays it off", () => {
    expect(loanPaymentCount(0, 30, 1_000, 12)).toBe(0);
    expect(loanPaymentCount(10_000, 0, 0, 12)).toBeNull();
    // 10,000 at 60 %/year costs 500 of interest a month: 500 never pays it.
    expect(loanPaymentCount(10_000, 60, 500, 12)).toBeNull();
    expect(loanPaymentCount(10_000, 60, 501, 12)).not.toBeNull();
  });
});
