import { TimelineDocument, FinancialObject } from './types';

function toDateOnly(d: string | Date) {
  const dt = typeof d === 'string' ? new Date(d) : new Date(d);
  // normalize to start of day to avoid timezone drifts
  return new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
}

function occurrencesUpTo(item: FinancialObject, atDateStr: string): number {
  const start = toDateOnly(item.date);
  const at = toDateOnly(atDateStr);

  if (!item.recurrence) return start <= at ? 1 : 0;

  const rule = item.recurrence;
  let last = at;
  if (rule.until) {
    const untilDate = toDateOnly(rule.until);
    if (untilDate < last) last = untilDate;
  }

  if (last < start) return 0;

  const maxCount = rule.count ?? Infinity;
  let count = 0;
  let cur = new Date(start);
  const interval = rule.interval ?? 1;

  const MS_DAY = 24 * 60 * 60 * 1000;
  function addDays(d: Date, n: number) {
    return new Date(d.getTime() + n * MS_DAY);
  }
  function addMonths(d: Date, n: number) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + n;
    const newYear = y + Math.floor(m / 12);
    const newMonth = ((m % 12) + 12) % 12;
    const day = d.getUTCDate();
    const daysInTarget = new Date(Date.UTC(newYear, newMonth + 1, 0)).getUTCDate();
    const newDay = Math.min(day, daysInTarget);
    return new Date(Date.UTC(newYear, newMonth, newDay));
  }
  function addYears(d: Date, n: number) {
    return addMonths(d, n * 12);
  }

  while (cur <= last && count < maxCount) {
    count += 1;
    switch (rule.frequency) {
      case 'DAILY':
        cur = addDays(cur, interval);
        break;
      case 'WEEKLY':
        cur = addDays(cur, 7 * interval);
        break;
      case 'MONTHLY':
        cur = addMonths(cur, interval);
        break;
      case 'YEARLY':
        cur = addYears(cur, interval);
        break;
      default:
        // unknown frequency — break the loop
        cur = new Date(last.getTime() + 1);
    }
  }

  return count;
}

export function calculateBalanceAt(doc: TimelineDocument, atDateStr: string): number {
  const total = doc.items.reduce((acc, item) => {
    const occ = occurrencesUpTo(item, atDateStr);
    return acc + item.amount * occ;
  }, 0);
  return total;
}

export default calculateBalanceAt;
