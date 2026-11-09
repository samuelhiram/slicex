// FinancialBridge — keeps a FinancialDocument and the playlist in sync and
// owns the derived projection. Plain TS (no React); React reads it through
// FinancialBridgeApi.
//
// Direction of truth (see bridge-api.ts):
//   playlist clip geometry ─► item dates      (drag, resize, slice, slip…)
//   clip label / colour / mute ─► item name / colour / enabled
//   editor / add buttons ─► item ─► clip geometry
//
// Undo / redo: the playlist history is the single undo stack. Every state
// the bridge sees is mapped (WeakMap, O(1)) to the document items that
// belong to it; when undo/redo makes an older state present again, the
// bridge restores exactly those items instead of re-deriving them. Every
// financial edit therefore has to be a playlist history entry — editor
// saves that don't move the clip still `touch()` the playlist so they get
// their own undo step.
//
// Identity: item.id === clip.id, and every financial clip carries a
// sourceId of its own. A clip that appears without an item (paste,
// clone-drag, duplicate, slice, draw with a selection) is materialised
// from the clip its sourceId came from — the exact clip that was copied —
// or, for a cut→paste, from the archived item of that clip.
//
// Performance (canon §1.2/§2.6): hover / playhead / viewport notifies keep
// clips/tracks identity, so they cost one WeakMap.set. Real edits cost O(N)
// and recompute the projection only when an item actually changed. React
// listeners are notified only then.
import {
  createDefaultFinancialItem,
  explainValley,
  findLiquidityWarnings,
  nextPayment,
  projectFinancialDocument,
  snapshotAt,
  solveDebtPayment,
  statementDueDate,
  suggestValleyFixes,
  type ValleyFix,
  type FinancialDocument,
  type FinancialItem,
  type FinancialItemKind,
  type FinancialProjection,
  type FinancialProjectionPoint,
  type FinancialSnapshot,
  type ISODate,
  type LiquidityWarning,
  type UpcomingPayment,
  debtByAccountAt,
  estimateDebtPayoffs,
  type DebtPayoffEstimate,
} from "@slicex/core";
import {
  stepSeriesValueAt,
  type PlaylistClip,
  type PlaylistClipContent,
  type PlaylistCore,
  type PlaylistDragAnnotation,
  type PlaylistOverviewData,
  type PlaylistState,
  type PlaylistStepSeries,
  type PlaylistTrackMeta,
} from "@slicex/canvas";
import type {
  FinancialBridgeApi,
  FinancialPlacement,
  FinancialPreview,
  FinancialSession,
  PreviewEffect,
  ValleyInsight,
} from "./bridge-api";
import { formatDateShort, formatMoney, formatMoneyWhole } from "./format";
import { FREQUENCY_SHORT, KIND_COLORS, KIND_LABELS } from "./labels";
import {
  beatOf,
  canonicalItem,
  createFinancialPlaylistState,
  dateOf,
  deriveRecurrence,
  isPayoffPinned,
  isPointItem,
  isPointTrackOf,
  isSliceable,
  horizonBeat,
  itemClipGeometry,
  itemColor,
  openEndBeat,
  trackLayoutOf,
  type FinancialTrackLayout,
  type ObservedGeometry,
} from "./mapping";
import {
  buildClipContents,
  buildOverview,
  buildTrackMeta,
  cashSeries,
  describeItemAt,
  dragAnnotation,
  formatMonthYear,
} from "./visuals";

// Label the playlist gives to clips created without a template.
const GENERIC_CLIP_LABEL = "Clip";
const MAX_SPARK_BARS = 64;
const EMPTY_BARS: number[] = [];
// Movements listed under a date tooltip before "y N más".
const DAY_DETAIL_MAX = 5;
const NO_POINTS: readonly FinancialProjectionPoint[] = [];

interface Observed {
  start: number;
  duration: number;
  label: string;
  color: string;
  sourceId: string | undefined;
  trackId: string;
}

interface Template {
  item: FinancialItem;
  geometry: ObservedGeometry | null;
}

// What undo/redo restores for a playlist state. Shared by reference while
// unchanged, so recording a hover/playhead state allocates nothing.
interface DocSnapshot {
  items: FinancialItem[];
  initialCash: number;
  minimumCashReserve: number;
}

const EPS = 1e-6;

// Amount by hand: px of upward travel that multiply the amount by e.
const LEVEL_PX_PER_E = 120;
// Branch switch morph of the money lane.
const TRANSITION_MS = 320;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** The amount a vertical drag edits, or null when the item has none. */
export function levelValue(item: FinancialItem): number | null {
  switch (item.kind) {
    case "income":
    case "expense":
    case "card-purchase":
      return item.amount;
    case "loan":
      return item.paymentAmount;
    case "credit-card":
      return item.paymentMode === "statement" ? null : item.paymentAmount ?? item.minimumPayment;
    case "installment-plan":
      return item.originalAmount;
  }
}

export function withLevel<T extends FinancialItem>(item: T, value: number): T {
  switch (item.kind) {
    case "income":
    case "expense":
    case "card-purchase":
      return { ...item, amount: value };
    case "loan":
      return { ...item, paymentAmount: value };
    case "credit-card":
      return { ...item, paymentAmount: value };
    case "installment-plan":
      return { ...item, originalAmount: value };
  }
  return item;
}

/** Friendly rounding while dragging an amount: fewer digits as it grows. */
export function niceAmount(raw: number): number {
  const value = Math.max(1, raw);
  const step = value < 100 ? 1 : value < 1000 ? 10 : value < 10_000 ? 50 : value < 100_000 ? 100 : 1000;
  return Math.max(step, Math.round(value / step) * step);
}

export function levelText(item: FinancialItem, value: number, doc: FinancialDocument): string {
  const freq = FREQUENCY_SHORT[item.recurrence.frequency];
  const once = item.recurrence.frequency === "once";
  switch (item.kind) {
    case "income":
      return once ? `+${formatMoneyWhole(value)}` : `+${formatMoneyWhole(value)} ${freq}`;
    case "expense":
      return once ? `−${formatMoneyWhole(value)}` : `−${formatMoneyWhole(value)} ${freq}`;
    case "loan":
      return `Pagas ${formatMoneyWhole(value)} ${freq}`;
    case "credit-card":
      return `Pagas ${formatMoneyWhole(value)}/mes`;
    case "card-purchase": {
      const card = doc.items.find((candidate) => candidate.id === item.cardId);
      return card ? `${formatMoneyWhole(value)} → ${card.name}` : formatMoneyWhole(value);
    }
    case "installment-plan": {
      const months = Math.max(1, item.installmentsTotal);
      return `${formatMoneyWhole(value)} en ${months} MSI · ${formatMoney(
        Math.round((value / months) * 100) / 100,
      )}/mes`;
    }
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function cloneItem<T extends FinancialItem>(item: T, id: string): T {
  const copy = JSON.parse(JSON.stringify(item)) as T;
  copy.id = id;
  return copy;
}

function sameBars(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export function describeItem(
  item: FinancialItem,
  doc: FinancialDocument,
): string {
  const freq = FREQUENCY_SHORT[item.recurrence.frequency];
  switch (item.kind) {
    case "income":
      return `+${formatMoney(item.amount)} ${freq}`;
    case "expense":
      return `−${formatMoney(item.amount)} ${freq}`;
    case "loan":
      return item.balance !== undefined
        ? `−${formatMoney(item.paymentAmount)} ${freq} · resta ${formatMoney(item.balance)}`
        : `−${formatMoney(item.paymentAmount)} ${freq}`;
    case "credit-card":
      return `Deuda ${formatMoney(item.balance)} · ${item.annualRate}% · paga ${formatMoney(
        item.paymentAmount ?? item.minimumPayment,
      )}`;
    case "card-purchase": {
      const card = doc.items.find((candidate) => candidate.id === item.cardId);
      return card
        ? `${formatMoney(item.amount)} → ${card.name}`
        : `${formatMoney(item.amount)} (sin tarjeta)`;
    }
    case "installment-plan": {
      const monthly =
        item.installmentsTotal > 0 ? item.originalAmount / item.installmentsTotal : 0;
      return `${formatMoney(monthly)}/mes · ${item.installmentsPaid}/${item.installmentsTotal}`;
    }
  }
}

export class FinancialBridge implements FinancialBridgeApi {
  readonly core: PlaylistCore;

  private doc: FinancialDocument;
  private projection: FinancialProjection;
  private warnings: LiquidityWarning[];
  private revision = 0;
  private readonly listeners = new Set<() => void>();

  // Document data per playlist state (history-aligned undo/redo).
  private readonly snapshots = new WeakMap<PlaylistState, DocSnapshot>();
  private snap: DocSnapshot;

  // Last observed clip fields by clip id: tells a user edit (label changed
  // since last time) from a stale value, and gives templates their geometry.
  private observed = new Map<string, Observed>();
  private lastClips: PlaylistState["clips"] | null = null;
  private lastTracks: PlaylistState["tracks"] | null = null;

  // Items whose clip was removed, by that clip's sourceId (cut → paste).
  private readonly archiveBySource = new Map<string, Template>();

  private itemIndex = new Map<string, FinancialItem>();
  private readonly detailCache = new Map<string, string | null>();
  private detailDay = Number.NaN;
  private debtAtDay: { revision: number; day: number; value: Map<string, number> } | null =
    null;
  // Renderer providers: rebuilt lazily once per revision, identity-stable.
  private contentIndex: Map<string, PlaylistClipContent> | null = null;
  private previousContent: Map<string, PlaylistClipContent> = new Map();
  private trackMetaIndex: Map<string, PlaylistTrackMeta> | null = null;
  private previousTrackMeta: Map<string, PlaylistTrackMeta> = new Map();
  private overviewCache: {
    revision: number;
    // Mode key: the gesture baseline, the preview or the comparison object.
    baseline: object | null;
    data: PlaylistOverviewData;
  } | null = null;
  private dragCache: {
    revision: number;
    baseline: DocSnapshot;
    data: PlaylistDragAnnotation;
  } | null = null;
  private readonly snapshotProjections = new WeakMap<DocSnapshot, FinancialProjection>();
  private payoffCache: {
    key: FinancialItem[];
    value: Map<string, DebtPayoffEstimate>;
  } | null = null;
  private sparkIndex: Map<string, number[]> | null = null;
  private previousSpark = new Map<string, number[]>();

  private applying = 0;
  // Follow-up corrections, flushed in one microtask (see queueCorrections).
  private readonly pendingLabel = new Set<string>();
  private readonly pendingUnique = new Set<string>();
  private readonly pendingNoSlice = new Set<string>();
  private readonly pendingOffset = new Set<string>();
  private readonly pendingRepin = new Set<string>();
  private correctionQueued = false;
  private destroyed = false;
  private idCounter = 0;
  private readonly subscription: { unsubscribe: () => void };

  // Wave 2/3 interaction state.
  private gestureOpen = false;
  // Goal-seek result of the open gesture, shown in the drag pill.
  private gestureNote: { text: string; tone: PlaylistDragAnnotation["tone"] } | null = null;
  private level: { itemId: string; value: number } | null = null;
  private preview: FinancialPreview | null = null;
  private previewCache: {
    revision: number;
    preview: FinancialPreview;
    doc: FinancialDocument;
    projection: FinancialProjection;
    warnings: LiquidityWarning[];
  } | null = null;
  private comparison: FinancialDocument | null = null;
  private comparisonCache: { doc: FinancialDocument; series: PlaylistStepSeries } | null =
    null;
  private transition: {
    from: PlaylistStepSeries;
    t0: number;
    beats: number[];
  } | null = null;
  private highlight: ReadonlySet<string> = new Set();
  private valleyCache: { revision: number; byKey: Map<string, ValleyInsight> } = {
    revision: -1,
    byKey: new Map(),
  };

  constructor(core: PlaylistCore, doc: FinancialDocument) {
    this.core = core;
    this.doc = { ...doc, items: doc.items.map(canonicalItem) };
    this.projection = projectFinancialDocument(this.doc);
    this.warnings = findLiquidityWarnings(
      this.projection,
      this.doc.minimumCashReserve,
    );
    this.snap = {
      items: this.doc.items,
      initialCash: this.doc.initialCash,
      minimumCashReserve: this.doc.minimumCashReserve,
    };
    this.rebuildIndex();
    const state = core.getState();
    this.observe(state);
    this.snapshots.set(state, this.snap);
    this.subscription = core.subscribe((next) => this.handleState(next));
    // Pin derived clip ends (debts end where they're paid off) right away.
    this.sweepInvariants(state);
  }

  // --- subscription (arrow properties: passed by reference to useSyncExternalStore)

  readonly getRevision = (): number => this.revision;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // --- reads

  getDocument(): FinancialDocument {
    return this.doc;
  }

  getProjection(): FinancialProjection {
    return this.projection;
  }

  getItem(id: string): FinancialItem | null {
    return this.itemIndex.get(id) ?? null;
  }

  isItemLocked(id: string): boolean {
    const clip = this.findClip(id);
    return clip ? this.isClipLocked(clip) : false;
  }

  dateAtBeat(beat: number): ISODate {
    return dateOf(this.doc, beat);
  }

  beatAtDate(date: ISODate): number {
    return beatOf(this.doc, date);
  }

  snapshotAt(date: ISODate): FinancialSnapshot {
    return snapshotAt(this.projection, date);
  }

  nextPaymentAfter(date: ISODate): UpcomingPayment | null {
    return nextPayment(this.projection, date);
  }

  getWarnings(): LiquidityWarning[] {
    return this.warnings;
  }

  // Follows the playhead day (debt left, interest share, MSI n/12): the
  // cache is per (revision, day), so it changes at most once per day.
  getClipDetail(clipId: string): string | null {
    const day = this.playheadDay();
    if (day !== this.detailDay) {
      this.detailCache.clear();
      this.detailDay = day;
    }
    const cached = this.detailCache.get(clipId);
    if (cached !== undefined) return cached;
    const item = this.itemIndex.get(clipId);
    const text = item
      ? describeItemAt(item, this.doc, this.projection, dateOf(this.doc, day), this.debtAt(day))
      : null;
    this.detailCache.set(clipId, text);
    return text;
  }

  getClipContent(clipId: string): PlaylistClipContent | null {
    if (!this.contentIndex) {
      this.contentIndex = buildClipContents(this.doc, this.projection, this.previousContent);
    }
    return this.contentIndex.get(clipId) ?? null;
  }

  getOverviewData(): PlaylistOverviewData {
    const settled = this.settledOverview();
    return this.transitionFrame(settled) ?? settled;
  }

  // The lane without the switch animation: the gesture's "before" ghost,
  // else a preview (what-if) over the current curve, else the compared
  // future, else just the current curve. Cached per (revision, mode key).
  private settledOverview(): PlaylistOverviewData {
    const baseline = this.gestureBaseline();
    const preview = baseline ? null : this.preview;
    const comparison = baseline || preview ? null : this.comparison;
    const key: object | null = baseline ?? preview ?? comparison;
    const cached = this.overviewCache;
    if (cached && cached.revision === this.revision && cached.baseline === key) {
      return cached.data;
    }
    let data: PlaylistOverviewData;
    if (baseline) {
      data = buildOverview(
        this.doc,
        this.projection,
        this.warnings,
        cashSeries(this.doc, this.projectionOf(baseline)),
      );
    } else if (preview) {
      const view = this.previewData(preview);
      data = buildOverview(
        view.doc,
        view.projection,
        view.warnings,
        cashSeries(this.doc, this.projection),
      );
    } else if (comparison) {
      data = buildOverview(
        this.doc,
        this.projection,
        this.warnings,
        this.comparisonSeries(comparison),
      );
    } else {
      data = buildOverview(this.doc, this.projection, this.warnings, null);
    }
    this.overviewCache = { revision: this.revision, baseline: key, data };
    return data;
  }

  getDragAnnotation(): PlaylistDragAnnotation | null {
    const baseline = this.gestureBaseline();
    if (!baseline) return null;
    const cached = this.dragCache;
    if (cached && cached.revision === this.revision && cached.baseline === baseline) {
      return cached.data;
    }
    const effect = dragAnnotation(this.doc, this.projectionOf(baseline), this.projection);
    const note = this.gestureNote ?? this.statementNote(baseline);
    const data: PlaylistDragAnnotation = note
      ? { text: `${note.text} · ${effect.text}`, tone: note.tone === "negative" ? "negative" : effect.tone }
      : effect;
    this.dragCache = { revision: this.revision, baseline, data };
    return data;
  }

  // A purchase on a "totalero" card dragged across a cut: when it is paid.
  private statementNote(
    baseline: DocSnapshot,
  ): { text: string; tone: PlaylistDragAnnotation["tone"] } | null {
    const before = new Map<string, FinancialItem>();
    for (const item of baseline.items) before.set(item.id, item);
    for (const item of this.doc.items) {
      if (item.kind !== "card-purchase") continue;
      const old = before.get(item.id);
      if (!old || old.kind !== "card-purchase") continue;
      if (old.recurrence.startDate === item.recurrence.startDate) continue;
      const card = this.itemIndex.get(item.cardId);
      if (!card || card.kind !== "credit-card" || card.paymentMode !== "statement") continue;
      const was = statementDueDate(card, old.recurrence.startDate);
      const will = statementDueDate(card, item.recurrence.startDate);
      if (was === will) {
        return { text: `Se paga el ${formatDateShort(will)}`, tone: "neutral" };
      }
      return {
        text: `Pasa de corte: se paga el ${formatDateShort(will)} (antes ${formatDateShort(was)})`,
        tone: will > was ? "positive" : "negative",
      };
    }
    return null;
  }

  getTrackMeta(trackId: string): PlaylistTrackMeta | null {
    if (!this.trackMetaIndex) {
      const trackOfItem = new Map<string, string>();
      for (const [id, observed] of this.observed) trackOfItem.set(id, observed.trackId);
      this.trackMetaIndex = buildTrackMeta(
        this.doc,
        this.projection,
        trackOfItem,
        this.payoffs(),
        this.previousTrackMeta,
      );
    }
    return this.trackMetaIndex.get(trackId) ?? null;
  }

  // Called by the renderer every frame for visible clips: O(1) after the
  // first call of a revision, and the SAME array while the bars are equal.
  getClipSparkline(clipId: string): number[] | null {
    if (!this.itemIndex.has(clipId)) return null;
    if (!this.sparkIndex) this.sparkIndex = this.buildSparkIndex();
    return this.sparkIndex.get(clipId) ?? EMPTY_BARS;
  }

  // --- wave 2: amount by hand

  // Vertical drag on a clip's top edge (the interaction controller opened a
  // gesture: every touch() below lands in ONE undo entry, and the gesture
  // baseline gives the lane its ghost and the pill its effect).
  levelDrag(clipId: string, phase: "start" | "move" | "end", deltaY: number): string | null {
    if (phase === "start") {
      const item = this.itemIndex.get(clipId);
      const clip = this.findClip(clipId);
      const value = item ? levelValue(item) : null;
      if (!item || !clip || this.isClipLocked(clip) || value === null) {
        this.level = null;
        return item && item.kind === "credit-card" && item.paymentMode === "statement"
          ? "Pagas el total de cada estado de cuenta"
          : null;
      }
      this.level = { itemId: clipId, value };
      return levelText(item, value, this.doc);
    }
    const level = this.level;
    if (!level) return null;
    if (phase === "end") {
      this.level = null;
      return null;
    }
    const current = this.itemIndex.get(level.itemId);
    if (!current) return null;
    const value = niceAmount(level.value * Math.exp(deltaY / LEVEL_PX_PER_E));
    if (levelValue(current) !== value) {
      const next = withLevel(current, value);
      this.doc = {
        ...this.doc,
        items: this.doc.items.map((item) => (item.id === next.id ? next : item)),
      };
      this.commitTouch();
    }
    return levelText(this.itemIndex.get(level.itemId) ?? current, value, this.doc);
  }

  // --- wave 2: valleys that explain and fix themselves

  valleyAt(day: number): ValleyInsight | null {
    if (this.warnings.length === 0) return null;
    const date = dateOf(this.doc, Math.max(0, Math.floor(day)));
    const reserve = this.doc.minimumCashReserve;
    if (snapshotAt(this.projection, date).cash >= reserve) return null;
    // The episode the day belongs to: the latest one that started by then.
    let warning: LiquidityWarning | null = null;
    for (const candidate of this.warnings) {
      if (candidate.startDate <= date) warning = candidate;
    }
    if (!warning) return null;
    if (this.valleyCache.revision !== this.revision) {
      this.valleyCache = { revision: this.revision, byKey: new Map() };
    }
    const key = `${warning.startDate}:${warning.eventId}`;
    let insight = this.valleyCache.byKey.get(key);
    if (!insight) {
      insight = {
        warning,
        explanation: explainValley(this.doc, this.projection, warning),
        fixes: suggestValleyFixes(this.doc, warning, { limit: 3 }),
      };
      this.valleyCache.byKey.set(key, insight);
    }
    return insight;
  }

  applyValleyFix(fix: ValleyFix): boolean {
    return this.replaceItem(fix.patch);
  }

  setHighlight(itemIds: readonly string[] | null): void {
    const next = new Set(itemIds ?? []);
    if (next.size === this.highlight.size && [...next].every((id) => this.highlight.has(id))) {
      return;
    }
    this.highlight = next;
    this.notifyVisual();
  }

  isHighlighted(clipId: string): boolean {
    return this.highlight.has(clipId);
  }

  // Render-loop provider (time tooltip): O(1) while the day and the
  // projection are the same; the per-date index is built once per projection.
  private dayDetailCache: { projection: unknown; day: number; text: string | null } | null = null;
  private pointsByDate: { projection: unknown; map: Map<string, FinancialProjectionPoint[]> } | null =
    null;

  getDayDetail(beat: number): string | null {
    const day = Math.floor(beat);
    const cache = this.dayDetailCache;
    if (cache && cache.projection === this.projection && cache.day === day) return cache.text;
    let text: string | null = null;
    if (Number.isFinite(day) && day >= 0 && day <= horizonBeat(this.doc)) {
      const date = dateOf(this.doc, day);
      const lines = [`Caja ${formatMoneyWhole(this.snapshotAt(date).cash)}`];
      // That day's cash movements, one line per item (in event order).
      const totals = new Map<string, { name: string; delta: number }>();
      for (const point of this.pointsOn(date)) {
        if (point.cashDelta === 0) continue;
        const entry = totals.get(point.itemId);
        if (entry) entry.delta += point.cashDelta;
        else totals.set(point.itemId, { name: point.name, delta: point.cashDelta });
      }
      const moves = [...totals.values()].filter((entry) => Math.round(entry.delta) !== 0);
      const shown = moves.length > DAY_DETAIL_MAX ? DAY_DETAIL_MAX - 1 : moves.length;
      for (let i = 0; i < shown; i += 1) {
        const { name, delta } = moves[i]!;
        lines.push(`${delta > 0 ? "+" : "−"}${formatMoneyWhole(Math.abs(delta))} ${name}`);
      }
      if (shown < moves.length) lines.push(`y ${moves.length - shown} más`);
      text = lines.join("\n");
    }
    this.dayDetailCache = { projection: this.projection, day, text };
    return text;
  }

  private pointsOn(date: string): readonly FinancialProjectionPoint[] {
    if (!this.pointsByDate || this.pointsByDate.projection !== this.projection) {
      const map = new Map<string, FinancialProjectionPoint[]>();
      for (const point of this.projection.points) {
        const list = map.get(point.date);
        if (list) list.push(point);
        else map.set(point.date, [point]);
      }
      this.pointsByDate = { projection: this.projection, map };
    }
    return this.pointsByDate.map.get(date) ?? NO_POINTS;
  }

  getTrackLayout(): FinancialTrackLayout {
    return trackLayoutOf(this.core.getState(), (clipId) => this.itemIndex.has(clipId));
  }

  canExtend(clipId: string): boolean {
    const item = this.itemIndex.get(clipId);
    return item !== undefined && !isPointItem(item);
  }

  // --- wave 3: futures

  setPreview(preview: FinancialPreview | null): void {
    if (preview === this.preview) return;
    this.preview = preview;
    this.previewCache = null;
    this.notifyVisual();
  }

  getPreview(): FinancialPreview | null {
    return this.preview;
  }

  /** Effect of the active preview vs the current plan (null without one). */
  getPreviewEffect(): PreviewEffect | null {
    const preview = this.preview;
    if (!preview) return null;
    const view = this.previewData(preview);
    const annotation = dragAnnotation(this.doc, this.projection, view.projection);
    return {
      text: annotation.text,
      tone: annotation.tone,
      minBefore: this.projection.minimumCash.cash,
      minAfter: view.projection.minimumCash.cash,
      minAfterDate: view.projection.minimumCash.date,
      finalBefore: this.projection.finalCash,
      finalAfter: view.projection.finalCash,
    };
  }

  setComparison(doc: FinancialDocument | null): void {
    if (doc === this.comparison) return;
    this.comparison = doc;
    this.notifyVisual();
  }

  getComparison(): FinancialDocument | null {
    return this.comparison;
  }

  /** Morph the lane from `series` (the curve shown before) to the current one. */
  animateFrom(series: PlaylistStepSeries | null): void {
    if (!series) {
      this.transition = null;
      return;
    }
    const days = Math.max(1, horizonBeat(this.doc));
    const beats: number[] = [];
    for (let day = 1; day < days; day += 1) beats.push(day);
    this.transition = { from: series, t0: now(), beats };
    this.notifyVisual();
  }

  isAnimating(): boolean {
    return this.transition !== null && now() - this.transition.t0 < TRANSITION_MS;
  }

  exportSession(): FinancialSession {
    return { session: this.core.saveSession(), doc: this.doc };
  }

  // Back to a document saved with exportSession, with its undo history.
  importSession(session: FinancialSession): void {
    this.resetTransient();
    this.doc = session.doc;
    this.applying += 1;
    try {
      this.core.loadSession(session.session);
    } finally {
      this.applying -= 1;
    }
    const state = this.core.getState();
    const snapshot = this.snapshots.get(state);
    if (snapshot) {
      this.doc = {
        ...this.doc,
        items: snapshot.items,
        initialCash: snapshot.initialCash,
        minimumCashReserve: snapshot.minimumCashReserve,
      };
      this.snap = snapshot;
    }
    this.observe(state);
    this.recompute();
    this.snapshots.set(state, this.snap);
    this.sweepInvariants(state);
  }

  // A brand-new document (onboarding, a restored save, a rolled-forward
  // plan): fresh playlist + fresh undo history, same zoom. With a layout,
  // its rows (empty ones too) and placements come back.
  loadDocument(doc: FinancialDocument, layout: FinancialTrackLayout | null = null): void {
    this.resetTransient();
    const viewport = this.core.getState().viewport;
    const canonical: FinancialDocument = { ...doc, items: doc.items.map(canonicalItem) };
    const base = createFinancialPlaylistState(canonical, layout);
    const state: PlaylistState = {
      ...base,
      viewport: {
        ...base.viewport,
        width: viewport.width,
        height: viewport.height,
        pxPerBeat: viewport.pxPerBeat,
      },
    };
    this.doc = canonical;
    this.snap = {
      items: canonical.items,
      initialCash: canonical.initialCash,
      minimumCashReserve: canonical.minimumCashReserve,
    };
    this.archiveBySource.clear();
    this.applying += 1;
    try {
      this.core.loadSession(state);
    } finally {
      this.applying -= 1;
    }
    const present = this.core.getState();
    this.observe(present);
    this.recompute();
    this.snapshots.set(present, this.snap);
    this.sweepInvariants(present);
  }

  // --- writes

  createDraftItem(kind: FinancialItemKind, atDay?: number): FinancialItem {
    // Past the horizon nothing would be projected: start at its last day.
    const day = Math.min(
      Math.max(0, Math.floor(atDay ?? this.core.getState().playPosition.time)),
      horizonBeat(this.doc) - 1,
    );
    const item = createDefaultFinancialItem(
      kind,
      this.makeItemId(kind),
      dateOf(this.doc, day),
      this.doc,
    );
    if (!item.name) item.name = KIND_LABELS[kind];
    return canonicalItem(item);
  }

  addItem(draft: FinancialItem, placement?: FinancialPlacement): string {
    const state = this.core.getState();
    const taken = (id: string) =>
      !id || this.itemIndex.has(id) || state.clips.some((clip) => clip.id === id);
    const id = taken(draft.id) ? this.makeItemId(draft.kind) : draft.id;
    const item = canonicalItem({ ...draft, id } as FinancialItem);
    delete item.enabled;
    const geometry = itemClipGeometry(this.doc, item);
    const excluded = this.excludedTracks(state);

    // One-time events go to the first shared lane of their kind that is
    // writable, audible and free at that date; anything else (and a full
    // lane set) gets a new track at the bottom.
    let trackIndex = -1;
    // A row the person picked (e.g. right-click on it): used when writable
    // and free at the item's dates — the endless empty rows below always are.
    let picked = false;
    if (placement) {
      const wanted = Math.max(0, Math.floor(placement.trackIndex));
      const track = state.tracks[wanted];
      const end = geometry.start + geometry.duration;
      if (
        !track ||
        (!track.locked &&
          !state.clips.some(
            (clip) =>
              clip.trackId === track.id &&
              clip.start < end &&
              clip.start + clip.duration > geometry.start,
          ))
      ) {
        trackIndex = wanted;
        picked = true;
      }
    }
    if (!picked && isPointItem(item)) {
      const end = geometry.start + geometry.duration;
      trackIndex = state.tracks.findIndex(
        (track) =>
          !track.locked &&
          !excluded.has(track.id) &&
          isPointTrackOf(track.id, item.kind) &&
          !state.clips.some(
            (clip) =>
              clip.trackId === track.id &&
              clip.start < end &&
              clip.start + clip.duration > geometry.start,
          ),
      );
    }
    const newTrack = trackIndex < 0;
    if (newTrack) trackIndex = state.tracks.length;
    // The row takes the item's name when it had none of its own: a new
    // lane, an endless row materialised now, or an empty "Track N".
    const target = state.tracks[trackIndex];
    const nameRow =
      newTrack ||
      !target ||
      (/^Track \d+$/.test(target.label) &&
        !state.clips.some((clip) => clip.trackId === target.id));

    this.apply(() => {
      // A new lane goes right under the last track (createClip on a row
      // past the end would materialise every empty row in between).
      if (newTrack) this.core.insertTrackBelow(state.tracks.length - 1);
      this.core.createClip({
        trackIndex,
        id,
        start: geometry.start,
        duration: geometry.duration,
        type: "pattern",
        label: item.name,
        color: itemColor(item),
        sourceId: id,
        noSlice: !isSliceable(item),
      });
      if (geometry.contentOffset !== 0) {
        this.core.setClipContentOffset(id, geometry.contentOffset);
      }
      if (nameRow) {
        this.core.renameTrack(
          trackIndex,
          isPointItem(item) ? `${KIND_LABELS[item.kind]} (único)` : item.name,
        );
        this.core.recolorTrack(trackIndex, KIND_COLORS[item.kind]);
      }
      this.core.setClipSelection([id]);
    });

    const after = this.core.getState();
    const clip = after.clips.find((candidate) => candidate.id === id);
    if (!clip) return id;
    if (this.excludedTracks(after).has(clip.trackId)) item.enabled = false;
    this.doc = { ...this.doc, items: [...this.doc.items, item] };
    this.commit(after);
    return id;
  }

  replaceItem(draft: FinancialItem): boolean {
    const current = this.itemIndex.get(draft.id);
    const clip = this.findClip(draft.id);
    if (!current || !clip || this.isClipLocked(clip)) return false;

    const next = canonicalItem(draft);
    const geometry = itemClipGeometry(this.doc, next);
    // A one-time event keeps the visual width the user gave it.
    const duration =
      isPointItem(next) && isPointItem(current) ? clip.duration : geometry.duration;
    const ratio = clip.stretchRatio && clip.stretchRatio > 0 ? clip.stretchRatio : 1;
    const offset = geometry.contentOffset * ratio;
    const noSlice = !isSliceable(next);

    // The edited item becomes the base the sync derives the target from;
    // siblings (e.g. group members dragged along by the move) are derived
    // from their own geometry like any other playlist edit.
    this.doc = {
      ...this.doc,
      items: this.doc.items.map((item) => (item.id === next.id ? next : item)),
    };

    const before = this.core.getState();
    this.apply(() => {
      const state = this.core.getState();
      if (Math.abs(clip.start - geometry.start) > 1e-9) {
        const trackIndex = state.tracks.findIndex((t) => t.id === clip.trackId);
        this.core.moveClips([{ id: clip.id, start: geometry.start, trackIndex }]);
      }
      const moved = this.findClip(clip.id);
      if (moved && Math.abs(moved.duration - duration) > 1e-9) {
        this.core.resizeClip(clip.id, "right", moved.start + duration);
      }
      const resized = this.findClip(clip.id);
      if (resized && Math.abs((resized.contentOffset ?? 0) - offset) > 1e-9) {
        this.core.setClipContentOffset(clip.id, offset);
      }
      if (clip.label !== next.name) this.core.setClipLabel(clip.id, next.name);
      const color = itemColor(next);
      if (clip.color !== color) this.core.setClipColor(clip.id, color);
      if ((clip.noSlice === true) !== noSlice) this.core.setClipNoSlice(clip.id, noSlice);
      // Amount-only edits don't change the playlist; give them their own
      // undo step anyway so undo/redo stays aligned with the document.
      if (this.core.getState() === before) this.core.touch();
    });

    this.commit(this.core.getState());
    return true;
  }

  deleteItem(id: string): boolean {
    const clip = this.findClip(id);
    if (!clip || !this.itemIndex.has(id) || this.isClipLocked(clip)) return false;
    // The sync archives the item when the clip disappears (undoable).
    this.core.deleteClip(id);
    return !this.itemIndex.has(id);
  }

  // Both are undo steps: the playlist is touched so the history gets an
  // entry the snapshot can be attached to.
  setInitialCash(amount: number): void {
    if (!Number.isFinite(amount) || amount === this.doc.initialCash) return;
    this.doc = { ...this.doc, initialCash: amount };
    this.commitTouch();
  }

  setMinimumCashReserve(amount: number): void {
    if (!Number.isFinite(amount) || amount === this.doc.minimumCashReserve) return;
    this.doc = { ...this.doc, minimumCashReserve: amount };
    this.commitTouch();
  }

  destroy(): void {
    this.destroyed = true;
    this.subscription.unsubscribe();
    this.listeners.clear();
    this.clearPending();
  }

  // --- playlist → document

  private handleState(state: PlaylistState): void {
    if (this.applying > 0 || this.destroyed) return;
    const open = this.core.getGestureBase() !== null;
    const closed = this.gestureOpen && !open;
    this.gestureOpen = open;
    if (!open) this.gestureNote = null;
    this.handlePlaylistState(state);
    // A gesture just ended: pin derived ends that were left free while it
    // was open (a goal-seek drag lands on the real payoff day).
    if (closed) this.sweepInvariants(this.core.getState());
  }

  private handlePlaylistState(state: PlaylistState): void {
    const snapshot = this.snapshots.get(state);
    if (snapshot) {
      // Undo / redo (or a re-notify of a known state).
      const changed = snapshot !== this.snap;
      if (changed) {
        this.doc = {
          ...this.doc,
          items: snapshot.items,
          initialCash: snapshot.initialCash,
          minimumCashReserve: snapshot.minimumCashReserve,
        };
        this.snap = snapshot;
      }
      const clipsChanged =
        state.clips !== this.lastClips || state.tracks !== this.lastTracks;
      if (clipsChanged) this.observe(state);
      if (changed) this.recompute();
      if (clipsChanged) this.sweepInvariants(state);
      return;
    }
    if (state.clips === this.lastClips && state.tracks === this.lastTracks) {
      // Hover / playhead / viewport: nothing financial changed, but this
      // state may later become an undo target.
      this.snapshots.set(state, this.snap);
      return;
    }
    this.syncFromPlaylist(state);
  }

  /** Derives the document from `state`; returns whether it recomputed. */
  private syncFromPlaylist(state: PlaylistState): boolean {
    const clipById = new Map<string, PlaylistClip>();
    for (const clip of state.clips) clipById.set(clip.id, clip);
    const excludedTracks = this.excludedTracks(state);
    const previousItems = this.itemIndex;
    // Open-endedness is judged against the item as it was when the current
    // pointer gesture started, so dragging an edge in and back out in one
    // gesture doesn't leave it finite.
    const gestureBase = this.core.getGestureBase();
    const baseSnapshot = gestureBase ? this.snapshots.get(gestureBase) : undefined;
    const openAtBase = baseSnapshot ? this.openEndedIds(baseSnapshot) : null;

    let changed = false;
    const nextItems: FinancialItem[] = [];
    const known = new Set<string>();

    for (const item of this.doc.items) {
      const clip = clipById.get(item.id);
      if (!clip) {
        this.archiveItem(item);
        changed = true;
        continue;
      }
      known.add(item.id);
      const next = this.deriveItem(
        item,
        clip,
        this.observed.get(item.id) ?? null,
        item.recurrence.endDate === undefined || (openAtBase?.has(item.id) ?? false),
        excludedTracks,
      );
      if (next !== item) changed = true;
      nextItems.push(next);
    }

    for (const clip of state.clips) {
      if (known.has(clip.id)) continue;
      nextItems.push(this.materialize(clip, state, previousItems, excludedTracks));
      changed = true;
    }

    this.observe(state);
    if (changed) {
      this.doc = { ...this.doc, items: nextItems };
      this.recompute();
    }
    this.snapshots.set(state, this.snap);
    this.sweepInvariants(state);
    return changed;
  }

  private deriveItem(
    item: FinancialItem,
    clip: PlaylistClip,
    previous: Observed | null,
    wasIndefinite: boolean,
    excludedTracks: Set<string>,
  ): FinancialItem {
    let recurrence = deriveRecurrence(this.doc, item, clip, previous, wasIndefinite);
    const sought = this.goalSeek(item, clip, previous);
    if (sought && sought.endDate !== undefined && recurrence.endDate !== sought.endDate) {
      recurrence = { ...recurrence, endDate: sought.endDate };
    }
    const payment =
      sought && "paymentAmount" in item && item.paymentAmount !== sought.paymentAmount
        ? sought.paymentAmount
        : undefined;

    let name = item.name;
    if (previous && clip.label !== previous.label) {
      const trimmed = clip.label.trim();
      if (trimmed) name = trimmed;
    }
    let color = item.color;
    if (previous && clip.color !== previous.color) {
      color = clip.color === KIND_COLORS[item.kind] ? undefined : clip.color;
    }
    const enabled =
      clip.muted === true || excludedTracks.has(clip.trackId) ? false : undefined;

    if (
      recurrence === item.recurrence &&
      name === item.name &&
      color === item.color &&
      enabled === item.enabled &&
      payment === undefined
    ) {
      return item;
    }
    const next = { ...item, recurrence, name } as FinancialItem;
    if (payment !== undefined) (next as { paymentAmount?: number }).paymentAmount = payment;
    if (color === undefined) delete next.color;
    else next.color = color;
    if (enabled === undefined) delete next.enabled;
    else next.enabled = enabled;
    return next;
  }

  // Goal-seek: the right edge of a debt dragged by the user = "free on that
  // date". Cards / balance loans get the payment that pays them off by then
  // (their end is re-pinned to the real payoff when the gesture ends);
  // window loans keep their total and spread it over the new window. Only
  // inside a user pointer gesture (never for editor saves / undo).
  private goalSeek(
    item: FinancialItem,
    clip: PlaylistClip,
    previous: Observed | null,
  ): { paymentAmount: number; endDate?: ISODate } | null {
    if (!previous || this.applying > 0 || this.core.getGestureBase() === null) return null;
    if (item.kind !== "credit-card" && item.kind !== "loan") return null;
    const resizedRight =
      Math.abs(clip.start - previous.start) <= EPS &&
      Math.abs(clip.duration - previous.duration) > EPS;
    if (!resizedRight) return null;
    const base = this.gestureBaseItem(item.id) ?? item;
    const windowLoan =
      base.kind === "loan" && base.balance === undefined && base.recurrence.endDate !== undefined;
    if (!isPayoffPinned(base) && !windowLoan) return null;
    if (base.kind === "credit-card" && base.paymentMode === "statement") {
      this.gestureNote = {
        text: "Pagas el total cada mes: queda libre cuando dejas de usarla",
        tone: "neutral",
      };
      return null;
    }
    const endBeat = Math.max(Math.round(clip.start) + 1, Math.round(clip.start + clip.duration));
    const target = dateOf(this.doc, endBeat - 1);
    const doc = {
      ...this.doc,
      items: this.doc.items.map((candidate) => (candidate.id === base.id ? base : candidate)),
    };
    const solution = solveDebtPayment(doc, base.id, target);
    if (!solution) return null;
    const per = base.kind === "credit-card" ? "/mes" : FREQUENCY_SHORT[base.recurrence.frequency];
    const payment = formatMoneyWhole(solution.paymentAmount);
    const when = solution.payoffDate ? formatMonthYear(solution.payoffDate) : "";
    if (!solution.feasible) {
      this.gestureNote = {
        text: when ? `Lo antes posible: ${when} pagando ${payment}${per}` : `Pagando ${payment}${per}`,
        tone: "negative",
      };
    } else {
      this.gestureNote = {
        text: `Libre en ${when} · pagas ${payment}${per}`,
        tone: "positive",
      };
    }
    return { paymentAmount: solution.paymentAmount, endDate: solution.endDate };
  }

  // The item as it was when the open gesture started.
  private gestureBaseItem(id: string): FinancialItem | null {
    const base = this.core.getGestureBase();
    const snapshot = base ? this.snapshots.get(base) : undefined;
    if (!snapshot) return null;
    for (const item of snapshot.items) if (item.id === id) return item;
    return null;
  }

  // Where a payoff-pinned debt's clip ends: the day after its payoff (or
  // the open end when it never pays off / owes nothing). A card's MSI
  // plans keep it open until their last installment.
  private pinnedEnd(item: FinancialItem, clip: PlaylistClip): number {
    const openEnd = openEndBeat(this.doc);
    const payoffs = this.payoffs();
    const endOf = (id: string): number | null => {
      const estimate = payoffs.get(id);
      if (!estimate || estimate.payoffDate === null) return null;
      if (estimate.payoffDate <= this.doc.startDate) return null;
      return Math.min(openEnd, beatOf(this.doc, estimate.payoffDate) + 1);
    };
    let end = endOf(item.id) ?? openEnd;
    if (item.kind === "credit-card") {
      for (const other of this.doc.items) {
        if (other.kind !== "installment-plan" || other.cardId !== item.id) continue;
        if (other.enabled === false) continue;
        const planEnd = endOf(other.id);
        if (planEnd !== null && planEnd > end) end = planEnd;
      }
    }
    return Math.max(end, Math.round(clip.start) + 1);
  }

  // The end a clip must have, or null when it is free (finite windows).
  private expectedEnd(item: FinancialItem, clip: PlaylistClip, openEnd: number): number | null {
    if (isPointItem(item)) return null;
    if (isPayoffPinned(item)) {
      // Never fight a drag in progress; the sweep at gesture end pins it.
      if (this.core.getGestureBase() !== null) return null;
      return this.pinnedEnd(item, clip);
    }
    return item.recurrence.endDate === undefined ? openEnd : null;
  }

  private resetTransient(): void {
    this.clearPending();
    this.level = null;
    this.preview = null;
    this.previewCache = null;
    this.highlight = new Set();
    this.gestureNote = null;
    this.transition = null;
    this.overviewCache = null;
    this.dragCache = null;
  }

  // Listeners without a revision bump: React (keyed on the revision) does
  // nothing, the renderer repaints (preview / highlight / animation).
  private notifyVisual(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }

  private previewData(preview: FinancialPreview): {
    doc: FinancialDocument;
    projection: FinancialProjection;
    warnings: LiquidityWarning[];
  } {
    const cached = this.previewCache;
    if (cached && cached.revision === this.revision && cached.preview === preview) return cached;
    let doc: FinancialDocument;
    if (preview.kind === "document") {
      doc = preview.doc;
    } else {
      const items =
        preview.kind === "exclude"
          ? this.doc.items.map((item) =>
              item.id === preview.itemId ? ({ ...item, enabled: false } as FinancialItem) : item,
            )
          : [
              ...this.doc.items,
              canonicalItem({ ...preview.item, id: "preview-draft" } as FinancialItem),
            ];
      doc = { ...this.doc, items };
    }
    const projection = projectFinancialDocument(doc);
    const warnings = findLiquidityWarnings(projection, doc.minimumCashReserve);
    this.previewCache = { revision: this.revision, preview, doc, projection, warnings };
    return this.previewCache;
  }

  private comparisonSeries(doc: FinancialDocument): PlaylistStepSeries {
    const cached = this.comparisonCache;
    if (cached && cached.doc === doc) return cached.series;
    const series = cashSeries(this.doc, projectFinancialDocument(doc));
    this.comparisonCache = { doc, series };
    return series;
  }

  // One frame of the branch-switch morph, or null when none is running.
  // Allocates per frame only while the ~320 ms animation runs.
  private transitionFrame(settled: PlaylistOverviewData): PlaylistOverviewData | null {
    const transition = this.transition;
    if (!transition) return null;
    const elapsed = now() - transition.t0;
    if (elapsed >= TRANSITION_MS) {
      this.transition = null;
      return null;
    }
    const k = easeInOut(Math.max(0, elapsed / TRANSITION_MS));
    const from = transition.from;
    const to = settled.primary;
    const lerp = (beat: number) =>
      stepSeriesValueAt(from, beat) * (1 - k) + stepSeriesValueAt(to, beat) * k;
    const values = transition.beats.map((beat) => lerp(beat));
    return {
      ...settled,
      primary: { initial: lerp(0), beats: transition.beats, values },
      annotations: [],
    };
  }

  private materialize(
    clip: PlaylistClip,
    state: PlaylistState,
    previousItems: Map<string, FinancialItem>,
    excludedTracks: Set<string>,
  ): FinancialItem {
    let base: FinancialItem;
    let geometry: ObservedGeometry | null = null;
    let generic = false;

    const template = this.templateFromSource(clip, previousItems);
    if (template) {
      base = cloneItem(template.item, clip.id);
      geometry = template.geometry;
      // A paste copies the clip as it was when copied, which may differ
      // from the source's length now: compare against the clipboard copy.
      if (base.recurrence.endDate === undefined && state.clipboard) {
        for (const entry of state.clipboard.entries) {
          if (
            entry.clip.sourceId === clip.sourceId &&
            Math.abs(entry.clip.duration - clip.duration) <= EPS
          ) {
            geometry = { start: entry.clip.start, duration: entry.clip.duration };
            break;
          }
        }
      }
    } else {
      const sameTrack = this.templateFromTrack(clip, previousItems);
      if (sameTrack) {
        base = cloneItem(sameTrack, clip.id);
      } else {
        generic = true;
        base = createDefaultFinancialItem(
          "expense",
          clip.id,
          dateOf(this.doc, Math.round(clip.start)),
          this.doc,
        );
        base.name = KIND_LABELS.expense;
      }
    }

    // A clip stamped from the playlist's built-in template ("Clip", default
    // colour) carries no user intent: keep the item's name and colour.
    const label = clip.label.trim();
    const genericClip = label === "" || label === GENERIC_CLIP_LABEL;
    const item = { ...base, name: genericClip ? base.name : label } as FinancialItem;
    if (!generic && !genericClip && clip.color !== itemColor(base)) {
      if (clip.color === KIND_COLORS[item.kind]) delete item.color;
      else item.color = clip.color;
    }
    item.recurrence = deriveRecurrence(
      this.doc,
      base,
      clip,
      geometry,
      base.recurrence.endDate === undefined,
    );
    if (clip.muted === true || excludedTracks.has(clip.trackId)) item.enabled = false;
    else delete item.enabled;

    const result = canonicalItem(item);
    if (clip.label !== result.name || clip.color !== itemColor(result)) {
      this.pendingLabel.add(clip.id);
    }
    return result;
  }

  private templateFromSource(
    clip: PlaylistClip,
    previousItems: Map<string, FinancialItem>,
  ): Template | null {
    const sourceId = clip.sourceId;
    if (!sourceId || sourceId === clip.id) return null;
    // Financial clips have unique sourceIds, so this is the copied clip.
    for (const [id, observed] of this.observed) {
      if (observed.sourceId !== sourceId) continue;
      const item = previousItems.get(id);
      if (item) return { item, geometry: observed };
    }
    const archived = this.archiveBySource.get(sourceId);
    if (archived) return archived;
    const direct = previousItems.get(sourceId);
    return direct ? { item: direct, geometry: this.observed.get(sourceId) ?? null } : null;
  }

  private templateFromTrack(
    clip: PlaylistClip,
    previousItems: Map<string, FinancialItem>,
  ): FinancialItem | null {
    for (const [id, observed] of this.observed) {
      if (observed.trackId !== clip.trackId) continue;
      const item = previousItems.get(id);
      if (item) return item;
    }
    return null;
  }

  private archiveItem(item: FinancialItem): void {
    const observed = this.observed.get(item.id);
    const geometry = observed
      ? { start: observed.start, duration: observed.duration }
      : null;
    this.archiveBySource.set(observed?.sourceId ?? item.id, { item, geometry });
  }

  private openEndedIds(snapshot: DocSnapshot): Set<string> {
    const ids = new Set<string>();
    for (const item of snapshot.items) {
      if (!isPointItem(item) && item.recurrence.endDate === undefined) ids.add(item.id);
    }
    return ids;
  }

  // Invariants every financial clip should satisfy; violations are queued
  // for the correction microtask. O(N), runs only when clips/tracks changed.
  //  - a sourceId of its own (copies must template from the exact clip),
  //  - noSlice === !isSliceable(item),
  //  - a one-time event away from beat 0 has no content offset,
  //  - an open-ended window ends on the open-end sentinel (unless it was
  //    parked past it, where a resize could only collapse it).
  private sweepInvariants(state: PlaylistState): void {
    const openEnd = openEndBeat(this.doc);
    const owners = new Map<string, string>();
    for (const clip of state.clips) {
      const item = this.itemIndex.get(clip.id);
      if (!item) continue;
      const sourceId = clip.sourceId;
      if (sourceId !== undefined) {
        const owner = owners.get(sourceId);
        if (owner === undefined) {
          owners.set(sourceId, clip.id);
        } else if (clip.id === sourceId) {
          this.pendingUnique.add(owner);
          owners.set(sourceId, clip.id);
        } else {
          this.pendingUnique.add(clip.id);
        }
      }
      if ((clip.noSlice === true) !== !isSliceable(item)) this.pendingNoSlice.add(clip.id);
      if (isPointItem(item)) {
        if (clip.start > EPS && Math.abs(clip.contentOffset ?? 0) > EPS) {
          this.pendingOffset.add(clip.id);
        }
      } else {
        const expected = this.expectedEnd(item, clip, openEnd);
        if (
          expected !== null &&
          Math.abs(clip.start + clip.duration - expected) > EPS &&
          clip.start < openEnd - 1
        ) {
          this.pendingRepin.add(clip.id);
        }
      }
    }
    this.queueCorrections();
  }

  private clearPending(): void {
    this.pendingLabel.clear();
    this.pendingUnique.clear();
    this.pendingNoSlice.clear();
    this.pendingOffset.clear();
    this.pendingRepin.clear();
  }

  // Follow-up corrections: label / colour of clips materialised from a
  // generic stamp, unique sourceIds, noSlice flags, point offsets, the
  // open-end pin. Runs in a microtask (never re-entrantly inside a notify)
  // through core.amend, so it joins the undo entry of the edit that caused
  // it. Lookups use one Map; sourceIds are fixed in ONE dispatch.
  private queueCorrections(): void {
    if (this.correctionQueued) return;
    if (
      this.pendingLabel.size === 0 &&
      this.pendingUnique.size === 0 &&
      this.pendingNoSlice.size === 0 &&
      this.pendingOffset.size === 0 &&
      this.pendingRepin.size === 0
    ) {
      return;
    }
    this.correctionQueued = true;
    queueMicrotask(() => {
      this.correctionQueued = false;
      if (this.destroyed) return;
      const labels = Array.from(this.pendingLabel);
      const unique = Array.from(this.pendingUnique);
      const noSlice = Array.from(this.pendingNoSlice);
      const offsets = Array.from(this.pendingOffset);
      const repin = Array.from(this.pendingRepin);
      this.clearPending();

      const state = this.core.getState();
      const clipById = new Map<string, PlaylistClip>();
      for (const clip of state.clips) clipById.set(clip.id, clip);
      const locked = new Set<string>();
      for (const track of state.tracks) if (track.locked === true) locked.add(track.id);
      const target = (id: string) => {
        const clip = clipById.get(id);
        const item = this.itemIndex.get(id);
        return clip && item && !locked.has(clip.trackId) ? { clip, item } : null;
      };
      const openEnd = openEndBeat(this.doc);

      this.applying += 1;
      try {
        this.core.amend(() => {
          for (const id of labels) {
            const hit = target(id);
            if (!hit) continue;
            if (hit.clip.label !== hit.item.name) this.core.setClipLabel(id, hit.item.name);
            const color = itemColor(hit.item);
            if (hit.clip.color !== color) this.core.setClipColor(id, color);
          }
          for (const id of noSlice) {
            const hit = target(id);
            if (!hit) continue;
            const want = !isSliceable(hit.item);
            if ((hit.clip.noSlice === true) !== want) this.core.setClipNoSlice(id, want);
          }
          for (const id of offsets) {
            const hit = target(id);
            if (!hit || !isPointItem(hit.item)) continue;
            if (hit.clip.start > EPS && Math.abs(hit.clip.contentOffset ?? 0) > EPS) {
              this.core.setClipContentOffset(id, 0);
            }
          }
          for (const id of repin) {
            const hit = target(id);
            if (!hit) continue;
            const want = this.expectedEnd(hit.item, hit.clip, openEnd);
            if (want === null) continue;
            const end = hit.clip.start + hit.clip.duration;
            if (Math.abs(end - want) > EPS && hit.clip.start < openEnd - 1) {
              this.core.resizeClip(id, "right", want);
            }
          }
          const uniqueIds = unique.filter((id) => target(id) !== null);
          if (uniqueIds.length > 0) {
            this.core.dispatch({ type: "MAKE_CLIPS_UNIQUE", clipIds: uniqueIds });
          }
        });
      } finally {
        this.applying -= 1;
      }
      const after = this.core.getState();
      if (after.clips !== this.lastClips || after.tracks !== this.lastTracks) {
        this.observe(after);
      }
      this.snapshots.set(after, this.snap);
    });
  }

  // --- helpers

  private apply(mutate: () => void): void {
    this.applying += 1;
    this.core.beginGesture();
    try {
      mutate();
    } finally {
      this.core.endGesture();
      this.applying -= 1;
    }
  }

  // After a bridge-initiated playlist change: derive siblings, record the
  // snapshot, and recompute even when no geometry changed (amount edits).
  private commit(state: PlaylistState): void {
    if (!this.syncFromPlaylist(state)) this.recompute();
    this.snapshots.set(state, this.snap);
  }

  // A document-level edit with no playlist change of its own.
  private commitTouch(): void {
    this.apply(() => this.core.touch());
    this.recompute();
    this.snapshots.set(this.core.getState(), this.snap);
  }

  private recompute(): void {
    const doc = this.doc;
    if (
      this.snap.items !== doc.items ||
      this.snap.initialCash !== doc.initialCash ||
      this.snap.minimumCashReserve !== doc.minimumCashReserve
    ) {
      this.snap = {
        items: doc.items,
        initialCash: doc.initialCash,
        minimumCashReserve: doc.minimumCashReserve,
      };
    }
    this.projection = projectFinancialDocument(this.doc);
    this.warnings = findLiquidityWarnings(
      this.projection,
      this.doc.minimumCashReserve,
    );
    this.rebuildIndex();
    this.revision += 1;
    for (const listener of Array.from(this.listeners)) listener();
  }

  private rebuildIndex(): void {
    const index = new Map<string, FinancialItem>();
    for (const item of this.doc.items) index.set(item.id, item);
    this.itemIndex = index;
    this.detailCache.clear();
    this.detailDay = Number.NaN;
    if (this.contentIndex) this.previousContent = this.contentIndex;
    this.contentIndex = null;
    if (this.trackMetaIndex) this.previousTrackMeta = this.trackMetaIndex;
    this.trackMetaIndex = null;
    if (this.sparkIndex) this.previousSpark = this.sparkIndex;
    this.sparkIndex = null;
  }

  private buildSparkIndex(): Map<string, number[]> {
    const magnitudes = new Map<string, number[]>();
    for (const point of this.projection.points) {
      // Interest and an MSI's debt opening move no cash: not "payments".
      if (point.type === "credit-card-interest" || point.type === "debt-opening") continue;
      const value = Math.abs(point.cashDelta) || Math.abs(point.debtDelta);
      if (value <= 0) continue;
      let list = magnitudes.get(point.itemId);
      if (!list) {
        list = [];
        magnitudes.set(point.itemId, list);
      }
      list.push(value);
    }
    const bars = new Map<string, number[]>();
    for (const [itemId, values] of magnitudes) {
      const step = values.length > MAX_SPARK_BARS ? values.length / MAX_SPARK_BARS : 1;
      const sampled: number[] = [];
      for (let i = 0; i < values.length && sampled.length < MAX_SPARK_BARS; i += step) {
        sampled.push(values[Math.floor(i)]!);
      }
      let max = 0;
      for (const v of sampled) if (v > max) max = v;
      const series = sampled.map((v) => (max > 0 ? 0.25 + 0.6 * (v / max) : 0.5));
      // Keep the previous array when equal: the renderer redraws a clip
      // body only when the reference changes.
      const previous = this.previousSpark.get(itemId);
      bars.set(itemId, previous && sameBars(previous, series) ? previous : series);
    }
    return bars;
  }

  private excludedTracks(state: PlaylistState): Set<string> {
    const anySolo = state.tracks.some((track) => track.soloed === true);
    const excluded = new Set<string>();
    for (const track of state.tracks) {
      if (track.muted === true || (anySolo && track.soloed !== true)) {
        excluded.add(track.id);
      }
    }
    return excluded;
  }

  private observe(state: PlaylistState): void {
    const observed = new Map<string, Observed>();
    for (const clip of state.clips) {
      observed.set(clip.id, {
        start: clip.start,
        duration: clip.duration,
        label: clip.label,
        color: clip.color,
        sourceId: clip.sourceId,
        trackId: clip.trackId,
      });
    }
    this.observed = observed;
    this.lastClips = state.clips;
    this.lastTracks = state.tracks;
    if (this.trackMetaIndex) this.previousTrackMeta = this.trackMetaIndex;
    this.trackMetaIndex = null;
  }

  private isClipLocked(clip: PlaylistClip): boolean {
    const state = this.core.getState();
    return state.tracks.some((track) => track.id === clip.trackId && track.locked === true);
  }

  private playheadDay(): number {
    return Math.max(0, Math.floor(this.core.getState().playPosition.time));
  }

  private debtAt(day: number): Map<string, number> {
    const cached = this.debtAtDay;
    if (cached && cached.revision === this.revision && cached.day === day) return cached.value;
    const value = debtByAccountAt(this.projection, dateOf(this.doc, day));
    this.debtAtDay = { revision: this.revision, day, value };
    return value;
  }

  // The document as it was when the open pointer gesture started, when it
  // differs from now (null otherwise): the "before" of the gesture.
  private gestureBaseline(): DocSnapshot | null {
    const base = this.core.getGestureBase();
    if (!base) return null;
    const snapshot = this.snapshots.get(base);
    return snapshot && snapshot !== this.snap ? snapshot : null;
  }

  private projectionOf(snapshot: DocSnapshot): FinancialProjection {
    if (snapshot === this.snap) return this.projection;
    let projection = this.snapshotProjections.get(snapshot);
    if (!projection) {
      projection = projectFinancialDocument({
        ...this.doc,
        items: snapshot.items,
        initialCash: snapshot.initialCash,
        minimumCashReserve: snapshot.minimumCashReserve,
      });
      this.snapshotProjections.set(snapshot, projection);
    }
    return projection;
  }

  // Payoff estimates only depend on debt-related items: reuse them while
  // those item objects are unchanged (dragging income doesn't recompute).
  private payoffs(): Map<string, DebtPayoffEstimate> {
    const key = this.doc.items.filter(
      (item) =>
        item.kind === "credit-card" ||
        item.kind === "loan" ||
        item.kind === "installment-plan" ||
        item.kind === "card-purchase",
    );
    const cached = this.payoffCache;
    if (
      cached &&
      cached.key.length === key.length &&
      cached.key.every((item, index) => item === key[index])
    ) {
      return cached.value;
    }
    const value = estimateDebtPayoffs(this.doc);
    this.payoffCache = { key, value };
    return value;
  }

  private findClip(id: string): PlaylistClip | undefined {
    return this.core.getState().clips.find((clip) => clip.id === id);
  }

  private makeItemId(kind: FinancialItemKind): string {
    const clips = this.core.getState().clips;
    let id: string;
    do {
      this.idCounter += 1;
      id = `fin-${kind}-${this.idCounter}`;
    } while (this.itemIndex.has(id) || clips.some((clip) => clip.id === id));
    return id;
  }
}
