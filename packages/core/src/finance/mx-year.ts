// The Mexican year, pre-loaded as suggestions: dated one-off incomes and
// expenses every household in Mexico meets (aguinaldo, Buen Fin, predial…),
// ready to add to the plan. Pure: the dates come from the document range.
import { dayNumberFromParts, formatISODate, isISODate, parseISODate } from "./dates";
import { getProjectionRange } from "./events";
import type { FinancialDocument, FinancialItem, ISODate, RecurrenceFrequency } from "./types";

export interface YearSuggestion {
  /** Stable: `sug-<slug>-<year>`, e.g. `sug-aguinaldo-2026`. Also the draft item id. */
  id: string;
  /** Spanish, e.g. "Aguinaldo". Also the draft item name. */
  title: string;
  /** One short sentence in Spanish explaining the amount / date. */
  why: string;
  category: "income" | "expense";
  /** A draft one-off item (id = suggestion id) ready to add. */
  item: FinancialItem;
}

/** Monthly-equivalent factor per recurring frequency ("once" is not a salary). */
const MONTHLY_FACTOR: Partial<Record<RecurrenceFrequency, number>> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  semimonthly: 2,
  monthly: 1,
};

/**
 * Monthly-equivalent amount of the main salary: the enabled recurring income
 * with the biggest one (semimonthly ×2, biweekly ×26/12, weekly ×52/12,
 * monthly ×1), ignoring incomes whose window ended before the document start.
 * 0 when there is none.
 */
function mainMonthlySalary(doc: FinancialDocument): number {
  let best = 0;
  for (const item of doc.items) {
    if (item.kind !== "income" || item.enabled === false) continue;
    const factor = MONTHLY_FACTOR[item.recurrence.frequency];
    if (factor === undefined) continue;
    const end = item.recurrence.endDate;
    if (end !== undefined && end < doc.startDate) continue;
    if (!Number.isFinite(item.amount) || item.amount <= 0) continue;
    const monthly = item.amount * factor;
    if (monthly > best) best = monthly;
  }
  return best;
}

/** Lower case, accents stripped ("Útiles" → "utiles"). */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** First date ≥ `from` produced by `dateIn(year)` (this year or the next), if ≤ `to`. */
function nextInRange(range: { from: ISODate; to: ISODate }, dateIn: (year: number) => ISODate): ISODate | null {
  const year = parseISODate(range.from)[0];
  let date = dateIn(year);
  if (date < range.from) date = dateIn(year + 1);
  return date <= range.to ? date : null;
}

/**
 * Friday of the Buen Fin: the Friday before the third Monday of November
 * (the long weekend of the Revolution Day holiday the campaign is pinned to:
 * 2023-11-17, 2024-11-15, 2025-11-14, 2026-11-13).
 */
function buenFinFriday(year: number): ISODate {
  // 1970-01-01 (day 0) was a Thursday: weekday = (day + 4) mod 7, Sunday = 0.
  const nov1 = dayNumberFromParts(year, 11, 1);
  const weekday = (((nov1 + 4) % 7) + 7) % 7;
  const firstMonday = 1 + ((8 - weekday) % 7);
  return formatISODate(year, 11, firstMonday + 14 - 3);
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

interface Candidate {
  slug: string;
  title: string;
  category: "income" | "expense";
  /** Folded substrings: an item whose folded name contains one already covers it. */
  keywords: string[];
  date: ISODate | null;
  amount: number;
  why: string;
}

/**
 * Suggestions for the Mexican year inside the projection range
 * [doc.startDate, projection end], each the NEXT occurrence in range, sorted
 * by date (then id). The main salary is the enabled recurring income with the
 * biggest monthly-equivalent amount.
 *
 * - Aguinaldo (income, 20 dic): 15 days of salary (monthly / 30 × 15, pesos).
 *   Only with a salary.
 * - Buen Fin (expense, Friday before the 3rd Monday of November): 10 % of the
 *   monthly salary rounded to 50 (≥ 50); 2 000 placeholder without a salary.
 * - Predial (expense, 31 ene): 1 500 placeholder.
 * - Regreso a clases (expense, 15 ago): 4 000 placeholder.
 * - Regalos de Navidad (expense, 15 dic): 20 % of the aguinaldo (pesos);
 *   3 000 placeholder without a salary.
 *
 * Left out on purpose (no amount can be justified from the plan): prima
 * vacacional, PTU, declaración anual (refund or payment).
 *
 * A suggestion is skipped when an item's name already contains one of its
 * keywords (case / accent-insensitive) or an item already has its id.
 * Returns [] for a malformed start date.
 */
export function suggestMexicanYear(doc: FinancialDocument): YearSuggestion[] {
  if (!isISODate(doc.startDate)) return [];
  const range = getProjectionRange(doc);
  if (!isISODate(range.to)) return [];

  const salary = mainMonthlySalary(doc);
  const aguinaldo = salary > 0 ? Math.round((salary / 30) * 15) : 0;
  const onDay = (month: number, day: number) => (year: number) => formatISODate(year, month, day);

  const candidates: Candidate[] = [];
  if (salary > 0) {
    candidates.push({
      slug: "aguinaldo",
      title: "Aguinaldo",
      category: "income",
      keywords: ["aguinaldo"],
      date: nextInRange(range, onDay(12, 20)),
      amount: aguinaldo,
      why: "Por ley, al menos 15 días de sueldo antes del 20 de diciembre",
    });
  }
  candidates.push(
    {
      slug: "buen-fin",
      title: "Buen Fin",
      category: "expense",
      keywords: ["buen fin"],
      date: nextInRange(range, buenFinFriday),
      amount: salary > 0 ? Math.max(50, roundTo(salary * 0.1, 50)) : 2000,
      why:
        salary > 0
          ? "Fin de semana de ofertas de noviembre: apartamos el 10 % de tu sueldo mensual"
          : "Fin de semana de ofertas de noviembre; el monto es un estimado que puedes editar",
    },
    {
      slug: "predial",
      title: "Predial",
      category: "expense",
      keywords: ["predial"],
      date: nextInRange(range, onDay(1, 31)),
      amount: 1500,
      why: "Impuesto anual de tu casa, con descuento si pagas en enero; 1 500 es un estimado editable",
    },
    {
      slug: "regreso-a-clases",
      title: "Regreso a clases",
      category: "expense",
      keywords: ["clases", "escolar", "utiles"],
      date: nextInRange(range, onDay(8, 15)),
      amount: 4000,
      why: "Útiles, uniformes y cuotas escolares; 4 000 es un estimado editable",
    },
    {
      slug: "regalos-navidad",
      title: "Regalos de Navidad",
      category: "expense",
      keywords: ["navidad"],
      date: nextInRange(range, onDay(12, 15)),
      amount: salary > 0 ? Math.round(aguinaldo * 0.2) : 3000,
      why:
        salary > 0
          ? "Regalos y cena de fin de año: el 20 % de tu aguinaldo"
          : "Regalos y cena de fin de año; el monto es un estimado editable",
    },
  );

  const names: string[] = [];
  const ids = new Set<string>();
  for (const item of doc.items) {
    names.push(fold(item.name ?? ""));
    ids.add(item.id);
  }

  const out: YearSuggestion[] = [];
  for (const c of candidates) {
    if (c.date === null || c.amount <= 0) continue;
    if (names.some((name) => c.keywords.some((keyword) => name.includes(keyword)))) continue;
    const id = `sug-${c.slug}-${c.date.slice(0, 4)}`;
    if (ids.has(id)) continue;
    out.push({
      id,
      title: c.title,
      why: c.why,
      category: c.category,
      item: {
        id,
        kind: c.category,
        name: c.title,
        amount: c.amount,
        recurrence: { frequency: "once", startDate: c.date, endDate: c.date },
      },
    });
  }
  out.sort((a, b) => {
    const da = a.item.recurrence.startDate;
    const db = b.item.recurrence.startDate;
    if (da !== db) return da < db ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}
