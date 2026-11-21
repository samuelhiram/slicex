// accountActivity (per-account prefix sums) and annualItemImpact (per-item
// cash impact, cached per projection).
import { describe, expect, it } from "vitest";
import {
  accountActivity,
  addDays,
  annualItemImpact,
  createDemoFinancialDocument,
  projectFinancialDocument,
  projectFinancialTimeline,
} from "../src/finance";
import type {
  AccountActivity,
  FinancialEvent,
  FinancialEventType,
  FinancialProjection,
  ISODate,
} from "../src/finance";

function ev(id: string, type: FinancialEventType, date: ISODate, amount: number, accountId?: string): FinancialEvent {
  const e: FinancialEvent = { id: `${id}@${date}`, itemId: id, type, date, amount, name: id };
  if (accountId) e.accountId = accountId;
  return e;
}

const timeline = projectFinancialTimeline({
  initialCash: 10000,
  startDate: "2026-11-01",
  endDate: "2027-01-31",
  accounts: [
    { id: "card", name: "card", kind: "credit-card", openingDebt: 3600, annualRate: 36 },
    { id: "loan", name: "loan", kind: "loan", openingDebt: 1000, annualRate: 0 },
  ],
  events: [
    ev("buy", "credit-card-purchase", "2026-11-05", 400, "card"),
    ev("card", "credit-card-interest", "2026-11-15", 0, "card"),
    ev("card", "credit-card-payment", "2026-11-26", 1500, "card"),
    ev("loan", "loan-payment", "2026-11-28", 800, "loan"),
    ev("buy2", "credit-card-purchase", "2026-12-15", 250, "card"),
    ev("card", "credit-card-interest", "2026-12-15", 0, "card"),
    ev("card", "credit-card-payment", "2026-12-26", 1500, "card"),
    // Only 200 left: the cash leaves in full, the debt drops by 200.
    ev("loan", "loan-payment", "2026-12-28", 800, "loan"),
    ev("rent", "expense", "2027-01-02", 3000),
  ],
});

/** Plain filter + sum over the points (reference for the prefix sums). */
function naiveActivity(projection: FinancialProjection, accountId: string, from: ISODate, to: ISODate): AccountActivity {
  let interest = 0;
  let payments = 0;
  let charges = 0;
  for (const p of projection.points) {
    if (p.accountId !== accountId || p.date < from || p.date > to) continue;
    if (p.type === "credit-card-interest") interest += p.debtDelta;
    else if (p.type === "credit-card-purchase" || p.type === "debt-opening") charges += p.debtDelta;
    else if (p.type === "credit-card-payment" || p.type === "loan-payment" || p.type === "installment-payment") payments -= p.cashDelta;
  }
  const r = (x: number) => Math.round(x * 100) / 100;
  return { interest: r(interest), payments: r(payments), charges: r(charges) };
}

describe("accountActivity", () => {
  it("sums interest, payments and charges of one account over an inclusive date range", () => {
    // 3600 from 11-01 to 11-05, 4000 to 11-15 at 36 %: 3600·0.001·4 + 4000·0.001·10 = 54.4
    const interestNov = timeline.points.find((p) => p.type === "credit-card-interest")!;
    expect(interestNov.debtDelta).toBe(54.4);
    const all = accountActivity(timeline, "card", "2026-11-01", "2027-01-31");
    expect(all.payments).toBe(3000);
    expect(all.charges).toBe(650);
    expect(all.interest).toBeGreaterThan(54.4);
    expect(all).toEqual(naiveActivity(timeline, "card", "2026-11-01", "2027-01-31"));
    // Inclusive bounds: a range of one day picks that day's points only.
    expect(accountActivity(timeline, "card", "2026-11-05", "2026-11-05")).toEqual({ interest: 0, payments: 0, charges: 400 });
    expect(accountActivity(timeline, "card", "2026-11-15", "2026-11-26")).toEqual({ interest: 54.4, payments: 1500, charges: 0 });
    expect(accountActivity(timeline, "card", "2026-11-06", "2026-11-14")).toEqual({ interest: 0, payments: 0, charges: 0 });
    // Same-day purchase + interest both count.
    expect(accountActivity(timeline, "card", "2026-12-15", "2026-12-15").charges).toBe(250);
    expect(accountActivity(timeline, "card", "2026-12-15", "2026-12-15").interest).toBeGreaterThan(0);
  });

  it("a loan payment counts the cash paid, even past the remaining debt", () => {
    expect(accountActivity(timeline, "loan", "2026-11-01", "2027-01-31")).toEqual({ interest: 0, payments: 1600, charges: 0 });
  });

  it("zeros for an unknown account, a range with no point, or from > to", () => {
    const zero = { interest: 0, payments: 0, charges: 0 };
    expect(accountActivity(timeline, "nope", "2026-11-01", "2027-01-31")).toEqual(zero);
    expect(accountActivity(timeline, "card", "2027-02-01", "2027-12-31")).toEqual(zero);
    expect(accountActivity(timeline, "card", "2025-01-01", "2026-10-31")).toEqual(zero);
    expect(accountActivity(timeline, "card", "2026-12-31", "2026-11-01")).toEqual(zero);
  });

  it("writes into `out` when given (no allocation per call)", () => {
    const out: AccountActivity = { interest: 9, payments: 9, charges: 9 };
    expect(accountActivity(timeline, "card", "2026-11-05", "2026-11-05", out)).toBe(out);
    expect(out).toEqual({ interest: 0, payments: 0, charges: 400 });
    expect(accountActivity(timeline, "nope", "2026-11-01", "2026-11-30", out)).toBe(out);
    expect(out).toEqual({ interest: 0, payments: 0, charges: 0 });
  });

  it("matches the plain filter on the demo projection for many ranges", () => {
    const doc = createDemoFinancialDocument("2026-11-07");
    const projection = projectFinancialDocument(doc);
    let checked = 0;
    for (const account of projection.accounts) {
      for (let a = 0; a < 380; a += 23) {
        for (const len of [0, 1, 6, 30, 31, 90, 400]) {
          const from = addDays(doc.startDate, a - 10);
          const to = addDays(from, len);
          expect(accountActivity(projection, account.id, from, to), `${account.id} ${from}..${to}`).toEqual(
            naiveActivity(projection, account.id, from, to),
          );
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
  });
});

describe("annualItemImpact", () => {
  it("is the signed cash sum per item over the whole projection", () => {
    const impact = annualItemImpact(timeline);
    expect(impact.get("card")).toBe(-3000);
    expect(impact.get("loan")).toBe(-1600);
    expect(impact.get("rent")).toBe(-3000);
    // A purchase moves no cash: present, 0.
    expect(impact.get("buy")).toBe(0);
    expect(impact.has("nope")).toBe(false);
  });

  it("matches a plain per-item sum on the demo projection", () => {
    const projection = projectFinancialDocument(createDemoFinancialDocument("2026-11-07"));
    const naive = new Map<string, number>();
    for (const p of projection.points) naive.set(p.itemId, Math.round(((naive.get(p.itemId) ?? 0) + p.cashDelta) * 100) / 100);
    const impact = annualItemImpact(projection);
    expect([...impact.entries()].sort()).toEqual([...naive.entries()].sort());
    // Payroll: 24 quincenas of 9 000 in the year.
    expect(impact.get("fin-sueldo")).toBe(24 * 9000);
    expect(impact.get("fin-gasto")).toBe(-2000);
  });

  it("is cached per projection object (same map), and separate per projection", () => {
    const doc = createDemoFinancialDocument("2026-11-07");
    const a = projectFinancialDocument(doc);
    const b = projectFinancialDocument(doc);
    expect(annualItemImpact(a)).toBe(annualItemImpact(a));
    expect(annualItemImpact(b)).not.toBe(annualItemImpact(a));
    expect([...annualItemImpact(b).entries()]).toEqual([...annualItemImpact(a).entries()]);
  });
});
