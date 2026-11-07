// Re-projection budget of the financial bridge's drag step: with the per-item
// expansion memo, re-projecting a big document after changing ONE item must
// cost a fraction of a cold projection (perf canon §5). Alone in its file so
// the measurement runs on a clean heap.
import { describe, expect, it } from "vitest";
import { addDays, createDemoFinancialDocument, projectFinancialDocument } from "../src/finance";
import type { CreditCardItem, FinancialDocument, FinancialItem } from "../src/finance";

const START = "2026-11-01";

function card(id: string, cutDay: number, dueDay: number): CreditCardItem {
  return {
    id,
    kind: "credit-card",
    name: id,
    balance: 5000,
    annualRate: 45,
    cutDay,
    dueDay,
    minimumPayment: 400,
    recurrence: { frequency: "monthly", startDate: START },
  };
}

function withItem(item: FinancialItem, over: Partial<FinancialItem>): FinancialItem {
  return { ...item, ...over } as FinancialItem;
}

/** Demo document plus generated items of every kind (distinct ids) up to `n` items. */
function generatedDoc(n: number): FinancialDocument {
  const doc = createDemoFinancialDocument("2026-11-07");
  const items: FinancialItem[] = [...doc.items];
  for (let i = 0; items.length < n; i++) {
    const d = addDays(doc.startDate, i % 300);
    switch (i % 8) {
      case 0:
        items.push({ id: `inc-${i}`, kind: "income", name: `Ingreso ${i}`, amount: 1000 + i, recurrence: { frequency: "semimonthly", startDate: d } });
        break;
      case 1:
        items.push({ id: `wk-${i}`, kind: "expense", name: `Semanal ${i}`, amount: 50 + i, recurrence: { frequency: "weekly", startDate: doc.startDate, anchorDate: d } });
        break;
      case 2:
        items.push({ id: `bw-${i}`, kind: "expense", name: `Catorcenal ${i}`, amount: 80 + i, recurrence: { frequency: "biweekly", startDate: d } });
        break;
      case 3:
        items.push({ id: `cp-${i}`, kind: "card-purchase", name: `Compra ${i}`, cardId: "fin-nu", amount: 300 + i, recurrence: { frequency: "monthly", startDate: d } });
        break;
      case 4:
        items.push({
          id: `msi-${i}`,
          kind: "installment-plan",
          name: `MSI ${i}`,
          cardId: i % 16 === 4 ? "fin-bbva" : "fin-nu",
          originalAmount: 6000 + i,
          installmentsTotal: 12,
          installmentsPaid: 0,
          recurrence: { frequency: "monthly", startDate: d },
        });
        break;
      case 5:
        items.push({ ...card(`cc-${i}`, (i % 28) + 1, ((i + 10) % 28) + 1), name: `Card ${i}`, recurrence: { frequency: "monthly", startDate: doc.startDate } });
        break;
      case 6:
        items.push({ id: `wi-${i}`, kind: "income", name: `Propina ${i}`, amount: 120 + i, recurrence: { frequency: "weekly", startDate: d } });
        break;
      default:
        items.push({ id: `ln-${i}`, kind: "loan", name: `Loan ${i}`, paymentAmount: 500 + i, recurrence: { frequency: "monthly", startDate: d, endDate: addDays(d, 400) } });
        break;
    }
  }
  return { ...doc, items };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

function cloneDoc(doc: FinancialDocument): FinancialDocument {
  return { ...doc, items: doc.items.map((it) => ({ ...it, recurrence: { ...it.recurrence } }) as FinancialItem) };
}

describe("projection budget (financial bridge drag step)", () => {
  it("re-projecting a 600-item document after changing ONE item costs < 40% of a cold projection", () => {
    const base = generatedDoc(600);
    const recurring = base.items.filter((it) => it.recurrence.frequency !== "once").map((it) => it.id);
    // One snapped drag step: the dragged item is a new object, every other item keeps its identity.
    const dragStep = (doc: FinancialDocument, round: number): FinancialDocument => {
      const id = recurring[(round * 37) % recurring.length]!;
      return {
        ...doc,
        items: doc.items.map((it) =>
          it.id === id ? withItem(it, { recurrence: { ...it.recurrence, startDate: addDays(it.recurrence.startDate, 1) } }) : it,
        ),
      };
    };
    const project = (doc: FinancialDocument): number => {
      const t = performance.now();
      const p = projectFinancialDocument(doc);
      const ms = performance.now() - t;
      expect(p.points.length).toBeGreaterThan(10000);
      return ms;
    };
    // JIT warm-up (unmeasured): two cold projections and a few drag steps.
    project(cloneDoc(base));
    let doc = cloneDoc(base);
    project(doc);
    for (let step = 0; step < 6; step++) project((doc = dragStep(doc, step)));
    // A drag: consecutive snapped steps, each one re-projects the whole document.
    const warm: number[] = [];
    for (let step = 6; step < 46; step++) warm.push(project((doc = dragStep(doc, step))));
    // Cold: fresh item objects, nothing memoised.
    const cold: number[] = [];
    for (let round = 0; round < 10; round++) cold.push(project(cloneDoc(base)));
    const warmMs = median(warm);
    const coldMs = median(cold);
    // Measured (11.8k points): cold ≈ 15 ms, drag step ≈ 3 ms; before the memo both were ≈ 22 ms.
    expect(warmMs / coldMs, `drag step ${warmMs.toFixed(2)} ms vs cold ${coldMs.toFixed(2)} ms`).toBeLessThan(0.4);
  });
});
