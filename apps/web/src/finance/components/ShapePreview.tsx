// The item editor's shape preview: a small piece of timeline, on top of the
// form, with the item as the canvas draws it — its card (the kind's colour,
// a stripe, its name, amount and dates) from its start to its end (open-ended:
// fading out to the right; one date: as wide as its text), a mark on each
// payment, the months and "Hoy". Visual only (aria-hidden): the readback
// below says the same in words. Follows every keystroke.
//
// shapeModel is the pure part (the window, the card, the marks, the month
// lines as fractions of the strip); ShapePreview lays it out with the theme
// tokens (globals.css .fin-shape*).
import * as React from "react";
import {
  addDays,
  addMonths,
  diffDays,
  expandRecurrence,
  isISODate,
  type FinancialDocument,
  type FinancialItem,
  type FinancialRecurrence,
  type ISODate,
} from "@slicex/core";
import { describeItem, describePeriod } from "../financial-bridge";
import { isPointItem, itemColor } from "../mapping";
import { KIND_LABELS } from "../labels";
import { ItemIcon } from "./ItemIcon";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Most payment marks drawn (a long weekly window keeps every n-th). */
export const SHAPE_MAX_MARKS = 160;

export interface ShapeModel {
  /** First day of the strip and how many days it spans. */
  from: ISODate;
  days: number;
  /**
   * The card, as fractions of the strip (0..1); null when the dates are not
   * valid yet. `open`: no end (it runs out of the strip, fading); `point`:
   * one date (as wide as its text, from `left`).
   */
  card: { left: number; width: number; open: boolean; point: boolean } | null;
  /** Payment marks, fractions of the strip (each day's middle). */
  marks: number[];
  /** "Hoy", a fraction of the strip, or null when out of it. */
  today: number | null;
  /** Month (or year) lines with their labels, fractions of the strip. */
  ticks: { at: number; label: string }[];
}

/** Days between two payments of the rule (a month ≈ 30). 0: once. */
function stepDays(rule: FinancialRecurrence): number {
  const every = Math.max(1, Math.floor(rule.interval ?? 1));
  switch (rule.frequency) {
    case "daily":
      return every;
    case "weekly":
      return 7;
    case "biweekly":
      return 14;
    case "semimonthly":
      return 15;
    case "monthly":
      return 30 * every;
    default:
      return 0;
  }
}

const yearOf = (date: ISODate): number => Number(date.slice(0, 4));
const monthOf = (date: ISODate): number => Number(date.slice(5, 7));

/** Px a month label takes per character (10.5 px semibold), and its left pad. */
const LABEL_CHAR_PX = 6.6;
const LABEL_PAD_PX = 8;

function monthTicks(from: ISODate, days: number, widthPx: number): { at: number; label: string }[] {
  const out: { at: number; label: string }[] = [];
  const yearly = days > 540;
  const labelPx = (label: string): number => LABEL_PAD_PX + label.length * LABEL_CHAR_PX;
  // Room for `label` at `at` after the previous label, and before the right
  // edge (the strip's px when known; fractions of it otherwise).
  let last = { at: 0, label: "" };
  const fits = (at: number, label: string): boolean =>
    widthPx > 0
      ? (at - last.at) * widthPx >= labelPx(last.label) + 6 && at * widthPx + labelPx(label) <= widthPx
      : at - last.at >= (yearly ? 0.08 : 0.1) && at <= 0.94;
  // The strip's own month (or year) first, at its left edge.
  last = { at: 0, label: yearly ? String(yearOf(from)) : `${MONTHS[monthOf(from) - 1]} ${yearOf(from)}` };
  out.push(last);
  let line = addMonths(`${from.slice(0, 7)}-01`, 1);
  for (let guard = 0; guard < 200; guard++) {
    const offset = diffDays(from, line);
    if (offset >= days) break;
    const month = monthOf(line);
    if (!yearly || month === 1) {
      const at = offset / days;
      const text = yearly ? String(yearOf(line)) : month === 1 ? `ene ${yearOf(line)}` : MONTHS[month - 1]!;
      // A label without room stays a bare line.
      const label = fits(at, text) ? text : "";
      out.push({ at, label });
      if (label) last = { at, label };
    }
    line = addMonths(line, 1);
  }
  return out;
}

/**
 * The strip for `item`: a window around its dates (some room before its
 * start; after its end, or several payments of an open-ended one; a month
 * around a one-time date), its card and its payment marks within it.
 * `widthPx`: the strip's width, for the month labels' room (0: unknown).
 */
export function shapeModel(item: FinancialItem, today: ISODate, widthPx = 0): ShapeModel {
  const rule = item.recurrence;
  const start = rule.startDate;
  if (!isISODate(start)) {
    const from = addDays(today, -7);
    return { from, days: 60, card: null, marks: [], today: 7.5 / 60, ticks: monthTicks(from, 60, widthPx) };
  }
  const point = isPointItem(item);
  const end = !point && rule.endDate !== undefined && isISODate(rule.endDate) && rule.endDate >= start ? rule.endDate : null;
  const step = stepDays(rule);
  let from: ISODate;
  let days: number;
  if (point) {
    const date = rule.anchorDate !== undefined && isISODate(rule.anchorDate) ? rule.anchorDate : start;
    from = addDays(date, -9);
    days = 32;
  } else if (end !== null) {
    const length = diffDays(start, end) + 1;
    const pad = Math.max(3, Math.round(Math.max(length, 2 * step) * 0.12));
    from = addDays(start, -pad);
    days = Math.max(length + 2 * pad, 24);
  } else {
    const reach = Math.max(5 * step, 42);
    const pad = Math.max(3, Math.round(reach * 0.12));
    from = addDays(start, -pad);
    days = reach + pad;
  }
  const at = (date: ISODate): number => (diffDays(from, date) + 0.5) / days;

  let card: ShapeModel["card"];
  if (point) {
    card = { left: diffDays(from, rule.anchorDate ?? start) / days, width: 0, open: false, point: true };
  } else {
    const left = diffDays(from, start) / days;
    const width = end !== null ? (diffDays(start, end) + 1) / days : 1 - left;
    card = { left, width, open: end === null, point: false };
  }

  const last = addDays(from, days - 1);
  const dates = expandRecurrence(rule, { from: start > from ? start : from, to: last });
  const stride = Math.max(1, Math.ceil(dates.length / SHAPE_MAX_MARKS));
  const marks: number[] = [];
  for (let i = 0; i < dates.length; i += stride) marks.push(at(dates[i]!));

  const todayAt = today >= from && today <= last ? at(today) : null;
  return { from, days, card, marks, today: todayAt, ticks: monthTicks(from, days, widthPx) };
}

const pct = (fraction: number): string => `${(fraction * 100).toFixed(3)}%`;

/**
 * The strip for the form's item (null: nothing to draw). `doc` gives the
 * amount line the canvas card shows ("−$1,850 /semana").
 */
export function ShapePreview({
  item,
  doc,
  today,
}: {
  item: FinancialItem | null;
  doc: FinancialDocument;
  today: ISODate;
}) {
  // Rebuilt every render by the form: its values are the key.
  const key = item ? JSON.stringify(item) : "";
  // The strip's width (the month labels' room), followed on resize.
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = React.useState(0);
  React.useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const measure = (): void => setWidthPx(Math.round(strip.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [item !== null]);
  const model = React.useMemo(() => {
    if (!item) return null;
    try {
      return shapeModel(item, today, widthPx);
    } catch {
      return null;
    }
  }, [key, today, widthPx]);
  const detail = React.useMemo(() => {
    if (!item) return "";
    try {
      return describeItem(item, doc);
    } catch {
      return "";
    }
  }, [key, doc]);
  // The dates, as the canvas card's third row ("21 nov 2026 – Indefinido").
  const period = React.useMemo(() => {
    if (!item || !isISODate(item.recurrence.startDate)) return "";
    try {
      return describePeriod(item);
    } catch {
      return "";
    }
  }, [key]);
  if (!item || !model) return null;
  const card = model.card;
  const color = itemColor(item);
  return (
    <div
      ref={stripRef}
      className="fin-shape"
      aria-hidden="true"
      data-kind={item.kind}
      style={{ "--clip-color": color } as React.CSSProperties}
    >
      <div className="fin-shape__ruler">
        {model.ticks.map((tick) =>
          tick.label ? (
            <span key={tick.at} className="fin-shape__month" style={{ left: pct(tick.at) }}>
              {tick.label}
            </span>
          ) : null,
        )}
      </div>
      <div className="fin-shape__lane">
        {model.ticks.map((tick) =>
          tick.at > 0 ? <i key={tick.at} className="fin-shape__line" style={{ left: pct(tick.at) }} /> : null,
        )}
        {card ? (
          <div
            className="fin-shape__card"
            data-open={card.open ? "true" : undefined}
            data-point={card.point ? "true" : undefined}
            data-muted={item.enabled === false ? "true" : undefined}
            style={card.point ? { left: pct(card.left) } : { left: pct(card.left), width: pct(card.width) }}
          >
            <span className="fin-shape__title">
              <ItemIcon id={item.icon} size={12} className="fin-shape__icon" />
              {item.name.trim() || KIND_LABELS[item.kind]}
            </span>
            {detail ? <span className="fin-shape__detail">{detail}</span> : null}
            {period ? <span className="fin-shape__period">{period}</span> : null}
            {/* Inside the card (an open card's fade takes them too); a
                one-date card is its own mark. */}
            {!card.point && card.width > 0
              ? model.marks.map((mark, index) => (
                  <i
                    key={index}
                    className="fin-shape__mark"
                    style={{ left: pct((mark - card.left) / card.width) }}
                  />
                ))
              : null}
          </div>
        ) : null}
      </div>
      {model.today !== null ? <i className="fin-shape__today" style={{ left: pct(model.today) }} /> : null}
    </div>
  );
}
