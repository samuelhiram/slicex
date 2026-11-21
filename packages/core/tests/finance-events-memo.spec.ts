// Incremental expansion (per-item memo + bucket merge): equivalence with the
// plain reference algorithm and identity of untouched items' events. The
// re-projection budget lives in finance-perf.spec.ts (own worker, clean heap).
import { describe, expect, it } from "vitest";
import {
  addDays,
  buildProjectionAccounts,
  createDemoFinancialDocument,
  expandFinancialEvents,
  getProjectionRange,
  projectFinancialDocument,
  projectFinancialTimeline,
} from "../src/finance";
import type {
  CreditCardItem,
  FinancialDocument,
  FinancialEvent,
  FinancialItem,
  FinancialRecurrence,
  ISODate,
  InstallmentPlanItem,
} from "../src/finance";
import { expandFinancialEventsUncached } from "../src/finance/events";

const START = "2026-11-01";

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

function money(rng: Rng): number {
  const r = rng();
  if (r < 0.03) return 0;
  if (r < 0.05) return -50;
  return Math.round(rng() * 500000) / 100;
}

const FREQUENCIES = ["once", "weekly", "biweekly", "semimonthly", "monthly"] as const;
const CARD_IDS = ["card-0", "card-1", "card-2", "ghost"] as const;

function randomRecurrence(rng: Rng, start: ISODate): FinancialRecurrence {
  const frequency = pick(rng, FREQUENCIES);
  const startDate = addDays(start, int(rng, -90, 420));
  const rec: FinancialRecurrence = { frequency, startDate };
  if (frequency === "once") {
    if (rng() < 0.8) rec.endDate = startDate;
  } else if (rng() < 0.4) {
    rec.endDate = addDays(startDate, int(rng, -5, 300));
  }
  if (rng() < 0.3) rec.anchorDate = addDays(startDate, int(rng, -40, 40));
  return rec;
}

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

function randomItem(rng: Rng, id: string, start: ISODate): FinancialItem {
  const r = rng();
  const recurrence = randomRecurrence(rng, start);
  const name = `n${int(rng, 0, 9)}`;
  if (r < 0.25) return { id, kind: "income", name, amount: money(rng), recurrence };
  if (r < 0.45) return { id, kind: "expense", name, amount: money(rng), recurrence };
  if (r < 0.55) return { id, kind: "loan", name, paymentAmount: money(rng), recurrence };
  if (r < 0.65) {
    return { id, kind: "card-purchase", name, cardId: pick(rng, [...CARD_IDS, ""]), amount: money(rng), recurrence };
  }
  if (r < 0.85) {
    const plan: InstallmentPlanItem = {
      id,
      kind: "installment-plan",
      name,
      originalAmount: money(rng) * 3,
      installmentsTotal: pick(rng, [0, 3, 6, 12, 18]),
      installmentsPaid: int(rng, 0, 6),
      recurrence: { ...recurrence, frequency: "monthly" },
    };
    const cardId = pick(rng, [...CARD_IDS, undefined, ""]);
    if (cardId !== undefined) plan.cardId = cardId;
    return plan;
  }
  const c: CreditCardItem = {
    ...card(id, int(rng, 1, 31), int(rng, 1, 31)),
    name,
    balance: money(rng),
    minimumPayment: money(rng) / 10,
    recurrence,
  };
  if (rng() < 0.5) c.paymentAmount = money(rng) / 5;
  return c;
}

/** Random document: 3 document cards (one shadowed by a later duplicate id), duplicate item ids, disabled items. */
function randomDoc(rng: Rng, n: number): FinancialDocument {
  const items: FinancialItem[] = [card("card-0", 5, 20), card("card-1", 12, 2), card("card-2", 28, 28)];
  for (let i = 0; items.length < n; i++) {
    const id = rng() < 0.05 ? `dup-${int(rng, 0, 2)}` : `it-${i}`;
    const item = randomItem(rng, id, START);
    if (rng() < 0.05) item.enabled = false;
    items.push(item);
  }
  items.push(card("card-1", 1, 31)); // shadowed: MSI plans pay on the first "card-1"
  return { id: "rand", name: "rand", startDate: START, initialCash: 10000, minimumCashReserve: 0, horizonMonths: 12, items };
}

function withItem(item: FinancialItem, over: Partial<FinancialItem>): FinancialItem {
  return { ...item, ...over } as FinancialItem;
}

/** One random edit. Mostly immutable (new item objects), sometimes in place. */
function randomEdit(rng: Rng, doc: FinancialDocument, serial: number): FinancialDocument {
  const items = doc.items.slice();
  const k = int(rng, 0, items.length - 1);
  const item = items[k]!;
  const rec = item.recurrence;
  switch (int(rng, 0, 13)) {
    case 0:
      items[k] = withItem(item, { name: `renamed-${serial}` });
      break;
    case 1: {
      const d = int(rng, -20, 20);
      const shifted: FinancialRecurrence = { ...rec, startDate: addDays(rec.startDate, d) };
      if (rec.endDate !== undefined) shifted.endDate = addDays(rec.endDate, d);
      if (rec.anchorDate !== undefined) shifted.anchorDate = addDays(rec.anchorDate, d);
      items[k] = withItem(item, { recurrence: shifted });
      break;
    }
    case 2: {
      const cropped: FinancialRecurrence = { ...rec };
      if (rng() < 0.5) delete cropped.endDate;
      else cropped.endDate = addDays(rec.startDate, int(rng, 0, 200));
      items[k] = withItem(item, { recurrence: cropped });
      break;
    }
    case 3:
      items[k] = withItem(item, { recurrence: { ...rec, frequency: pick(rng, FREQUENCIES) } });
      break;
    case 4:
      items[k] = withItem(item, { enabled: item.enabled === false });
      break;
    case 5: {
      // A document card's dueDay / cutDay: every MSI plan on it moves.
      const ci = items.findIndex((it) => it.kind === "credit-card" && it.id === pick(rng, CARD_IDS));
      if (ci >= 0) {
        const c = items[ci] as CreditCardItem;
        items[ci] = rng() < 0.6 ? { ...c, dueDay: int(rng, 1, 31) } : { ...c, cutDay: int(rng, 1, 31), name: `c${serial}` };
      }
      break;
    }
    case 6:
      items.splice(k, 0, randomItem(rng, `new-${serial}`, doc.startDate));
      break;
    case 7:
      items.splice(k, 1);
      break;
    case 8: {
      const [moved] = items.splice(k, 1);
      items.splice(int(rng, 0, items.length), 0, moved!);
      break;
    }
    case 9:
      // The SAME object twice (its events are emitted twice, "#2" ids).
      items.splice(int(rng, 0, items.length), 0, item);
      break;
    case 10:
      // In-place mutation: same object, different inputs.
      if (rng() < 0.5) rec.startDate = addDays(rec.startDate, int(rng, -10, 10));
      else if (item.kind === "credit-card") item.dueDay = int(rng, 1, 31);
      else if (item.kind === "loan") item.paymentAmount = money(rng);
      else if (item.kind === "installment-plan") item.installmentsPaid = int(rng, 0, 6);
      else item.amount = money(rng);
      break;
    case 11:
      // Id collision with another item.
      items[k] = withItem(item, { id: items[int(rng, 0, items.length - 1)]!.id });
      break;
    case 12:
      return { ...doc, items, startDate: addDays(doc.startDate, int(rng, -15, 15)) };
    default:
      return { ...doc, items, horizonMonths: int(rng, 1, 18) };
  }
  return { ...doc, items };
}

/** Byte-identical comparison (JSON keeps key order) plus a structural one. */
function expectSameEvents(actual: FinancialEvent[], expected: FinancialEvent[]): void {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
  expect(actual).toEqual(expected);
}

describe("expandFinancialEvents — memoised path equals the reference algorithm", () => {
  it("matches the cache-bypassed expansion across 160 random edits of a 300-item document", () => {
    const rng = mulberry32(20261107);
    let doc = randomDoc(rng, 300);
    for (let step = 0; step < 160; step++) {
      doc = randomEdit(rng, doc, step);
      expectSameEvents(expandFinancialEvents(doc), expandFinancialEventsUncached(doc));
      if (step % 8 === 0) {
        const range = { from: addDays(doc.startDate, int(rng, -40, 40)), to: addDays(doc.startDate, int(rng, 30, 500)) };
        expectSameEvents(expandFinancialEvents(doc, range), expandFinancialEventsUncached(doc, range));
        // The default range again (entries were rebuilt for the custom one).
        expectSameEvents(expandFinancialEvents(doc), expandFinancialEventsUncached(doc));
      }
      if (step % 16 === 0) {
        const range = getProjectionRange(doc);
        expect(projectFinancialDocument(doc)).toEqual(
          projectFinancialTimeline({
            initialCash: doc.initialCash,
            events: expandFinancialEventsUncached(doc, range),
            startDate: range.from,
            endDate: range.to,
            accounts: buildProjectionAccounts(doc, range),
          }),
        );
      }
    }
    // Correctness fuzz, not a perf budget: the cost is the deliberately
    // slow cache-bypassed REFERENCE expansion recomputed 160 times (~3 s
    // alone, >5 s under the parallel full suite). The memoised path's speed
    // is budgeted separately in finance-perf.spec.ts.
  }, 30_000);

  it("recounts '#n' ids across items that share an id (and the same object listed twice)", () => {
    const day = "2026-11-10";
    const a: FinancialItem = { id: "x", kind: "expense", name: "a", amount: 10, recurrence: { frequency: "once", startDate: day } };
    const b: FinancialItem = { id: "x", kind: "income", name: "b", amount: 20, recurrence: { frequency: "monthly", startDate: day } };
    const doc: FinancialDocument = {
      id: "d",
      name: "d",
      startDate: START,
      initialCash: 0,
      minimumCashReserve: 0,
      horizonMonths: 2,
      items: [a, b, a],
    };
    const events = expandFinancialEvents(doc);
    expectSameEvents(events, expandFinancialEventsUncached(doc));
    expect(events.filter((e) => e.date === day).map((e) => e.id)).toEqual(["x@2026-11-10", "x@2026-11-10#2", "x@2026-11-10#3"]);
    // Alone, `a` keeps its plain id: the shared-id renumbering never leaked into its cached events.
    expect(expandFinancialEvents({ ...doc, items: [a] }).map((e) => e.id)).toEqual(["x@2026-11-10"]);
  });

  it("falls back to a comparison sort for a malformed or huge range, with the same output", () => {
    const future: InstallmentPlanItem = {
      id: "msi",
      kind: "installment-plan",
      name: "msi",
      originalAmount: 600,
      installmentsTotal: 6,
      installmentsPaid: 0,
      recurrence: { frequency: "monthly", startDate: "2026-12-05" },
    };
    const items: FinancialItem[] = [
      future,
      { id: "o1", kind: "expense", name: "o1", amount: 5, recurrence: { frequency: "once", startDate: "2027-03-01" } },
      { id: "o2", kind: "income", name: "o2", amount: 7, recurrence: { frequency: "once", startDate: "2027-03-01" } },
    ];
    const doc: FinancialDocument = { id: "d", name: "d", startDate: START, initialCash: 0, minimumCashReserve: 0, horizonMonths: 12, items };
    const malformed = { from: START, to: "zzzz" };
    const onlyOpening = expandFinancialEvents(doc, malformed);
    expect(onlyOpening.map((e) => e.type)).toEqual(["debt-opening"]);
    expectSameEvents(onlyOpening, expandFinancialEventsUncached(doc, malformed));
    const huge = { from: START, to: "9999-12-31" };
    expectSameEvents(
      expandFinancialEvents({ ...doc, items: items.slice(1) }, huge),
      expandFinancialEventsUncached({ ...doc, items: items.slice(1) }, huge),
    );
  });
});

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

function eventsByItem(events: FinancialEvent[]): Map<string, FinancialEvent[]> {
  const out = new Map<string, FinancialEvent[]>();
  for (const e of events) {
    const list = out.get(e.itemId);
    if (list) list.push(e);
    else out.set(e.itemId, [e]);
  }
  return out;
}

/** Item ids whose events are not the very same objects as before. */
function reExpandedItems(before: FinancialEvent[], after: FinancialEvent[]): string[] {
  const prev = eventsByItem(before);
  const changed: string[] = [];
  for (const [itemId, list] of eventsByItem(after)) {
    const old = prev.get(itemId);
    if (!old || old.length !== list.length || list.some((e, i) => e !== old[i])) changed.push(itemId);
  }
  return changed;
}

function replaceItem(doc: FinancialDocument, id: string, over: Partial<FinancialItem>): FinancialDocument {
  return { ...doc, items: doc.items.map((it) => (it.id === id ? withItem(it, over) : it)) };
}

describe("expandFinancialEvents — editing one item re-expands only that item", () => {
  const doc = generatedDoc(300);

  it("keeps every other item's event objects and changes only the edited item's events", () => {
    const before = expandFinancialEvents(doc);
    const target = doc.items.find((it) => it.id === "inc-8")!;
    const edited = replaceItem(doc, "inc-8", {
      recurrence: { ...target.recurrence, startDate: addDays(target.recurrence.startDate, 1) },
    });
    const after = expandFinancialEvents(edited);
    expect(reExpandedItems(before, after)).toEqual(["inc-8"]);
    expectSameEvents(after, expandFinancialEventsUncached(edited));
    const oldDates = before.filter((e) => e.itemId === "inc-8").map((e) => e.date);
    const newDates = after.filter((e) => e.itemId === "inc-8").map((e) => e.date);
    expect(newDates).not.toEqual(oldDates);
    // Every other item's events are untouched, in content and in identity.
    const others = (list: FinancialEvent[]) => list.filter((e) => e.itemId !== "inc-8");
    expect(others(after)).toHaveLength(others(before).length);
    expect(others(after).every((e, i) => e === others(before)[i])).toBe(true);
  });

  it("re-expands MSI plans when their card's dueDay changes, not when only its name changes", () => {
    const before = expandFinancialEvents(doc);
    const renamed = expandFinancialEvents(replaceItem(doc, "fin-bbva", { name: "BBVA Oro" }));
    expect(reExpandedItems(before, renamed)).toEqual(["fin-bbva"]);
    const dueMoved = replaceItem(doc, "fin-bbva", { dueDay: 3 } as Partial<FinancialItem>);
    const moved = expandFinancialEvents(dueMoved);
    const onBbva = doc.items
      .filter((it) => it.kind === "installment-plan" && it.cardId === "fin-bbva")
      .map((it) => it.id);
    expect(onBbva.length).toBeGreaterThan(1);
    expect(reExpandedItems(before, moved).sort()).toEqual(["fin-bbva", ...onBbva].sort());
    expectSameEvents(moved, expandFinancialEventsUncached(dueMoved));
  });

  it("re-expands an item mutated in place (same object, different inputs)", () => {
    const local = generatedDoc(40);
    const before = expandFinancialEvents(local);
    const item = local.items.find((it) => it.id === "wk-9")!;
    if (item.kind !== "expense") throw new Error("fixture");
    item.amount = 777;
    const after = expandFinancialEvents(local);
    expect(reExpandedItems(before, after)).toEqual(["wk-9"]);
    expect(after.filter((e) => e.itemId === "wk-9").every((e) => e.amount === 777)).toBe(true);
    expectSameEvents(after, expandFinancialEventsUncached(local));
  });

  it("never hands out a mutable cached array or event", () => {
    const first = expandFinancialEvents(doc);
    const second = expandFinancialEvents(doc);
    expect(second).not.toBe(first);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(() => {
      (first[0] as { amount: number }).amount = 1;
    }).toThrow(TypeError);
    first.length = 0;
    second.reverse();
    expectSameEvents(expandFinancialEvents(doc), expandFinancialEventsUncached(doc));
  });
});

describe("projectFinancialTimeline — date validation once per distinct date", () => {
  it("still skips a malformed date between valid ones", () => {
    const ev = (id: string, date: ISODate, amount: number): FinancialEvent => ({
      id: `${id}@${date}`,
      itemId: id,
      type: "income",
      date,
      amount,
      name: id,
    });
    const p = projectFinancialTimeline({
      initialCash: 0,
      events: [ev("a", "2026-11-05", 1), ev("b", "2026-11-05", 2), ev("x", "2026-11-05x", 100), ev("c", "2026-11-06", 4)],
      startDate: START,
      endDate: "2026-12-01",
    });
    expect(p.points.map((pt) => pt.itemId)).toEqual(["a", "b", "c"]);
    expect(p.finalCash).toBe(7);
  });
});
