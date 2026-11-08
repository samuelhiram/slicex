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
} from "@slicex/core";
import type {
  PlaylistClipContent,
  PlaylistCore,
  PlaylistDragAnnotation,
  PlaylistOverviewData,
  PlaylistTrackMeta,
} from "@slicex/canvas";

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
  createDraftItem(kind: FinancialItemKind): FinancialItem;
  /**
   * Adds a (draft) item: creates its clip (one undo entry) on a suitable
   * lane and the item. Returns the id actually used (item.id unless taken).
   */
  addItem(item: FinancialItem): string;

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

  destroy(): void;
}
