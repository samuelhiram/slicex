// Alternative futures ("ramas tipo git") of a plan. One branch is active —
// it lives in the bridge / playlist with its undo history — the others are
// parked as documents plus, once visited, their playlist session (so each
// future keeps its own undo stack). Switching morphs the money lane from
// one future to the other; a non-active future can be drawn as a ghost
// under the active curve (comparison).
//
// Plain TS (no React). React reads it through `subscribe` / `getVersion`.
import type { FinancialDocument, ISODate, LedgerEntry } from "@slicex/core";
import type { FinancialBridgeApi, FinancialSession } from "./bridge-api";
import { formatDateShort } from "./format";
import type { FinancialTrackLayout } from "./mapping";
import type { SavedPlan } from "./persistence";

export interface Branch {
  id: string;
  name: string;
  forkDate: ISODate | null;
  /** Latest document of the branch (the active one's is read live). */
  doc: FinancialDocument;
  /** Playlist session (undo history) once the branch has been active. */
  session: FinancialSession | null;
  /** Its rows and placements (the active one's is read live). */
  layout: FinancialTrackLayout | null;
}

export const MAIN_BRANCH_ID = "main";

export class Futures {
  private readonly bridge: FinancialBridgeApi;
  private branches: Branch[];
  private activeId: string;
  private compareId: string | null;
  private ledger: LedgerEntry[];
  private version = 0;
  private counter = 0;
  private readonly listeners = new Set<() => void>();

  constructor(bridge: FinancialBridgeApi, saved: SavedPlan | null = null) {
    this.bridge = bridge;
    if (saved) {
      this.branches = saved.branches.map((branch) => ({
        ...branch,
        session: null,
        layout: branch.layout ?? null,
      }));
      this.activeId = saved.activeId;
      this.compareId = saved.compareId;
      this.ledger = saved.ledger;
    } else {
      this.branches = [
        {
          id: MAIN_BRANCH_ID,
          name: "Plan principal",
          forkDate: null,
          doc: bridge.getDocument(),
          session: null,
          layout: null,
        },
      ];
      this.activeId = MAIN_BRANCH_ID;
      this.compareId = null;
      this.ledger = [];
    }
    for (const branch of this.branches) {
      const match = /^rama-(\d+)$/.exec(branch.id);
      if (match) this.counter = Math.max(this.counter, Number(match[1]));
    }
    this.applyComparison();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getVersion = (): number => this.version;

  list(): readonly Branch[] {
    return this.branches;
  }

  activeBranch(): Branch {
    return this.branches.find((branch) => branch.id === this.activeId) ?? this.branches[0]!;
  }

  comparedBranch(): Branch | null {
    return this.branches.find((branch) => branch.id === this.compareId) ?? null;
  }

  /** The latest document of a branch (the active one is read from the bridge). */
  docOf(id: string): FinancialDocument | null {
    if (id === this.activeId) return this.bridge.getDocument();
    return this.branches.find((branch) => branch.id === id)?.doc ?? null;
  }

  /**
   * The future to peek at with "hold Q": the compared one, else the most
   * recently created other branch. null with a single future.
   */
  peekTarget(): Branch | null {
    const compared = this.comparedBranch();
    if (compared) return compared;
    for (let i = this.branches.length - 1; i >= 0; i -= 1) {
      const branch = this.branches[i]!;
      if (branch.id !== this.activeId) return branch;
    }
    return null;
  }

  /**
   * "Bifurcar aquí": the current plan is parked as it is and a new future
   * starts from it (and becomes active). The current undo history goes on
   * in the new future, so Ctrl+Z still reaches the shared past.
   */
  fork(forkDate: ISODate, name?: string): Branch {
    const current = this.activeBranch();
    current.doc = this.bridge.getDocument();
    current.session = this.bridge.exportSession();
    current.layout = this.bridge.getTrackLayout();
    this.counter += 1;
    const branch: Branch = {
      id: `rama-${this.counter}`,
      name: name?.trim() || `Rama desde ${formatDateShort(forkDate)}`,
      forkDate,
      doc: current.doc,
      session: null,
      layout: current.layout,
    };
    this.branches = [...this.branches, branch];
    this.activeId = branch.id;
    // Compare the new future against where it came from.
    this.compareId = current.id;
    this.applyComparison();
    this.changed();
    return branch;
  }

  switchTo(id: string): void {
    if (id === this.activeId) return;
    const target = this.branches.find((branch) => branch.id === id);
    if (!target) return;
    const current = this.activeBranch();
    const before = this.bridge.getOverviewData()?.primary ?? null;
    current.doc = this.bridge.getDocument();
    current.session = this.bridge.exportSession();
    current.layout = this.bridge.getTrackLayout();
    this.bridge.setPreview(null);
    if (target.session) this.bridge.importSession(target.session);
    else this.bridge.loadDocument(target.doc, target.layout);
    this.activeId = id;
    if (this.compareId === id) this.compareId = current.id;
    this.applyComparison();
    this.bridge.animateFrom(before);
    this.changed();
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim();
    const branch = this.branches.find((candidate) => candidate.id === id);
    if (!branch || !trimmed || branch.name === trimmed) return;
    this.branches = this.branches.map((candidate) =>
      candidate.id === id ? { ...candidate, name: trimmed } : candidate,
    );
    this.changed();
  }

  remove(id: string): void {
    if (this.branches.length <= 1) return;
    if (id === this.activeId) {
      const other = this.branches.find((branch) => branch.id !== id)!;
      this.switchTo(other.id);
    }
    this.branches = this.branches.filter((branch) => branch.id !== id);
    if (this.compareId === id) this.compareId = null;
    this.applyComparison();
    this.changed();
  }

  setCompare(id: string | null): void {
    const next = id && id !== this.activeId && this.branches.some((b) => b.id === id) ? id : null;
    if (next === this.compareId) return;
    this.compareId = next;
    this.applyComparison();
    this.changed();
  }

  getCompareId(): string | null {
    return this.compareId;
  }

  getActiveId(): string {
    return this.activeId;
  }

  getLedger(): readonly LedgerEntry[] {
    return this.ledger;
  }

  appendLedger(entries: readonly LedgerEntry[]): void {
    if (entries.length === 0) return;
    this.ledger = [...this.ledger, ...entries];
    this.changed();
  }

  /** Replaces entries with the same eventId (corrections) and appends new ones. */
  upsertLedger(entries: readonly LedgerEntry[]): void {
    if (entries.length === 0) return;
    const byId = new Map<string, LedgerEntry>();
    for (const entry of entries) byId.set(entry.eventId, entry);
    const kept = this.ledger.map((entry) => {
      const next = byId.get(entry.eventId);
      if (next) byId.delete(entry.eventId);
      return next ?? entry;
    });
    this.ledger = [...kept, ...byId.values()];
    this.changed();
  }

  /**
   * Replace every parked future's document (e.g. after rolling the whole
   * plan forward to a new day). The active one goes through the bridge.
   */
  replaceParkedDocs(map: (doc: FinancialDocument) => FinancialDocument): void {
    this.branches = this.branches.map((branch) =>
      branch.id === this.activeId ? branch : { ...branch, doc: map(branch.doc), session: null },
    );
    this.applyComparison();
    this.changed();
  }

  /** Snapshot for persistence. */
  toSaved(): SavedPlan {
    return {
      v: 1,
      activeId: this.activeId,
      compareId: this.compareId,
      branches: this.branches.map((branch) => ({
        id: branch.id,
        name: branch.name,
        forkDate: branch.forkDate,
        doc: branch.id === this.activeId ? this.bridge.getDocument() : branch.doc,
        layout: branch.id === this.activeId ? this.bridge.getTrackLayout() : branch.layout,
      })),
      ledger: this.ledger,
    };
  }

  private applyComparison(): void {
    const compared = this.comparedBranch();
    this.bridge.setComparison(compared ? compared.doc : null);
  }

  private changed(): void {
    this.version += 1;
    for (const listener of Array.from(this.listeners)) listener();
  }
}
