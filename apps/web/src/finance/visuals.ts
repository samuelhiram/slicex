// Pure builders for what the canvas draws about money: the cash waveform
// (overview lane), each clip's content, the effect of a gesture, track
// header meta and the playhead-aware clip detail. No caching here — the
// bridge caches per revision / playhead day and keeps object identity
// stable (the renderer repaints on reference change).
import {
  accountActivity,
  cardCycleDates,
  summarizeProjection,
  toDayNumber,
  type DebtPayoffEstimate,
  type FinancialDocument,
  type FinancialItem,
  type FinancialProjection,
  type ISODate,
  type LiquidityWarning,
} from "@slicex/core";
import type {
  PlaylistClipContent,
  PlaylistDragAnnotation,
  PlaylistOverviewAnnotation,
  PlaylistOverviewData,
  PlaylistStepSeries,
  PlaylistTrackMeta,
} from "@slicex/canvas";
import {
  formatDateShort,
  formatMoney,
  formatMoneyWhole,
  formatSignedMoneyWhole,
} from "./format";
import { derivedRowTitle, frequencyShort, KIND_ACCENT } from "./labels";
import { beatOf, horizonBeat, isPointItem } from "./mapping";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "AGO 2028" */
export function formatMonthYear(iso: ISODate): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`;
}

/** "$24k", "-$1.3k", "$1.2M", "$800" */
export function compactMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

/**
 * date → beat for a run over projection points. Points are sorted by date
 * and ~15k points share ~366 dates, so: reuse the previous answer when the
 * date repeats, memoise the rest. Never parses the same string twice.
 */
function beatResolver(doc: FinancialDocument): (date: ISODate) => number {
  const origin = toDayNumber(doc.startDate);
  const memo = new Map<string, number>();
  let lastDate = "";
  let lastBeat = 0;
  return (date) => {
    if (date === lastDate) return lastBeat;
    let beat = memo.get(date);
    if (beat === undefined) {
      beat = toDayNumber(date) - origin;
      memo.set(date, beat);
    }
    lastDate = date;
    lastBeat = beat;
    return beat;
  };
}

function isDebtKind(item: FinancialItem): boolean {
  return (
    item.kind === "credit-card" ||
    item.kind === "installment-plan" ||
    (item.kind === "loan" && item.balance !== undefined)
  );
}

// --- overview lane -------------------------------------------------------

function endOfDaySeries(
  doc: FinancialDocument,
  projection: FinancialProjection,
  initial: number,
  pick: (index: number) => number,
): PlaylistStepSeries {
  const beats: number[] = [];
  const values: number[] = [];
  const points = projection.points;
  const beatAt = beatResolver(doc);
  for (let i = 0; i < points.length; i += 1) {
    const beat = beatAt(points[i]!.date);
    const value = pick(i);
    if (beats.length > 0 && beats[beats.length - 1] === beat) {
      values[values.length - 1] = value;
    } else {
      beats.push(beat);
      values.push(value);
    }
  }
  return { initial, beats, values };
}

/**
 * Where inside its day an event / mark is drawn (beats): at the day's start,
 * on the same line as the playhead and the step of the cash curve.
 */
export const EVENT_DAY_OFFSET = 0;

/** Cash at the end of each day with events. */
export function cashSeries(
  doc: FinancialDocument,
  projection: FinancialProjection,
): PlaylistStepSeries {
  return endOfDaySeries(doc, projection, projection.initialCash, (i) => projection.points[i]!.cashAfter);
}

/** Total debt at the end of each day with events. */
export function debtSeries(
  doc: FinancialDocument,
  projection: FinancialProjection,
): PlaylistStepSeries {
  return endOfDaySeries(doc, projection, projection.initialDebt, (i) => projection.points[i]!.debtAfter);
}

// --- scale of the money lane ---------------------------------------------

/** Smallest 1 / 2 / 5 × 10^k at or above `value` (> 0). */
export function niceCeil(value: number): number {
  if (!(value > 0)) return 0;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 5, 10]) {
    if (step * power >= value - 1e-9) return step * power;
  }
  return 10 * power;
}

export interface OverviewDomain {
  min: number;
  max: number;
}

// Below this share of the current bound, the bound comes down a step.
const DOMAIN_SHRINK = 0.4;

/**
 * Bounds of the money lane in round steps, with hysteresis: the scale only
 * moves when the data leaves its step ("cambio de tramo") — it grows past
 * the bound, or falls under 40% of it. An edit far away no longer redraws
 * the rest of the year higher or lower.
 */
export function overviewDomain(
  dataMin: number,
  dataMax: number,
  previous: OverviewDomain | null,
): OverviewDomain {
  const bound = (value: number, prev: number | undefined): number => {
    // `value` and `prev` are magnitudes (≥ 0) on one side of zero.
    if (!(value > 0)) return prev !== undefined && prev > 0 && value > prev * DOMAIN_SHRINK ? prev : 0;
    if (prev !== undefined && prev > 0 && value <= prev && value >= prev * DOMAIN_SHRINK) return prev;
    return niceCeil(value);
  };
  const max = bound(Math.max(0, dataMax), previous ? previous.max : undefined);
  const min = -bound(Math.max(0, -dataMin), previous ? -previous.min : undefined);
  return { min: min === 0 ? 0 : min, max };
}

/**
 * Up to 4 round amounts to draw as labelled guides on a symlog lane: from
 * the top of the domain down, each far enough (in the lane's own scale)
 * from the others and from the reserve / zero lines.
 */
export function overviewGuides(domain: OverviewDomain, reserve: number, constant: number): number[] {
  const t = (value: number) =>
    value < 0 ? -Math.log1p(-value / constant) : Math.log1p(value / constant);
  const span = t(domain.max) - t(Math.min(0, domain.min));
  if (!(span > 0)) return [];
  const minGap = span / 7;
  const taken = [t(0), t(reserve)];
  const guides: number[] = [];
  const candidates: number[] = [];
  for (let power = 100; power <= domain.max * 10; power *= 10) {
    for (const step of [1, 2, 5]) {
      const value = step * power;
      if (value <= domain.max + 1e-9) candidates.push(value);
    }
  }
  candidates.sort((a, b) => b - a);
  for (const value of candidates) {
    if (guides.length >= 4) break;
    const y = t(value);
    if (taken.some((other) => Math.abs(other - y) < minGap)) continue;
    taken.push(y);
    guides.push(value);
  }
  return guides.sort((a, b) => a - b);
}

function seriesExtent(series: PlaylistStepSeries, acc: { min: number; max: number }): void {
  if (series.initial < acc.min) acc.min = series.initial;
  if (series.initial > acc.max) acc.max = series.initial;
  for (const value of series.values) {
    if (value < acc.min) acc.min = value;
    if (value > acc.max) acc.max = value;
  }
}

export function buildOverview(
  doc: FinancialDocument,
  projection: FinancialProjection,
  warnings: readonly LiquidityWarning[],
  baseline: PlaylistStepSeries | null,
  // The lane's previous bounds (hysteresis, see overviewDomain); null = fresh.
  previousDomain: OverviewDomain | null = null,
): PlaylistOverviewData {
  const reserve = doc.minimumCashReserve;
  const annotations: PlaylistOverviewAnnotation[] = warnings.map((warning) => ({
    beat: beatOf(doc, warning.date),
    value: warning.cash,
    label: `${formatMoneyWhole(warning.cash)} · ${formatDateShort(warning.date)}`,
    tone: warning.severity === "negative" ? "danger" : "warning",
  }));
  if (annotations.length === 0 && projection.points.length > 0) {
    const min = projection.minimumCash;
    annotations.push({
      beat: beatOf(doc, min.date),
      value: min.cash,
      label: `Mín ${formatMoneyWhole(min.cash)} · ${formatDateShort(min.date)}`,
      tone: "info",
    });
  }
  const primary = cashSeries(doc, projection);
  const extent = { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY };
  seriesExtent(primary, extent);
  if (baseline) seriesExtent(baseline, extent);
  const domain = overviewDomain(
    Number.isFinite(extent.min) ? extent.min : 0,
    Number.isFinite(extent.max) ? extent.max : 0,
    previousDomain,
  );
  const constant = Math.max(1000, reserve);
  return {
    title: "Caja",
    primary,
    secondary: debtSeries(doc, projection),
    baseline,
    thresholds: [
      { value: reserve, tone: "warning", label: `Reserva ${compactMoney(reserve)}` },
      { value: 0, tone: "danger" },
    ],
    annotations,
    formatValue: compactMoney,
    // Detail near the reserve and the valleys matters more than the size
    // of the year-end pile: log beyond ~the reserve. Round guides make
    // the non-linear scale readable; the bounds move only by steps.
    scale: { kind: "symlog", constant },
    domain,
    guides: overviewGuides(domain, reserve, constant),
    endBeat: horizonBeat(doc),
  };
}

// --- gesture effect ------------------------------------------------------

export interface DragAnnotationOptions {
  /**
   * The gesture changes a debt: also say what happens to the debt and its
   * interest, and judge the tone by the net (cash − debt), so paying a debt
   * off sooner never reads as a loss.
   */
  debt?: boolean;
  /** Interest of the debts after − before (negative = saved). */
  interestDelta?: number;
}

export function dragAnnotation(
  doc: FinancialDocument,
  base: FinancialProjection,
  current: FinancialProjection,
  options: DragAnnotationOptions = {},
): PlaylistDragAnnotation {
  const before = summarizeProjection(base);
  const after = summarizeProjection(current);
  const reserve = doc.minimumCashReserve;
  const minDelta = after.minimumCash - before.minimumCash;
  const finalDelta = after.finalCash - before.finalCash;
  const debtDelta = after.finalDebt - before.finalDebt;
  const parts: string[] = [];
  if (Math.abs(minDelta) >= 0.5) {
    parts.push(
      `Mín ${formatMoneyWhole(before.minimumCash)} → ${formatMoneyWhole(after.minimumCash)}`,
    );
  }
  if (Math.abs(finalDelta) >= 0.5) {
    parts.push(`horizonte ${formatSignedMoneyWhole(finalDelta)}`);
  }
  if (before.minimumCash < 0 && after.minimumCash >= 0) parts.push("sales del rojo");
  else if (before.minimumCash >= 0 && after.minimumCash < 0) parts.push("entras en rojo");
  else if (before.minimumCash >= reserve && after.minimumCash < reserve) parts.push("rompes tu reserva");
  else if (before.minimumCash < reserve && after.minimumCash >= reserve) parts.push("recuperas tu reserva");

  if (options.debt) {
    if (Math.abs(debtDelta) >= 0.5) {
      parts.push(`deuda al horizonte ${formatSignedMoneyWhole(debtDelta)}`);
    }
    const interest = options.interestDelta ?? 0;
    if (Math.abs(interest) >= 0.5) parts.push(`intereses ${formatSignedMoneyWhole(interest)}`);
    // Net worth at the horizon: cash minus what is still owed.
    const net = finalDelta - debtDelta;
    const tone = net > 0.5 ? "positive" : net < -0.5 ? "negative" : "neutral";
    return { text: parts.length > 0 ? parts.join(" · ") : "Sin efecto en tu caja", tone };
  }

  const tone =
    minDelta > 0.5 || (Math.abs(minDelta) < 0.5 && finalDelta > 0.5)
      ? "positive"
      : minDelta < -0.5 || finalDelta < -0.5
        ? "negative"
        : "neutral";
  return { text: parts.length > 0 ? parts.join(" · ") : "Sin efecto en tu caja", tone };
}

// --- clip content ---------------------------------------------------------

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

const NO_MARKS: readonly number[] = [];

function sameContent(a: PlaylistClipContent, b: PlaylistClipContent): boolean {
  if (!sameNumbers(a.marks ?? NO_MARKS, b.marks ?? NO_MARKS)) return false;
  if (a.accent !== b.accent) return false;
  if (a.kind === "events" && b.kind === "events") {
    return (
      a.extent === b.extent &&
      sameNumbers(a.beats, b.beats) &&
      sameNumbers(a.values, b.values)
    );
  }
  if (a.kind === "level" && b.kind === "level") {
    return (
      a.max === b.max &&
      a.series.initial === b.series.initial &&
      sameNumbers(a.series.beats, b.series.beats) &&
      sameNumbers(a.series.values, b.series.values)
    );
  }
  return false;
}

/**
 * Payments at their real dates (signed, log-scaled to the largest event
 * in the document) for cash items; remaining debt over time for debt
 * accounts. Reuses `previous` objects that didn't change.
 */
export function buildClipContents(
  doc: FinancialDocument,
  projection: FinancialProjection,
  previous: ReadonlyMap<string, PlaylistClipContent>,
): Map<string, PlaylistClipContent> {
  const debtItems = new Set<string>();
  for (const item of doc.items) if (isDebtKind(item)) debtItems.add(item.id);
  const openings = new Map<string, number>();
  for (const account of projection.accounts) openings.set(account.id, account.openingDebt);

  const eventBeats = new Map<string, number[]>();
  const eventSigned = new Map<string, number[]>();
  const levelBeats = new Map<string, number[]>();
  const levelValues = new Map<string, number[]>();
  let maxMagnitude = 0;
  const beatAt = beatResolver(doc);

  for (const point of projection.points) {
    const beat = beatAt(point.date);
    if (point.accountId !== undefined && debtItems.has(point.accountId)) {
      const id = point.accountId;
      if (point.accountDebtAfter === undefined) continue;
      let beats = levelBeats.get(id);
      let values = levelValues.get(id);
      if (!beats || !values) {
        beats = [];
        values = [];
        levelBeats.set(id, beats);
        levelValues.set(id, values);
      }
      if (beats.length > 0 && beats[beats.length - 1] === beat) {
        values[values.length - 1] = point.accountDebtAfter;
      } else {
        beats.push(beat);
        values.push(point.accountDebtAfter);
      }
      continue;
    }
    if (point.type === "credit-card-interest" || point.type === "debt-opening") continue;
    const signed = point.cashDelta !== 0 ? point.cashDelta : -Math.abs(point.debtDelta);
    if (signed === 0) continue;
    maxMagnitude = Math.max(maxMagnitude, Math.abs(signed));
    let beats = eventBeats.get(point.itemId);
    let values = eventSigned.get(point.itemId);
    if (!beats || !values) {
      beats = [];
      values = [];
      eventBeats.set(point.itemId, beats);
      eventSigned.set(point.itemId, values);
    }
    beats.push(beat + EVENT_DAY_OFFSET);
    values.push(signed);
  }

  const contents = new Map<string, PlaylistClipContent>();
  const scale = Math.log1p(maxMagnitude);
  const itemById = new Map<string, FinancialItem>();
  for (const item of doc.items) itemById.set(item.id, item);
  for (const [id, beats] of eventBeats) {
    const signed = eventSigned.get(id)!;
    const values = signed.map((v) => {
      const relative = scale > 0 ? Math.log1p(Math.abs(v)) / scale : 1;
      return Math.sign(v) * (0.18 + 0.82 * relative);
    });
    const item = itemById.get(id);
    const content: PlaylistClipContent = { kind: "events", beats, values };
    // A one-day event is drawn a week wide so its name fits: its real day
    // is the card, the rest a faint tag (the day reads without hover).
    if (item && isPointItem(item)) content.extent = 1;
    if (item && KIND_ACCENT[item.kind] !== "solid") content.accent = KIND_ACCENT[item.kind];
    contents.set(id, content);
  }
  // A card's billing cuts ("la tarjeta como compás"): guide marks.
  const cutBeats = new Map<string, number[]>();
  for (const item of doc.items) {
    if (item.kind !== "credit-card") continue;
    const cuts = cardCycleDates(item, doc.startDate, projection.endDate).cuts;
    cutBeats.set(item.id, cuts.map((date) => beatAt(date) + EVENT_DAY_OFFSET));
  }
  for (const id of debtItems) {
    const beats = levelBeats.get(id) ?? [];
    const values = levelValues.get(id) ?? [];
    const initial = openings.get(id) ?? 0;
    let max = initial;
    for (const v of values) if (v > max) max = v;
    const marks = cutBeats.get(id);
    const debtItem = itemById.get(id);
    const accent = debtItem ? KIND_ACCENT[debtItem.kind] : "solid";
    if (max <= 0) {
      // A card with nothing owed still shows its cycles.
      if (marks && marks.length > 0) {
        const content: PlaylistClipContent = { kind: "events", beats: [], values: [], marks };
        if (accent !== "solid") content.accent = accent;
        contents.set(id, content);
      }
      continue;
    }
    const content: PlaylistClipContent = marks
      ? { kind: "level", series: { initial, beats, values }, max, marks }
      : { kind: "level", series: { initial, beats, values }, max };
    if (accent !== "solid") content.accent = accent;
    contents.set(id, content);
  }

  for (const [id, content] of contents) {
    const old = previous.get(id);
    if (old && sameContent(old, content)) contents.set(id, old);
  }
  return contents;
}

// --- playhead-aware clip detail -------------------------------------------

export function describeItemAt(
  item: FinancialItem,
  doc: FinancialDocument,
  projection: FinancialProjection,
  date: ISODate,
  debtAt: ReadonlyMap<string, number>,
): string {
  const freq = frequencyShort(item.recurrence);
  // A one-time event is a narrow card: just the amount, whole pesos (the
  // editor shows the cents), so it fits instead of being cut.
  const once = item.recurrence.frequency === "once";
  // Figures that follow the playhead say which day they describe when it is
  // not today ("Al 2 mar: debes $25,513"), next to "Deuda hoy" in the header.
  const at = date === doc.startDate ? "" : `al ${formatDateShort(date)}: `;
  const At = at ? `Al ${formatDateShort(date)}: ` : "";
  switch (item.kind) {
    case "income":
      return once
        ? `+${formatMoneyWhole(item.amount)}`
        : `+${formatMoney(item.amount)} ${freq}`;
    case "expense":
      return once
        ? `−${formatMoneyWhole(item.amount)}`
        : `−${formatMoney(item.amount)} ${freq}`;
    case "card-purchase": {
      // An outflow too: "−", and the card it is charged to.
      const card = doc.items.find((candidate) => candidate.id === item.cardId);
      return card
        ? `−${formatMoney(item.amount)} con ${card.name}`
        : `−${formatMoney(item.amount)} (sin tarjeta)`;
    }
    case "loan": {
      const debt = debtAt.get(item.id);
      return debt !== undefined && debt > 0
        ? `−${formatMoney(item.paymentAmount)} ${freq} · ${at}resta ${formatMoneyWhole(debt)}`
        : `−${formatMoney(item.paymentAmount)} ${freq}`;
    }
    case "credit-card": {
      const debt = debtAt.get(item.id) ?? item.balance;
      if (item.paymentMode === "statement") {
        // Totalero: the next statement paid in full, never interest.
        for (const point of projection.points) {
          if (point.date < date || point.itemId !== item.id) continue;
          if (point.type !== "credit-card-payment" || point.cashDelta >= 0) continue;
          return `Totalero · pagas ${formatMoneyWhole(-point.cashDelta)} el ${formatDateShort(point.date)} · sin intereses`;
        }
        return debt > 0.5
          ? `Totalero · ${at}debes ${formatMoneyWhole(debt)} · sin intereses`
          : "Totalero · sin saldo";
      }
      if (debt <= 0.5) return `${At ? `${At}liquidada` : "Liquidada"} · tasa ${item.annualRate}%`;
      // Of a typical monthly payment, how much only feeds the interest
      // (a month of interest on today's balance, same 360-day basis).
      const payment = item.paymentAmount ?? item.minimumPayment;
      const monthlyInterest = (debt * item.annualRate) / 100 / 12;
      let interest = "";
      if (payment > 0 && monthlyInterest > 0) {
        const share = Math.round((100 * monthlyInterest) / payment);
        interest =
          share >= 100
            ? " · tu pago no cubre el interés"
            : ` · ${share}% de tu pago es interés`;
      }
      return `${At ? `${At}debes` : "Debes"} ${formatMoneyWhole(debt)}${interest} · tasa ${item.annualRate}%`;
    }
    case "installment-plan": {
      const monthly =
        item.installmentsTotal > 0 ? item.originalAmount / item.installmentsTotal : 0;
      const paidSince =
        monthly > 0
          ? Math.round(accountActivity(projection, item.id, doc.startDate, date).payments / monthly)
          : 0;
      const paid = Math.min(item.installmentsTotal, item.installmentsPaid + paidSince);
      // A payment out of your cash every month: "−", and a unit on the count.
      return `−${formatMoney(monthly)}/mes · ${at}${paid} de ${item.installmentsTotal} pagos`;
    }
  }
}

// --- track header meta -----------------------------------------------------

function sameMeta(a: PlaylistTrackMeta, b: PlaylistTrackMeta): boolean {
  return a.title === b.title && a.subtitle === b.subtitle && a.meter === b.meter;
}

// Weight of an item for naming its row: the largest yearly cash impact,
// then the document order.
function mainFirst(
  items: readonly FinancialItem[],
  impacts: ReadonlyMap<string, number>,
): FinancialItem[] {
  return items
    .map((item, index) => ({ item, index, weight: Math.abs(impacts.get(item.id) ?? 0) }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((entry) => entry.item);
}

/** Signed cash impact of every item over the projection. */
export function itemImpacts(projection: FinancialProjection): Map<string, number> {
  const impacts = new Map<string, number>();
  for (const point of projection.points) {
    if (point.cashDelta === 0) continue;
    impacts.set(point.itemId, (impacts.get(point.itemId) ?? 0) + point.cashDelta);
  }
  return impacts;
}

export function buildTrackMeta(
  doc: FinancialDocument,
  projection: FinancialProjection,
  trackOfItem: ReadonlyMap<string, string>,
  payoffs: ReadonlyMap<string, DebtPayoffEstimate>,
  previous: ReadonlyMap<string, PlaylistTrackMeta>,
  // Rows the person never named: their name follows what they hold.
  autoRows: ReadonlySet<string> = new Set(),
): Map<string, PlaylistTrackMeta> {
  const impacts = itemImpacts(projection);
  const period = doc.horizonMonths === 12 ? "/año" : ` en ${doc.horizonMonths} meses`;
  const byTrack = new Map<string, FinancialItem[]>();
  for (const item of doc.items) {
    const trackId = trackOfItem.get(item.id);
    if (!trackId) continue;
    let list = byTrack.get(trackId);
    if (!list) {
      list = [];
      byTrack.set(trackId, list);
    }
    list.push(item);
  }

  const trackImpact = new Map<string, number>();
  for (const [trackId, items] of byTrack) {
    let sum = 0;
    for (const item of items) if (item.enabled !== false) sum += impacts.get(item.id) ?? 0;
    trackImpact.set(trackId, sum);
  }

  const metas = new Map<string, PlaylistTrackMeta>();
  for (const [trackId, items] of byTrack) {
    const impact = trackImpact.get(trackId) ?? 0;
    let subtitle: string;
    const only = items.length === 1 ? items[0]! : null;
    if (only && only.enabled === false) {
      subtitle = "Silenciado";
    } else if (only && isDebtKind(only)) {
      const payoff = payoffs.get(only.id);
      if (!payoff) {
        subtitle = `${compactMoney(impact)}${period}`;
      } else if (payoff.payoffDate === null) {
        subtitle = "No se liquida";
      } else {
        // The header is ~20 characters wide: the payoff date is the news.
        subtitle = `Libre en ${formatMonthYear(payoff.payoffDate)}`;
      }
    } else if (only) {
      subtitle = `${impact > 0 ? "+" : ""}${compactMoney(impact)}${period}`;
    } else {
      subtitle = `${items.length} eventos · ${impact > 0 ? "+" : ""}${compactMoney(impact)}`;
    }
    // No meter: an unlabelled 3 px bar read as a fader (UX-44); the
    // subtitle already says the row's weight in words.
    const meta: PlaylistTrackMeta = { subtitle };
    // A row the person never named is titled after what it holds, live
    // (never stored): "Sueldo", "Pago Tarjeta Plata +1". Their own name
    // always wins; an empty row stays "Línea de evento".
    if (autoRows.has(trackId)) {
      const title = derivedRowTitle(mainFirst(items, impacts).map((item) => item.name));
      if (title !== null) meta.title = title;
    }
    const old = previous.get(trackId);
    metas.set(trackId, old && sameMeta(old, meta) ? old : meta);
  }
  return metas;
}

