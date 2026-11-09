import { describe, expect, it } from "vitest";
import {
  addDays,
  createDemoFinancialDocument,
  debtByAccountAt,
  projectFinancialDocument,
  rollForward,
  snapshotAt,
} from "../src/finance";
import type {
  CardPurchaseItem,
  CreditCardItem,
  FinancialDocument,
  FinancialItem,
  FinancialProjection,
  ISODate,
  InstallmentPlanItem,
  LedgerEntry,
  LoanItem,
} from "../src/finance";

const START = "2026-11-07";

function demo(): FinancialDocument {
  return createDemoFinancialDocument(START);
}

function find<K extends FinancialItem["kind"]>(
  doc: FinancialDocument,
  id: string,
  kind: K,
): Extract<FinancialItem, { kind: K }> | undefined {
  const item = doc.items.find((i) => i.id === id);
  if (item === undefined) return undefined;
  expect(item.kind).toBe(kind);
  return item as Extract<FinancialItem, { kind: K }>;
}

function sum(values: number[]): number {
  return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
}

const money = (value: number) => Math.round(value * 100) / 100;

/** Interest the roll posted to `cardId` (accrued since its last cut), 0 when none. */
function accruedInterest(ledger: LedgerEntry[], cardId: string): number {
  return ledger.find((e) => e.eventId.startsWith(`interest@${cardId}@`))?.actualDebt ?? 0;
}

/** First date ≥ `from` whose day of month is `dom` (dom ≤ 28). */
function nextDayOfMonth(from: ISODate, dom: number): ISODate {
  let d = from;
  while (Number(d.slice(8)) !== dom) d = addDays(d, 1);
  return d;
}

const CUT_DAY: Record<string, number> = { "fin-nu": 15, "fin-bbva": 7 };

/** Largest |rolled − un-rolled| debt of each demo card, from its first cut ≥ `from` to `to`. */
function cardDriftAfterNextCut(
  unrolled: FinancialProjection,
  rolled: FinancialProjection,
  from: ISODate,
  to: ISODate,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of Object.keys(CUT_DAY)) {
    let worst = 0;
    for (const date of eachDay(nextDayOfMonth(from, CUT_DAY[id]!), to)) {
      const diff = Math.abs(debtByAccountAt(rolled, date).get(id)! - debtByAccountAt(unrolled, date).get(id)!);
      if (diff > worst) worst = diff;
    }
    out[id] = money(worst);
  }
  return out;
}

/** Every date from `from` to `to` (inclusive). */
function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Same cash (and, when asked, same debt per account) at the end of every day of [from, to]. */
function expectSameCash(a: FinancialProjection, b: FinancialProjection, from: ISODate, to: ISODate): void {
  for (const date of eachDay(from, to)) {
    expect([date, snapshotAt(b, date).cash]).toEqual([date, snapshotAt(a, date).cash]);
  }
}

function withZeroRateCards(doc: FinancialDocument): FinancialDocument {
  return {
    ...doc,
    items: doc.items.map((item) => (item.kind === "credit-card" ? { ...item, annualRate: 0 } : item)),
  };
}

describe("rollForward — no-op and validation", () => {
  it("returns the document itself when the new start is not after the old one", () => {
    const doc = demo();
    for (const date of [START, "2026-11-01", "2025-01-01"]) {
      const result = rollForward(doc, date);
      expect(result.doc).toBe(doc);
      expect(result.ledger).toEqual([]);
      expect(result.pending).toEqual([]);
    }
  });

  it("throws on a malformed date", () => {
    expect(() => rollForward(demo(), "2026-13-01")).toThrow(RangeError);
    expect(() => rollForward({ ...demo(), startDate: "nope" }, "2026-12-01")).toThrow(RangeError);
  });

  it("never mutates the input and shares no item object with it", () => {
    const doc = demo();
    const before = structuredClone(doc);
    const result = rollForward(doc, "2027-01-02", {
      actuals: [{ eventId: "fin-nu@2026-11-26", status: "skipped" }],
      cashOverride: 1,
    });
    expect(doc).toEqual(before);
    for (const item of result.doc.items) {
      const original = doc.items.find((i) => i.id === item.id)!;
      expect(item).not.toBe(original);
      expect(item.recurrence).not.toBe(original.recurrence);
    }
  });
});

describe("rollForward — everything happened as planned", () => {
  const doc = demo();
  const old = projectFinancialDocument(doc);

  it("rebases the document on the new start (2026-11-20)", () => {
    const { doc: rolled, ledger, pending } = rollForward(doc, "2026-11-20");
    expect(rolled.startDate).toBe("2026-11-20");
    expect(rolled.horizonMonths).toBe(doc.horizonMonths);
    expect(rolled.id).toBe(doc.id);
    expect(rolled.name).toBe(doc.name);
    expect(rolled.minimumCashReserve).toBe(doc.minimumCashReserve);
    expect(rolled.initialCash).toBe(snapshotAt(old, "2026-11-19").cash);
    expect(rolled.initialCash).toBe(7708);

    // The past: 11-15 payday, Nu interest, loan payment; 11-17 the Plata expense.
    const past = old.points.filter((p) => p.date < "2026-11-20");
    expect(pending).toEqual(past);
    expect(pending.map((p) => p.eventId)).toEqual([
      "fin-sueldo@2026-11-15",
      "fin-nu@2026-11-15",
      "fin-prestamo@2026-11-15",
      "fin-pago-plata@2026-11-17",
    ]);
    // One entry per past point, then the interest each card accrued since its last cut.
    expect(ledger.map((e) => e.eventId)).toEqual([
      ...pending.map((p) => p.eventId),
      "interest@fin-nu@2026-11-20",
      "interest@fin-bbva@2026-11-20",
    ]);
    for (let i = 0; i < pending.length; i++) {
      const entry = ledger[i]!;
      const point = pending[i]!;
      expect(entry.eventId).toBe(point.eventId);
      expect(entry.status).toBe("planned");
      expect(entry.planned).toBe(point.cashDelta);
      expect(entry.actual).toBe(point.cashDelta);
      expect(entry.accountId).toBe(point.accountId);
      expect(entry.plannedDebt).toBe(point.accountId === undefined ? 0 : point.debtDelta);
      expect(entry.actualDebt).toBe(entry.plannedDebt);
    }
    // Ledger reconciles: old cash + Σ actual = new cash.
    expect(sum([doc.initialCash, ...ledger.map((e) => e.actual)])).toBe(rolled.initialCash);
  });

  it("drops past one-offs, keeps future ones and recurring items untouched, in order", () => {
    const { doc: rolled } = rollForward(doc, "2026-11-20");
    expect(rolled.items.map((i) => i.id)).toEqual([
      "fin-sueldo",
      // fin-pago-plata (11-17) is in the ledger now; fin-gasto (11-20) is today.
      "fin-gasto",
      "fin-prestamo",
      "fin-nu",
      "fin-bbva",
      "fin-laptop-msi",
    ]);
    // Recurring items keep their phase (recurrence untouched).
    expect(find(rolled, "fin-sueldo", "income")).toEqual(doc.items[0]);
    // Window-defined loan (no balance): nothing to change.
    const loan = find(rolled, "fin-prestamo", "loan")!;
    expect(loan).toEqual(doc.items.find((i) => i.id === "fin-prestamo"));
    expect("balance" in loan).toBe(false);
  });

  it("carries the card debt of the day before plus the interest accrued since the last cut", () => {
    const { doc: rolled, ledger } = rollForward(doc, "2026-11-20");
    const debts = debtByAccountAt(old, "2026-11-19");
    expect(debts.get("fin-nu")).toBe(30736.53); // interest posted at the 11-15 cut included
    expect(debts.get("fin-bbva")).toBe(60941);
    const nu = find(rolled, "fin-nu", "credit-card")!;
    expect(nu.balance).toBe(money(30736.53 + accruedInterest(ledger, "fin-nu")));
    expect(find(rolled, "fin-bbva", "credit-card")!.balance).toBe(money(60941 + accruedInterest(ledger, "fin-bbva")));
    // Every other card field is kept.
    const { balance: _a, ...nuRest } = nu;
    const { balance: _b, ...nuOld } = find(doc, "fin-nu", "credit-card")!;
    expect(nuRest).toEqual(nuOld);
  });

  it("keeps the cash path exact after the roll", () => {
    for (const date of ["2026-11-16", "2026-11-20", "2027-01-02"]) {
      const rolled = projectFinancialDocument(rollForward(doc, date).doc);
      expectSameCash(old, rolled, date, old.endDate);
      expect(snapshotAt(rolled, old.endDate).cash).toBe(old.finalCash);
    }
  });

  it("keeps cash AND every account debt exact when no interest is pending (zero-rate cards)", () => {
    const flat = withZeroRateCards(doc);
    const flatOld = projectFinancialDocument(flat);
    for (const date of ["2026-11-20", "2027-01-02", "2027-05-20"]) {
      const rolled = projectFinancialDocument(rollForward(flat, date).doc);
      for (const day of eachDay(date, flatOld.endDate)) {
        expect([day, snapshotAt(rolled, day)]).toEqual([day, snapshotAt(flatOld, day)]);
        const before = debtByAccountAt(flatOld, day);
        for (const [id, debt] of debtByAccountAt(rolled, day)) expect([day, id, debt]).toEqual([day, id, before.get(id)]);
      }
    }
  });

  it("posts the interest accrued since the last cut, discounted to the next cut", () => {
    // Roll the day after Nu's cut (11-15): Nu accrued 1 day on its post-cut
    // debt; BBVA (cut 7 = doc start, nothing posted yet) 9 days on 60 941.
    // Each is posted as A / (1 + rate·k/36000), k = days to the next cut, so
    // the interest that amount earns until the cut brings it back to A.
    const { doc: rolledDoc, ledger } = rollForward(doc, "2026-11-16");
    const nuA = (30736.53 * 99.9 * 1) / 36000;
    const bbvaA = (60941 * 39 * 9) / 36000;
    const nuPosted = money(nuA / (1 + (99.9 * 29) / 36000)); // next cut 12-15
    const bbvaPosted = money(bbvaA / (1 + (39 * 21) / 36000)); // next cut 12-07
    expect(ledger.find((e) => e.eventId === "interest@fin-nu@2026-11-16")).toEqual({
      eventId: "interest@fin-nu@2026-11-16",
      itemId: "fin-nu",
      name: "Interés acumulado (estimado)",
      type: "credit-card-interest",
      date: "2026-11-16",
      planned: 0,
      actual: 0,
      status: "planned",
      accountId: "fin-nu",
      plannedDebt: nuPosted,
      actualDebt: nuPosted,
    });
    expect(accruedInterest(ledger, "fin-bbva")).toBe(bbvaPosted);
    expect(rolledDoc.initialCash).toBe(snapshotAt(old, "2026-11-15").cash); // no cash effect

    const rolled = projectFinancialDocument(rolledDoc);
    const at = (p: FinancialProjection, id: string, date: ISODate) => debtByAccountAt(p, date).get(id)!;
    // Until the next cut the rolled card owes the posted amount on top.
    expect(at(rolled, "fin-nu", "2026-12-14")).toBe(money(at(old, "fin-nu", "2026-12-14") + nuPosted));
    expect(at(rolled, "fin-bbva", "2026-12-06")).toBe(money(at(old, "fin-bbva", "2026-12-06") + bbvaPosted));
    // From the next cut on it matches the un-rolled projection. Tolerance
    // 0.02: the un-rolled projection rounds the cycle's interest once at the
    // cut, the rolled one twice (the posted amount, then the rest at the cut),
    // each up to half a cent off; later cuts round the same debts.
    for (const date of ["2026-11-16", "2026-11-20", "2027-01-02", "2027-03-31"]) {
      const drift = cardDriftAfterNextCut(old, projectFinancialDocument(rollForward(doc, date).doc), date, old.endDate);
      expect([date, drift["fin-nu"]! <= 0.02, drift["fin-bbva"]! <= 0.02]).toEqual([date, true, true]);
    }
  });

  it("rolling onto a cut day posts that whole cycle's interest, exactly as the projection would", () => {
    const { doc: rolledDoc, ledger } = rollForward(doc, "2026-12-15"); // Nu's cut
    const posted = old.points.find((p) => p.eventId === "fin-nu@2026-12-15")!;
    expect(posted.type).toBe("credit-card-interest");
    expect(accruedInterest(ledger, "fin-nu")).toBe(posted.debtDelta);
    const rolled = projectFinancialDocument(rolledDoc);
    expect(rolled.points.some((p) => p.eventId === "fin-nu@2026-12-15")).toBe(false); // 0 days accrued
    for (const date of eachDay("2026-12-15", old.endDate)) {
      expect([date, debtByAccountAt(rolled, date).get("fin-nu")]).toEqual([date, debtByAccountAt(old, date).get("fin-nu")]);
    }
  });

  it("statement-mode cards accrue no interest", () => {
    const statement = {
      ...doc,
      items: doc.items.map((i) => (i.id === "fin-nu" ? { ...(i as CreditCardItem), paymentMode: "statement" as const } : i)),
    };
    const { doc: rolled, ledger } = rollForward(statement, "2026-11-20");
    expect(ledger.some((e) => e.eventId.startsWith("interest@fin-nu@"))).toBe(false);
    expect(accruedInterest(ledger, "fin-bbva")).toBeGreaterThan(0);
    const debts = debtByAccountAt(projectFinancialDocument(statement), "2026-11-19");
    expect(find(rolled, "fin-nu", "credit-card")!.balance).toBe(debts.get("fin-nu"));
  });

  it("rolling every day for 60 days keeps cash exact and card debts within cents", () => {
    let rolled = doc;
    let day = START;
    let interestEntries = 0;
    for (let i = 0; i < 60; i++) {
      day = addDays(day, 1);
      const result = rollForward(rolled, day);
      interestEntries += result.ledger.filter((e) => e.eventId.startsWith("interest@")).length;
      rolled = result.doc;
    }
    expect(day).toBe("2027-01-06");
    expect(interestEntries).toBeGreaterThan(100); // both cards, (almost) every day
    const projection = projectFinancialDocument(rolled);
    expectSameCash(old, projection, day, old.endDate);
    // Tolerance 0.40 (worst case; measured ≤ 0.04): every roll rounds its
    // posted interest to cents (≤ ½ cent each → ≤ 0.30 over 60 rolls, never
    // corrected afterwards), plus a cent of cut rounding, and those cents earn
    // interest like any debt (≤ +27 % over the 3 months compared at 99.9 %).
    // Posting the accrued interest undiscounted instead would compound it
    // daily: ≈ 450 too much on Nu after these 60 rolls.
    const drift = cardDriftAfterNextCut(old, projection, day, addDays(day, 90));
    expect(drift["fin-nu"]).toBeLessThanOrEqual(0.4);
    expect(drift["fin-bbva"]).toBeLessThanOrEqual(0.4);
  });

  it("advances the MSI counter by the installments paid in the past", () => {
    const { doc: rolled } = rollForward(doc, "2027-01-02");
    // Paid 11-27 and 12-27 on BBVA's due day.
    expect(find(rolled, "fin-laptop-msi", "installment-plan")!.installmentsPaid).toBe(5);
    const projection = projectFinancialDocument(rolled);
    const first = projection.points.find((p) => p.itemId === "fin-laptop-msi")!;
    expect(first.date).toBe("2027-01-27");
    expect(first.cashDelta).toBe(-1500);
    expect(debtByAccountAt(projection, "2027-01-02").get("fin-laptop-msi")).toBe(10500);
    // Once items are both gone.
    expect(rolled.items.map((i) => i.id)).toEqual(["fin-sueldo", "fin-prestamo", "fin-nu", "fin-bbva", "fin-laptop-msi"]);
  });

  it("turns a future MSI plan that opened in the past into a current one", () => {
    const tv: InstallmentPlanItem = {
      id: "tv",
      kind: "installment-plan",
      name: "TV 6 MSI",
      cardId: "fin-bbva",
      originalAmount: 6000,
      installmentsTotal: 6,
      installmentsPaid: 0,
      recurrence: { frequency: "monthly", startDate: "2026-12-01" },
    };
    const withTv = { ...doc, items: [...doc.items, tv] };
    const before = projectFinancialDocument(withTv);
    const { doc: rolled, ledger } = rollForward(withTv, "2027-01-02");
    expect(ledger.find((e) => e.eventId === "tv@2026-12-01")).toMatchObject({
      type: "debt-opening",
      planned: 0,
      plannedDebt: 6000,
      status: "planned",
    });
    // Opened 12-01, paid 12-27.
    expect(find(rolled, "tv", "installment-plan")!.installmentsPaid).toBe(1);
    const after = projectFinancialDocument(rolled);
    expect(debtByAccountAt(after, "2027-01-02").get("tv")).toBe(5000);
    expect(debtByAccountAt(before, "2027-01-01").get("tv")).toBe(5000);
    expect(after.points.some((p) => p.itemId === "tv" && p.type === "debt-opening")).toBe(false);

    // Still in the future at the roll date: stays a future plan, untouched.
    const early = rollForward(withTv, "2026-11-20").doc;
    expect(find(early, "tv", "installment-plan")).toEqual(tv);
  });

  it("projects past the old horizon when the new start is beyond it", () => {
    const newStart = "2028-01-02";
    expect(newStart > old.endDate).toBe(true);
    const { doc: rolled, ledger, pending } = rollForward(doc, newStart);
    const extended = projectFinancialDocument({ ...doc, horizonMonths: 15 });
    expect(extended.endDate >= "2028-01-01").toBe(true);
    const past = extended.points.filter((p) => p.date < newStart);
    expect(pending).toEqual(past);
    expect(pending.at(-1)!.date > old.endDate).toBe(true);
    expect(ledger).toHaveLength(past.length + 2); // + the interest accrued on each card
    expect(rolled.initialCash).toBe(snapshotAt(extended, "2028-01-01").cash);
    expect(rolled.horizonMonths).toBe(12);
    // Loan window ended 2027-05-07 (window-defined, nothing owed) and the MSI
    // is fully paid (2027-07-27): both gone; the cards stay with their debt.
    expect(rolled.items.map((i) => i.id)).toEqual(["fin-sueldo", "fin-nu", "fin-bbva"]);
    const debts = debtByAccountAt(extended, "2028-01-01");
    for (const id of ["fin-nu", "fin-bbva"]) {
      expect(accruedInterest(ledger, id)).toBeGreaterThan(0);
      expect(find(rolled, id, "credit-card")!.balance).toBe(money(debts.get(id)! + accruedInterest(ledger, id)));
    }
  });
});

describe("rollForward — actuals", () => {
  const doc = demo();
  const old = projectFinancialDocument(doc);

  it("applies skipped and edited records to cash, card balances and MSI counters", () => {
    const { doc: rolled, ledger } = rollForward(doc, "2026-12-01", {
      actuals: [
        { eventId: "fin-pago-plata@2026-11-17", status: "skipped" }, // expense: +5792
        { eventId: "fin-sueldo@2026-11-15", status: "edited", amount: 9500 }, // +500
        { eventId: "fin-nu@2026-11-26", status: "skipped" }, // card payment: +3000 cash, +3000 owed
        { eventId: "fin-bbva@2026-11-27", status: "edited", amount: 4000 }, // −1500 cash, −1500 owed
        { eventId: "fin-laptop-msi@2026-11-27", status: "skipped" }, // +1500, installment not paid
        { eventId: "fin-gasto@2026-11-20", status: "happened" },
        { eventId: "nope@2026-11-01", status: "skipped" }, // unknown: ignored
        { eventId: "fin-sueldo@2026-12-15", status: "skipped" }, // future: ignored
      ],
    });
    const base = snapshotAt(old, "2026-11-30").cash;
    expect(rolled.initialCash).toBe(Math.round((base + 5792 + 500 + 3000 - 1500 + 1500) * 100) / 100);
    expect(sum([doc.initialCash, ...ledger.map((e) => e.actual)])).toBe(rolled.initialCash);

    const debts = debtByAccountAt(old, "2026-11-30");
    // Corrections are first-order: the accrued interest follows the planned path.
    expect(find(rolled, "fin-nu", "credit-card")!.balance).toBe(
      money(debts.get("fin-nu")! + 3000 + accruedInterest(ledger, "fin-nu")),
    );
    expect(find(rolled, "fin-bbva", "credit-card")!.balance).toBe(
      money(debts.get("fin-bbva")! - 1500 + accruedInterest(ledger, "fin-bbva")),
    );
    expect(find(rolled, "fin-laptop-msi", "installment-plan")!.installmentsPaid).toBe(3);

    const byId = new Map(ledger.map((e) => [e.eventId, e]));
    expect(byId.get("fin-pago-plata@2026-11-17")).toMatchObject({ status: "skipped", planned: -5792, actual: 0 });
    expect(byId.get("fin-sueldo@2026-11-15")).toMatchObject({ status: "edited", planned: 9000, actual: 9500 });
    expect(byId.get("fin-nu@2026-11-26")).toMatchObject({
      status: "skipped",
      planned: -3000,
      actual: 0,
      accountId: "fin-nu",
      plannedDebt: -3000,
      actualDebt: 0,
    });
    expect(byId.get("fin-bbva@2026-11-27")).toMatchObject({ status: "edited", actual: -4000, actualDebt: -4000 });
    expect(byId.get("fin-gasto@2026-11-20")).toMatchObject({ status: "happened", planned: -2000, actual: -2000 });
    expect(byId.get("fin-prestamo@2026-11-15")).toMatchObject({ status: "planned" });
    expect(byId.has("nope@2026-11-01")).toBe(false);
    expect(byId.has("fin-sueldo@2026-12-15")).toBe(false);
  });

  it("an edited MSI installment is still one installment paid", () => {
    const { doc: rolled, ledger } = rollForward(doc, "2026-12-01", {
      actuals: [{ eventId: "fin-laptop-msi@2026-11-27", status: "edited", amount: 2000 }],
    });
    expect(find(rolled, "fin-laptop-msi", "installment-plan")!.installmentsPaid).toBe(4);
    expect(rolled.initialCash).toBe(snapshotAt(old, "2026-11-30").cash - 500);
    expect(ledger.find((e) => e.eventId === "fin-laptop-msi@2026-11-27")).toMatchObject({
      actual: -2000,
      plannedDebt: -1500,
      actualDebt: -1500,
    });
  });

  it("an edit without a usable amount counts as happened; the last record per event wins", () => {
    const { doc: rolled, ledger } = rollForward(doc, "2026-12-01", {
      actuals: [
        { eventId: "fin-gasto@2026-11-20", status: "edited" },
        { eventId: "fin-sueldo@2026-11-30", status: "skipped" },
        { eventId: "fin-sueldo@2026-11-30", status: "edited", amount: -8000 }, // magnitude
      ],
    });
    expect(ledger.find((e) => e.eventId === "fin-gasto@2026-11-20")).toMatchObject({ status: "happened", actual: -2000 });
    expect(ledger.find((e) => e.eventId === "fin-sueldo@2026-11-30")).toMatchObject({ status: "edited", actual: 8000 });
    expect(rolled.initialCash).toBe(snapshotAt(old, "2026-11-30").cash - 1000);
  });

  it("a skipped payment of a window-defined loan leaves that payment owed", () => {
    const { doc: rolled } = rollForward(doc, "2026-12-01", {
      actuals: [{ eventId: "fin-prestamo@2026-11-15", status: "skipped" }],
    });
    const loan = find(rolled, "fin-prestamo", "loan")!;
    // Windowed debt after 11-15 was 37 500; the skipped 7 500 is still owed.
    expect(loan.balance).toBe(45000);
    expect(rolled.initialCash).toBe(snapshotAt(old, "2026-11-30").cash + 7500);
    const after = projectFinancialDocument(rolled);
    // Five more payments (12-15 … 04-15) leave the skipped one outstanding.
    expect(debtByAccountAt(after, "2027-06-01").get("fin-prestamo")).toBe(7500);
  });

  it("a loan with a balance carries its projected debt; it stays while owed after its window", () => {
    const loan: LoanItem = {
      id: "auto",
      kind: "loan",
      name: "Auto",
      paymentAmount: 1000,
      balance: 3500,
      recurrence: { frequency: "monthly", startDate: "2026-11-10", endDate: "2027-01-10" },
    };
    const withLoan = { ...doc, items: [...doc.items, loan] };
    const mid = find(rollForward(withLoan, "2026-12-01").doc, "auto", "loan")!;
    expect(mid.balance).toBe(2500);
    expect(mid.recurrence).toEqual(loan.recurrence);
    // Window over (3 payments made), 500 still owed: kept with that balance.
    expect(find(rollForward(withLoan, "2027-02-01").doc, "auto", "loan")!.balance).toBe(500);
    // Fully paid and over: removed.
    const paid = { ...doc, items: [...doc.items, { ...loan, balance: 3000 }] };
    expect(find(rollForward(paid, "2027-02-01").doc, "auto", "loan")).toBeUndefined();
  });

  it("card purchases: past one-offs leave the plan (their amount is in the balance), edits correct the debt", () => {
    const tenis: CardPurchaseItem = {
      id: "tenis",
      kind: "card-purchase",
      name: "Tenis",
      cardId: "fin-nu",
      amount: 1200,
      recurrence: { frequency: "once", startDate: "2026-11-10", endDate: "2026-11-10" },
    };
    const netflix: CardPurchaseItem = {
      id: "netflix",
      kind: "card-purchase",
      name: "Netflix",
      cardId: "fin-nu",
      amount: 300,
      recurrence: { frequency: "monthly", startDate: "2026-11-01" },
    };
    const withBuys = { ...doc, items: [...doc.items, tenis, netflix] };
    const before = projectFinancialDocument(withBuys);
    const planned = rollForward(withBuys, "2026-11-20");
    expect(planned.doc.items.some((i) => i.id === "tenis")).toBe(false);
    expect(find(planned.doc, "netflix", "card-purchase")).toEqual(netflix);
    const nuDebt = debtByAccountAt(before, "2026-11-19").get("fin-nu")!;
    expect(find(planned.doc, "fin-nu", "credit-card")!.balance).toBe(
      money(nuDebt + accruedInterest(planned.ledger, "fin-nu")),
    );

    const edited = rollForward(withBuys, "2026-11-20", {
      actuals: [{ eventId: "tenis@2026-11-10", status: "edited", amount: 1000 }],
    });
    expect(edited.ledger.find((e) => e.eventId === "tenis@2026-11-10")).toMatchObject({
      type: "credit-card-purchase",
      planned: 0,
      actual: 0,
      plannedDebt: 1200,
      actualDebt: 1000,
      status: "edited",
    });
    expect(find(edited.doc, "fin-nu", "credit-card")!.balance).toBe(
      money(nuDebt - 200 + accruedInterest(edited.ledger, "fin-nu")),
    );
    expect(edited.doc.initialCash).toBe(planned.doc.initialCash);
  });

  it("a skipped MSI opening removes the plan; an edited one changes its price", () => {
    const tv: InstallmentPlanItem = {
      id: "tv",
      kind: "installment-plan",
      name: "TV 6 MSI",
      cardId: "fin-bbva", // paid on the 27th: only the opening (11-10) is in the past
      originalAmount: 6000,
      installmentsTotal: 6,
      installmentsPaid: 0,
      recurrence: { frequency: "monthly", startDate: "2026-11-10" },
    };
    const withTv = { ...doc, items: [...doc.items, tv] };
    const skipped = rollForward(withTv, "2026-11-20", { actuals: [{ eventId: "tv@2026-11-10", status: "skipped" }] });
    expect(skipped.doc.items.some((i) => i.id === "tv")).toBe(false);
    const edited = rollForward(withTv, "2026-11-20", {
      actuals: [{ eventId: "tv@2026-11-10", status: "edited", amount: 5400 }],
    });
    const plan = find(edited.doc, "tv", "installment-plan")!;
    expect(plan.originalAmount).toBe(5400);
    expect(plan.installmentsPaid).toBe(0);
    expect(debtByAccountAt(projectFinancialDocument(edited.doc), "2026-11-20").get("tv")).toBe(5400);
  });

  it("cashOverride replaces the computed cash and books the difference as an adjustment", () => {
    const computed = rollForward(doc, "2026-11-20").doc.initialCash;
    const { doc: rolled, ledger } = rollForward(doc, "2026-11-20", { cashOverride: 7000.004 });
    expect(rolled.initialCash).toBe(7000);
    expect(ledger.at(-1)).toEqual({
      eventId: "adjustment@2026-11-20",
      itemId: "",
      name: "Ajuste de efectivo",
      type: "expense",
      date: "2026-11-20",
      planned: 0,
      actual: 7000 - computed,
      status: "adjustment",
      plannedDebt: 0,
      actualDebt: 0,
    });
    expect(sum([doc.initialCash, ...ledger.map((e) => e.actual)])).toBe(7000);

    const up = rollForward(doc, "2026-11-20", { cashOverride: computed + 250 });
    expect(up.ledger.at(-1)).toMatchObject({ type: "income", actual: 250, status: "adjustment" });

    // Same cash, or a non-finite override: no adjustment entry.
    for (const cashOverride of [computed, Number.NaN]) {
      const same = rollForward(doc, "2026-11-20", { cashOverride });
      expect(same.doc.initialCash).toBe(computed);
      expect(same.ledger.some((e) => e.status === "adjustment")).toBe(false);
    }
  });
});

describe("rollForward — item lifecycle", () => {
  it("removes recurring items whose window ended and past disabled one-offs; keeps disabled debts untouched", () => {
    const doc = demo();
    const gym: FinancialItem = {
      id: "gym",
      kind: "expense",
      name: "Gym",
      amount: 600,
      recurrence: { frequency: "monthly", startDate: "2026-11-10", endDate: "2026-12-10" },
    };
    const mutedOnce: FinancialItem = {
      id: "muted",
      kind: "expense",
      name: "Muted",
      amount: 100,
      enabled: false,
      recurrence: { frequency: "once", startDate: "2026-11-12", endDate: "2026-11-12" },
    };
    const mutedCard: CreditCardItem = {
      id: "old-card",
      kind: "credit-card",
      name: "Old card",
      enabled: false,
      balance: 999,
      annualRate: 50,
      cutDay: 3,
      dueDay: 20,
      minimumPayment: 100,
      recurrence: { frequency: "monthly", startDate: START },
    };
    // Unknown fields (e.g. a future card setting) ride along.
    const nu = { ...(doc.items.find((i) => i.id === "fin-nu") as CreditCardItem), note: "x" };
    const items = doc.items.map((i) => (i.id === "fin-nu" ? nu : i));
    const input = { ...doc, items: [...items, gym, mutedOnce, mutedCard] };

    const mid = rollForward(input, "2026-12-01").doc;
    expect(find(mid, "gym", "expense")).toEqual(gym);
    expect(mid.items.some((i) => i.id === "muted")).toBe(false);
    expect(find(mid, "old-card", "credit-card")).toEqual(mutedCard);
    expect((find(mid, "fin-nu", "credit-card") as CreditCardItem & { note?: string }).note).toBe("x");

    const late = rollForward(input, "2026-12-11").doc;
    expect(late.items.some((i) => i.id === "gym")).toBe(false);
    expect(find(late, "old-card", "credit-card")).toEqual(mutedCard);
  });
});
