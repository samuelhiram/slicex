// Public contract of the financial ↔ playlist bridge. React components only
// depend on this interface (plus pure functions from @slicex/core); the
// implementation lives in financial-bridge.ts.
//
// Ownership of truth:
// - Playlist clip geometry (start / duration / contentOffset) is the truth
//   for an item's dates. 1 beat = 1 day, beat 0 = document.startDate.
//   Drag / resize / slice / undo in the playlist rewrite the item dates.
// - Everything non-temporal (amounts, kind, card params) lives in the
//   FinancialDocument held by the bridge. item.id === clip.id.
import type {
  FinancialDocument,
  FinancialItem,
  FinancialItemKind,
  FinancialProjection,
  FinancialSnapshot,
  ISODate,
  LiquidityWarning,
  UpcomingPayment,
  ValleyExplanation,
  ValleyFix,
} from "@slicex/core";
import type {
  PlaylistClipContent,
  PlaylistCore,
  PlaylistDragAnnotation,
  PlaylistOverviewData,
  PlaylistSession,
  PlaylistStepSeries,
  PlaylistTrackMeta,
} from "@slicex/canvas";
import type { FinancialTrackLayout } from "./mapping";

/** A what-if shown on the money lane without touching the plan. */
export type FinancialPreview =
  | { kind: "exclude"; itemId: string }
  | { kind: "add"; item: FinancialItem }
  // Another future (branch) shown in place of the current one.
  | { kind: "document"; doc: FinancialDocument };

export interface PreviewEffect {
  text: string;
  tone: PlaylistDragAnnotation["tone"];
  minBefore: number;
  minAfter: number;
  minAfterDate: ISODate;
  finalBefore: number;
  finalAfter: number;
}

/** A valley (episode below the reserve), why it happens and how to fix it. */
export interface ValleyInsight {
  warning: LiquidityWarning;
  explanation: ValleyExplanation;
  fixes: ValleyFix[];
}

/** Where a new item should go: a row of the playlist (endless rows included). */
export interface FinancialPlacement {
  trackIndex: number;
}

/** A document with its playlist undo history (alternative futures). */
export interface FinancialSession {
  session: PlaylistSession;
  doc: FinancialDocument;
}

export interface FinancialBridgeApi {
  readonly core: PlaylistCore;

  /**
   * Monotonic counter bumped whenever the document or the projection
   * changes. NOT bumped by hover / playhead / viewport changes. Pair with
   * `subscribe` in `React.useSyncExternalStore(bridge.subscribe, bridge.getRevision)`.
   */
  getRevision(): number;
  /** Returns the unsubscribe function (useSyncExternalStore-compatible). */
  subscribe(listener: () => void): () => void;

  getDocument(): FinancialDocument;
  getProjection(): FinancialProjection;
  getItem(id: string): FinancialItem | null;

  /**
   * Editor "Save": replaces the item with the same id. Date changes are
   * pushed to the clip geometry as ONE undo entry; name → clip label;
   * kind/colour → clip colour. Kind changes are allowed. Returns false (and
   * changes nothing) when the item is missing or its track is locked.
   */
  replaceItem(item: FinancialItem): boolean;
  /**
   * Editor "Delete": removes the clip (undoable) and the item. Returns
   * false when nothing was deleted (missing item or locked track).
   */
  deleteItem(id: string): boolean;
  /** True when the item's clip sits on a locked track (read-only). */
  isItemLocked(id: string): boolean;
  /**
   * A NEW item of `kind` with sensible defaults dated at the playhead day
   * and a fresh unused id. Nothing is added to the document or playlist:
   * the editor edits this draft and calls `addItem` on "Guardar" only.
   */
  createDraftItem(kind: FinancialItemKind, atDay?: number): FinancialItem;
  /**
   * Adds a (draft) item: creates its clip (one undo entry) on a suitable
   * lane — the picked row when `placement` gives one that is writable and
   * free at its dates — and the item. Returns the id actually used.
   */
  addItem(item: FinancialItem, placement?: FinancialPlacement): string;

  setInitialCash(amount: number): void;
  setMinimumCashReserve(amount: number): void;

  /** beat → ISO date (floors to the day). */
  dateAtBeat(beat: number): ISODate;
  /** ISO date → beat (may be negative for dates before startDate). */
  beatAtDate(date: ISODate): number;

  snapshotAt(date: ISODate): FinancialSnapshot;
  nextPaymentAfter(date: ISODate): UpcomingPayment | null;
  /** Episodes below `minimumCashReserve` in the current projection. */
  getWarnings(): LiquidityWarning[];

  // --- Renderer providers. All are called from the render loop: O(1)
  // cached lookups that return the SAME object while unchanged.

  /** Secondary text drawn inside a clip (follows the playhead day), or null. */
  getClipDetail(clipId: string): string | null;
  /** Sparkline bars (0..1) for a clip, or null to fall back to default. */
  getClipSparkline(clipId: string): number[] | null;
  /** Payments at their real dates (events) or remaining debt (level). */
  getClipContent(clipId: string): PlaylistClipContent | null;
  /** The money waveform: cash (primary), debt (secondary), reserve/0, valleys,
   *  and while a gesture is open the curve before it (baseline). */
  getOverviewData(): PlaylistOverviewData | null;
  /** While a gesture is open: its effect ("Mín −$1,292 → +$2,208 · sales del rojo"). */
  getDragAnnotation(): PlaylistDragAnnotation | null;
  /** Track header subtitle + yearly-impact meter. */
  getTrackMeta(trackId: string): PlaylistTrackMeta | null;
  /** Host highlight of a clip (e.g. it causes the valley being inspected). */
  isHighlighted(clipId: string): boolean;
  /**
   * Lines under the date of a time tooltip: "Caja $12,000" (end of that
   * day) and that day's movements ("+$9,000 Sueldo", "−$7,500 Préstamo"),
   * "\n"-separated. Cached: the same string while unchanged.
   */
  getDayDetail(beat: number): string | null;
  /**
   * Whether the clip offers the extend grabber (its length means something:
   * not a one-time event). O(1); called per frame for the selected clip.
   */
  canExtend(clipId: string): boolean;
  /** Every row (empty ones too) and where each item sits: saved with the plan. */
  getTrackLayout(): FinancialTrackLayout;

  // --- Wave 2: the line responds

  /**
   * Amount by hand (vertical drag on a clip's top edge, wired to the
   * interaction controller's onClipLevelDrag). Returns the tooltip text.
   */
  levelDrag(clipId: string, phase: "start" | "move" | "end", deltaY: number): string | null;
  /** The valley the day falls in, explained, with up to 3 fixes (cached per revision). */
  valleyAt(day: number): ValleyInsight | null;
  /** Applies a fix (one undo entry). */
  applyValleyFix(fix: ValleyFix): boolean;
  /** Clips to emphasise (e.g. the causes of a valley); null clears. */
  setHighlight(itemIds: readonly string[] | null): void;

  // --- Wave 3: futures

  /** Show a what-if on the lane (plan untouched); null clears. */
  setPreview(preview: FinancialPreview | null): void;
  getPreview(): FinancialPreview | null;
  getPreviewEffect(): PreviewEffect | null;
  /** Another future to draw as a ghost under the current curve; null clears. */
  setComparison(doc: FinancialDocument | null): void;
  getComparison(): FinancialDocument | null;
  /** Morph the lane from `series` to the current curve (~320 ms). */
  animateFrom(series: PlaylistStepSeries | null): void;
  isAnimating(): boolean;
  exportSession(): FinancialSession;
  importSession(session: FinancialSession): void;
  /** Replace the whole plan (fresh playlist + history, same zoom); `layout` restores its rows. */
  loadDocument(doc: FinancialDocument, layout?: FinancialTrackLayout | null): void;

  destroy(): void;
}
