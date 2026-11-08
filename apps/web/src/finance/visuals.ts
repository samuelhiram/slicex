// Pure builders for what the canvas draws about money: the cash waveform
// (overview lane), each clip's content, the effect of a gesture, track
// header meta and the playhead-aware clip detail. No caching here — the
// bridge caches per revision / playhead day and keeps object identity
// stable (the renderer repaints on reference change).
import {
  accountActivity,
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
import { FREQUENCY_SHORT } from "./labels";
import { beatOf, horizonBeat } from "./mapping";

const MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

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

export function buildOverview(
  doc: FinancialDocument,
  projection: FinancialProjection,
  warnings: readonly LiquidityWarning[],
  baseline: PlaylistStepSeries | null,
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
  return {
    title: "Caja",
    primary: cashSeries(doc, projection),
    secondary: debtSeries(doc, projection),
    baseline,
    thresholds: [
      { value: reserve, tone: "warning", label: `Reserva ${compactMoney(reserve)}` },
      { value: 0, tone: "danger" },
    ],
    annotations,
    formatValue: compactMoney,
    // Detail near the reserve and the valleys matters more than the size
    // of the year-end pile: log beyond ~the reserve.
    scale: { kind: "symlog", constant: Math.max(1000, reserve) },
    endBeat: horizonBeat(doc),
  };
}

// --- gesture effect ------------------------------------------------------

export function dragAnnotation(
  doc: FinancialDocument,
  base: FinancialProjection,
  current: FinancialProjection,
): PlaylistDragAnnotation {
  const before = summarizeProjection(base);
  const after = summarizeProjection(current);
  const reserve = doc.minimumCashReserve;
  const minDelta = after.minimumCash - before.minimumCash;
  const finalDelta = after.finalCash - before.finalCash;
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

function sameContent(a: PlaylistClipContent, b: PlaylistClipContent): boolean {
  if (a.kind === "events" && b.kind === "events") {
    return sameNumbers(a.beats, b.beats) && sameNumbers(a.values, b.values);
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
    beats.push(beat);
    values.push(signed);
  }

  const contents = new Map<string, PlaylistClipContent>();
  const scale = Math.log1p(maxMagnitude);
  for (const [id, beats] of eventBeats) {
    const signed = eventSigned.get(id)!;
    const values = signed.map((v) => {
      const relative = scale > 0 ? Math.log1p(Math.abs(v)) / scale : 1;
      return Math.sign(v) * (0.18 + 0.82 * relative);
    });
    contents.set(id, { kind: "events", beats, values });
  }
  for (const id of debtItems) {
    const beats = levelBeats.get(id) ?? [];
    const values = levelValues.get(id) ?? [];
    const initial = openings.get(id) ?? 0;
    let max = initial;
    for (const v of values) if (v > max) max = v;
    if (max <= 0) continue;
    contents.set(id, { kind: "level", series: { initial, beats, values }, max });
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
  const freq = FREQUENCY_SHORT[item.recurrence.frequency];
  switch (item.kind) {
    case "income":
      return `+${formatMoney(item.amount)} ${freq}`;
    case "expense":
      return `−${formatMoney(item.amount)} ${freq}`;
    case "card-purchase": {
      const card = doc.items.find((candidate) => candidate.id === item.cardId);
      return card
        ? `${formatMoney(item.amount)} → ${card.name}`
        : `${formatMoney(item.amount)} (sin tarjeta)`;
    }
    case "loan": {
      const debt = debtAt.get(item.id);
      return debt !== undefined && debt > 0
        ? `−${formatMoney(item.paymentAmount)} ${freq} · resta ${formatMoneyWhole(debt)}`
        : `−${formatMoney(item.paymentAmount)} ${freq}`;
    }
    case "credit-card": {
      const debt = debtAt.get(item.id) ?? item.balance;
      if (debt <= 0.5) return `Liquidada · ${item.annualRate}%`;
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
      return `Debes ${formatMoneyWhole(debt)}${interest} · ${item.annualRate}%`;
    }
    case "installment-plan": {
      const monthly =
        item.installmentsTotal > 0 ? item.originalAmount / item.installmentsTotal : 0;
      const paidSince =
        monthly > 0
          ? Math.round(accountActivity(projection, item.id, doc.startDate, date).payments / monthly)
          : 0;
      const paid = Math.min(item.installmentsTotal, item.installmentsPaid + paidSince);
      return `${formatMoney(monthly)}/mes · ${paid}/${item.installmentsTotal}`;
    }
  }
}

// --- track header meta -----------------------------------------------------

function sameMeta(a: PlaylistTrackMeta, b: PlaylistTrackMeta): boolean {
  return a.subtitle === b.subtitle && a.meter === b.meter;
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
  let maxAbs = 0;
  for (const [trackId, items] of byTrack) {
    let sum = 0;
    for (const item of items) if (item.enabled !== false) sum += impacts.get(item.id) ?? 0;
    trackImpact.set(trackId, sum);
    maxAbs = Math.max(maxAbs, Math.abs(sum));
  }

  const metas = new Map<string, PlaylistTrackMeta>();
  for (const [trackId, items] of byTrack) {
    const impact = trackImpact.get(trackId) ?? 0;
    const meter = maxAbs > 0 ? Math.round((impact / maxAbs) * 1000) / 1000 : 0;
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
        subtitle = `Libre ${formatMonthYear(payoff.payoffDate)}`;
      }
    } else if (only) {
      subtitle = `${impact > 0 ? "+" : ""}${compactMoney(impact)}${period}`;
    } else {
      subtitle = `${items.length} eventos · ${impact > 0 ? "+" : ""}${compactMoney(impact)}`;
    }
    const meta: PlaylistTrackMeta = { subtitle, meter };
    const old = previous.get(trackId);
    metas.set(trackId, old && sameMeta(old, meta) ? old : meta);
  }
  return metas;
}

