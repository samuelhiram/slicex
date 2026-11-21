// Payoff estimate budget: the bridge recomputes it whenever a debt-related
// item changes (drag steps included), so a 360-month window on the demo
// document must stay well under a frame. Alone in its file so the
// measurement runs on a clean heap.
import { describe, expect, it } from "vitest";
import { addDays, createDemoFinancialDocument, estimateDebtPayoffs } from "../src/finance";
import type { FinancialDocument, FinancialItem } from "../src/finance";

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

function timeEstimate(doc: FinancialDocument, rounds: number): number {
  for (let i = 0; i < 30; i++) estimateDebtPayoffs(doc); // JIT warm-up (unmeasured)
  const samples: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const t = performance.now();
    estimateDebtPayoffs(doc);
    samples.push(performance.now() - t);
  }
  return median(samples);
}

describe("estimateDebtPayoffs budget", () => {
  it("demo document, 360-month window: < 1 ms (early exit at each payoff)", () => {
    const doc = createDemoFinancialDocument("2026-11-07");
    expect(estimateDebtPayoffs(doc).get("fin-bbva")!.payoffDate).not.toBeNull();
    const ms = timeEstimate(doc, 100);
    // Measured ≈ 0.08–0.13 ms (Nu 22 months, BBVA 49 months, loan, MSI).
    expect(ms, `demo ${ms.toFixed(3)} ms`).toBeLessThan(1);
  });

  it("worst case: cards that never pay off run the whole 360 months, still < 1 ms", () => {
    const base = createDemoFinancialDocument("2026-11-07");
    // Payments below the interest: both cards simulate every cut and due date for 30 years.
    const doc: FinancialDocument = {
      ...base,
      items: base.items.map((item): FinancialItem =>
        item.kind === "credit-card" ? { ...item, paymentAmount: 100 } : item,
      ),
    };
    const payoffs = estimateDebtPayoffs(doc);
    expect(payoffs.get("fin-nu")!.payoffDate).toBeNull();
    expect(payoffs.get("fin-bbva")!.payoffDate).toBeNull();
    const ms = timeEstimate(doc, 100);
    // Measured ≈ 0.2 ms (2 × 720 card events).
    expect(ms, `never-paid ${ms.toFixed(3)} ms`).toBeLessThan(1);
  });

  it("weekly purchases on a card over 30 years stay in the low milliseconds", () => {
    const base = createDemoFinancialDocument("2026-11-07");
    const items: FinancialItem[] = [...base.items];
    for (let i = 0; i < 20; i++) {
      items.push({
        id: `wk-${i}`,
        kind: "card-purchase",
        name: `Semanal ${i}`,
        cardId: i % 2 === 0 ? "fin-nu" : "fin-bbva",
        amount: 40 + i,
        recurrence: { frequency: "weekly", startDate: addDays(base.startDate, i) },
      });
    }
    const doc: FinancialDocument = { ...base, items };
    // Steady (open-ended) purchases keep the simulation running to the cap to check they stay covered.
    const ms = timeEstimate(doc, 30);
    // Measured ≈ 2–2.5 ms (≈ 31 k purchase events + cuts / payments, 23 sources).
    expect(ms, `weekly purchases ${ms.toFixed(3)} ms`).toBeLessThan(10);
  });
});
