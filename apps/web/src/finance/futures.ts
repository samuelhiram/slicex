// Alternative futures ("ramas tipo git") of a plan. One branch is active —
// it lives in the bridge / playlist with its undo history — the others are
// parked as documents plus, once visited, their playlist session (so each
// future keeps its own undo stack). Switching morphs the money lane from
// one future to the other; a non-active future can be drawn as a ghost
// under the active curve (comparison).
//
// Plain TS (no React). React reads it through `subscribe` / `getVersion`.
//
// UX audit 2026-11-11:
// - UX-54: two futures never share a name ("Otra versión 2"); the person can
//   make a future the main plan or discard it in one action, each undoable.
// - UX-21: "Probar cambios" is a TEMPORARY future (`trialOf` = where it
//   came from): the person edits freely, then keeps the changes (the trial
//   takes its origin's place) or discards them (back to the origin exactly
//   as it was — its document and its undo history).
// - UX-20: each future's figures (horizon, lowest point, debt) are cached
//   per document object: computed once per revision, never per frame.
import {
  projectFinancialDocument,
  summarizeProjection,
  type FinancialDocument,
  type FinancialProjection,
  type ISODate,
  type LedgerEntry,
  type ProjectionSummary,
} from "@slicex/core";
import type { FinancialBridgeApi, FinancialSession } from "./bridge-api";
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
  /** A "Probar cambios" trial: the id of the future it copies (session only, not saved). */
  trialOf?: string;
}

export const MAIN_BRANCH_ID = "main";

/** Opaque snapshot of the futures list, for "Deshacer" of a futures action. */
export interface FuturesSnapshot {
  branches: Branch[];
  activeId: string;
  compareId: string | null;
  /** true: the action only relabelled the future on screen (keep / adopt). */
  relabel: boolean;
}

/** `base`, or `base 2`, `base 3`… — the first name no other future uses. */
export function uniqueFutureName(base: string, taken: Iterable<string>): string {
  const names = new Set(Array.from(taken, (name) => name.trim().toLocaleLowerCase("es-MX")));
  const clean = base.trim();
  if (!names.has(clean.toLocaleLowerCase("es-MX"))) return clean;
  for (let n = 2; ; n += 1) {
    const candidate = `${clean} ${n}`;
    if (!names.has(candidate.toLocaleLowerCase("es-MX"))) return candidate;
  }
}

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
   * "Probar otra versión de mi año": the current plan is parked as it is and
   * a new future starts from it (and becomes active). The current undo
   * history goes on in the new future, so Ctrl+Z still reaches the shared
   * past. Its name is unique ("Otra versión 2" when one exists).
   */
  fork(forkDate: ISODate, name?: string, trialOf?: string): Branch {
    const current = this.activeBranch();
    current.doc = this.bridge.getDocument();
    current.session = this.bridge.exportSession();
    current.layout = this.bridge.getTrackLayout();
    this.counter += 1;
    const branch: Branch = {
      id: `rama-${this.counter}`,
      name: uniqueFutureName(
        name?.trim() || "Otra versión",
        this.branches.map((other) => other.name),
      ),
      forkDate,
      doc: current.doc,
      session: null,
      layout: current.layout,
    };
    if (trialOf !== undefined) branch.trialOf = trialOf;
    this.branches = [...this.branches, branch];
    this.activeId = branch.id;
    // Compare the new future against where it came from.
    this.compareId = current.id;
    this.applyComparison();
    this.changed();
    return branch;
  }

  // --- "Probar cambios" (UX-21) ---------------------------------------------

  /** The active future when it is a trial, else null. */
  activeTrial(): Branch | null {
    const active = this.activeBranch();
    return active.trialOf !== undefined ? active : null;
  }

  /** Starts a trial copy of the active future (it becomes active). */
  startTrial(today: ISODate): Branch {
    const origin = this.activeBranch();
    return this.fork(today, `Prueba sobre ${origin.name}`, origin.id);
  }

  /**
   * Keep the trial's changes: the trial takes its origin's place (id, name,
   * position); the origin as it was is dropped. The bridge is untouched (the
   * trial is what it shows). Returns the snapshot to undo it, or null.
   */
  keepTrial(): FuturesSnapshot | null {
    const trial = this.activeTrial();
    const origin = trial ? this.branches.find((branch) => branch.id === trial.trialOf) : undefined;
    if (!trial || !origin) return null;
    const before = this.snapshot(true);
    const kept: Branch = { ...trial, id: origin.id, name: origin.name, forkDate: origin.forkDate };
    delete kept.trialOf;
    this.branches = this.branches
      .filter((branch) => branch.id !== trial.id)
      .map((branch) => (branch.id === origin.id ? kept : branch));
    this.activeId = origin.id;
    this.compareId = null;
    this.applyComparison();
    this.changed();
    return before;
  }

  /**
   * Discard the trial: back to its origin exactly as it was (document and
   * undo history), the trial removed. Returns the snapshot to undo it.
   */
  discardTrial(): FuturesSnapshot | null {
    const trial = this.activeTrial();
    if (!trial || !this.branches.some((branch) => branch.id === trial.trialOf)) return null;
    return this.discard(trial.id, trial.trialOf);
  }

  // --- deciding on a future (UX-54) -----------------------------------------

  /**
   * "Hacer este mi plan principal": the active future becomes the main plan
   * (id, name and place of the main plan); the previous main plan is dropped.
   * The bridge is untouched. Returns the snapshot to undo it, or null.
   */
  adopt(id: string): FuturesSnapshot | null {
    if (id !== this.activeId || id === MAIN_BRANCH_ID) return null;
    const main = this.branches.find((branch) => branch.id === MAIN_BRANCH_ID);
    const chosen = this.activeBranch();
    if (!main) return null;
    const before = this.snapshot(true);
    const adopted: Branch = { ...chosen, id: MAIN_BRANCH_ID, name: main.name, forkDate: null };
    delete adopted.trialOf;
    this.branches = this.branches
      .filter((branch) => branch.id !== chosen.id)
      .map((branch) => (branch.id === MAIN_BRANCH_ID ? adopted : branch));
    // Trials of the adopted future now point at the main plan.
    this.branches = this.branches.map((branch) =>
      branch.trialOf === chosen.id ? { ...branch, trialOf: MAIN_BRANCH_ID } : branch,
    );
    this.activeId = MAIN_BRANCH_ID;
    this.compareId = null;
    this.applyComparison();
    this.changed();
    return before;
  }

  /**
   * "Descartar este futuro": removes it (switching first, to `goTo` or the
   * main plan, when it is the active one). Returns the snapshot to undo it.
   */
  discard(id: string, goTo: string = MAIN_BRANCH_ID): FuturesSnapshot | null {
    if (this.branches.length <= 1 || !this.branches.some((branch) => branch.id === id)) return null;
    if (id === this.activeId) {
      const target = this.branches.find((branch) => branch.id === goTo && branch.id !== id)
        ?? this.branches.find((branch) => branch.id !== id)!;
      this.switchTo(target.id);
    }
    // Taken after the switch: the discarded future's doc / session are parked in it.
    const before = this.snapshot(false);
    before.activeId = id;
    this.branches = this.branches.filter((branch) => branch.id !== id);
    if (this.compareId === id) this.compareId = null;
    this.applyComparison();
    this.changed();
    return before;
  }

  /**
   * Back to a snapshot taken by keepTrial / adopt / discard ("Deshacer").
   * When the snapshot's active future is not the one the bridge shows, the
   * bridge switches to it (its parked session: exactly as it was).
   */
  restore(snapshot: FuturesSnapshot): void {
    const target = snapshot.branches.find((branch) => branch.id === snapshot.activeId);
    if (!target) return;
    const showing = this.activeBranch();
    this.branches = snapshot.branches.map((branch) => ({ ...branch }));
    this.compareId = snapshot.compareId;
    if (snapshot.relabel) {
      // keepTrial / adopt only relabelled the future on screen: same plan.
      this.activeId = target.id;
      this.applyComparison();
      this.changed();
      return;
    }
    // A discarded future: park the one on screen, show it again from its
    // parked session (its document and undo history as they were).
    const before = this.bridge.getOverviewData()?.primary ?? null;
    const current = this.branches.find((branch) => branch.id === showing.id);
    if (current) {
      current.doc = this.bridge.getDocument();
      current.session = this.bridge.exportSession();
      current.layout = this.bridge.getTrackLayout();
    }
    const parked = this.branches.find((branch) => branch.id === target.id)!;
    this.bridge.setPreview(null);
    if (parked.session) this.bridge.importSession(parked.session);
    else this.bridge.loadDocument(parked.doc, parked.layout);
    this.activeId = target.id;
    this.applyComparison();
    this.bridge.animateFrom(before);
    this.changed();
  }

  private snapshot(relabel: boolean): FuturesSnapshot {
    return {
      branches: this.branches.map((branch) => ({ ...branch })),
      activeId: this.activeId,
      compareId: this.compareId,
      relabel,
    };
  }

  // --- figures per future (UX-20) -------------------------------------------

  private readonly summaries = new WeakMap<FinancialDocument | FinancialProjection, ProjectionSummary>();

  /**
   * Horizon, lowest point and final debt of a future. Cached per document
   * object (the active one per projection object): one projection per
   * revision of each future, never per render or frame.
   */
  summaryOf(id: string): ProjectionSummary | null {
    if (id === this.activeId) {
      const projection = this.bridge.getProjection();
      let summary = this.summaries.get(projection);
      if (!summary) {
        summary = summarizeProjection(projection);
        this.summaries.set(projection, summary);
      }
      return summary;
    }
    const doc = this.branches.find((branch) => branch.id === id)?.doc;
    if (!doc) return null;
    let summary = this.summaries.get(doc);
    if (!summary) {
      summary = summarizeProjection(projectFinancialDocument(doc));
      this.summaries.set(doc, summary);
    }
    return summary;
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
    const branch = this.branches.find((candidate) => candidate.id === id);
    if (!branch || !name.trim() || branch.name === name.trim()) return;
    // Never two futures with the same name (UX-54).
    const trimmed = uniqueFutureName(
      name,
      this.branches.filter((candidate) => candidate.id !== id).map((candidate) => candidate.name),
    );
    if (branch.name === trimmed) return;
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

  /** The whole ledger back to `entries` (e.g. "Deshacer" after Rec). */
  replaceLedger(entries: readonly LedgerEntry[]): void {
    if (entries === this.ledger) return;
    this.ledger = [...entries];
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
        ...(branch.trialOf !== undefined ? { trialOf: branch.trialOf } : {}),
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
