// Pure mapping between financial items and playlist clips.
//
// Time model: 1 beat = 1 day, beat 0 = doc.startDate ("today").
//
// Geometry of an item's clip:
// - Point items (frequency "once", except cards / MSI which are windows):
//   the clip is a fixed-width marker that starts at the occurrence date.
// - Window items (recurring, cards, MSI): the clip spans the recurrence
//   window [startDate, endDate]; an indefinite window runs to the horizon.
// - The schedule phase (anchor) is encoded as content position, exactly like
//   FL encodes where the sample sits inside a clip:
//     anchorBeat = clip.start − contentOffset / stretchRatio
//   so MOVING a clip shifts the paydays, CROPPING an edge does not (the
//   playlist keeps content in place on a left crop), SLIP shifts the paydays
//   inside a fixed window, and SLICE keeps both halves in phase.
// Clips cannot start before beat 0, so a window that began in the past is
// clamped to 0 and its anchor is carried by the content offset.
import {
  addDays,
  diffDays,
  getProjectionRange,
  type FinancialDocument,
  type FinancialItem,
  type FinancialItemKind,
  type FinancialRecurrence,
  type ISODate,
} from "@slicex/core";
import {
  DEFAULT_PLAYLIST_METRICS,
  createDemoPlaylistState,
  type PlaylistClip,
  type PlaylistMetrics,
  type PlaylistState,
  type PlaylistTrack,
} from "@slicex/canvas";
import { KIND_COLORS, KIND_ORDER } from "./labels";

// Weeks as "bars", zoom out far enough to see a whole year.
export const FINANCE_PLAYLIST_METRICS: PlaylistMetrics = {
  ...DEFAULT_PLAYLIST_METRICS,
  beatsPerBar: 7,
  minPxPerBeat: 1.5,
};

/** Visual width (days) of a one-time event clip. */
export const POINT_CLIP_DAYS = 6;
/** Default zoom: ~10 px per day. */
export const FINANCE_DEFAULT_PX_PER_DAY = 10;

export interface ClipGeometry {
  start: number;
  duration: number;
  contentOffset: number;
}

export function isPointItem(item: FinancialItem): boolean {
  return (
    item.recurrence.frequency === "once" &&
    item.kind !== "credit-card" &&
    item.kind !== "installment-plan"
  );
}

/**
 * Whether slicing the clip is financially meaningful. Splitting a
 * one-time event would emit it twice; splitting a card, an MSI plan or a
 * loan with an explicit balance would duplicate a debt stock. Those clips
 * carry `noSlice` so the playlist's Slice tool / Insert cut skip them.
 */
export function isSliceable(item: FinancialItem): boolean {
  if (isPointItem(item)) return false;
  if (item.kind === "credit-card" || item.kind === "installment-plan") return false;
  if (item.kind === "loan" && item.balance !== undefined) return false;
  return true;
}

export function beatOf(doc: FinancialDocument, date: ISODate): number {
  return diffDays(doc.startDate, date);
}

export function dateOf(doc: FinancialDocument, beat: number): ISODate {
  return addDays(doc.startDate, Math.floor(beat));
}

/** Exclusive end beat of the projection range. */
export function horizonBeat(doc: FinancialDocument): number {
  return diffDays(doc.startDate, getProjectionRange(doc).to) + 1;
}

/**
 * Where an open-ended ("indefinido") window is drawn to: one day PAST the
 * horizon. That keeps "indefinite" a geometric fact (it survives undo,
 * paste and slice) and distinct from a finite window that ends exactly on
 * the horizon date.
 */
export function openEndBeat(doc: FinancialDocument): number {
  return horizonBeat(doc) + 1;
}

export function itemColor(item: FinancialItem): string {
  return item.color ?? KIND_COLORS[item.kind];
}

/**
 * Canonical stored form. One-time events are `{ once, startDate, endDate:
 * startDate }` with no anchor (the date the editor shows is the date that
 * happens); everything else is kept as is.
 */
export function canonicalItem<T extends FinancialItem>(item: T): T {
  if (!isPointItem(item)) return item;
  const rule = item.recurrence;
  if (rule.anchorDate === undefined && rule.endDate === rule.startDate) return item;
  return {
    ...item,
    recurrence: { frequency: "once", startDate: rule.startDate, endDate: rule.startDate },
  };
}

export function itemClipGeometry(
  doc: FinancialDocument,
  item: FinancialItem,
): ClipGeometry {
  const rule = item.recurrence;
  if (isPointItem(item)) {
    const date = beatOf(doc, rule.anchorDate ?? rule.startDate);
    const start = Math.max(0, date);
    return { start, duration: POINT_CLIP_DAYS, contentOffset: start - date };
  }
  const anchorBeat = beatOf(doc, rule.anchorDate ?? rule.startDate);
  const startBeat = beatOf(doc, rule.startDate);
  const endExclusive =
    rule.endDate !== undefined ? beatOf(doc, rule.endDate) + 1 : openEndBeat(doc);
  const start = Math.max(0, startBeat);
  const end = Math.max(start + 1, endExclusive);
  return { start, duration: end - start, contentOffset: start - anchorBeat };
}

export interface ObservedGeometry {
  start: number;
  duration: number;
}

const EPS = 1e-6;

/** Anchor (phase) of the clip's content, in beats. */
export function clipAnchorBeat(clip: PlaylistClip): number {
  const ratio = clip.stretchRatio && clip.stretchRatio > 0 ? clip.stretchRatio : 1;
  return clip.start - (clip.contentOffset ?? 0) / ratio;
}

/**
 * Date (beat) of a one-time event drawn as `clip`: its left edge. Only a
 * clip clamped at beat 0 carries a past date in its content offset. A
 * moved / pasted / slipped event is therefore dated where it is drawn.
 */
export function pointDateBeat(clip: PlaylistClip): number {
  return clip.start > EPS ? clip.start : clipAnchorBeat(clip);
}

/** True when the clip is exactly where `itemClipGeometry` would draw the item. */
export function clipMatchesItem(
  doc: FinancialDocument,
  item: FinancialItem,
  clip: PlaylistClip,
): boolean {
  if (isPointItem(item)) {
    const rule = item.recurrence;
    const date = beatOf(doc, rule.anchorDate ?? rule.startDate);
    return Math.abs(pointDateBeat(clip) - date) <= EPS;
  }
  const geometry = itemClipGeometry(doc, item);
  if (Math.abs(clip.start - geometry.start) > EPS) return false;
  if (Math.abs(clipAnchorBeat(clip) - (geometry.start - geometry.contentOffset)) > EPS) {
    return false;
  }
  return Math.abs(clip.duration - geometry.duration) <= EPS;
}

/**
 * Inverse of itemClipGeometry: the recurrence implied by a clip. Returns
 * the SAME object when nothing changed (callers use identity to detect
 * changes); a clip sitting exactly where the item would be drawn always
 * returns the rule untouched, so an item is never rewritten by an
 * unrelated edit.
 *
 * `wasIndefinite`: the item's (for a new clip: its template's)
 * open-endedness before this change. `previous`: the geometry last seen
 * for this clip, or for a brand-new clip its template's (null if none).
 * Open-ended stays open-ended while the clip keeps reaching past the
 * horizon or keeps its length (a move of any size); a finite window
 * becomes open-ended only by ending exactly on the open-end sentinel.
 */
export function deriveRecurrence(
  doc: FinancialDocument,
  item: FinancialItem,
  clip: PlaylistClip,
  previous: ObservedGeometry | null,
  wasIndefinite: boolean,
): FinancialRecurrence {
  const rule = item.recurrence;
  if (clipMatchesItem(doc, item, clip)) return rule;

  if (isPointItem(item)) {
    const date = dateOf(doc, Math.round(pointDateBeat(clip)));
    if (rule.startDate === date && rule.endDate === date && rule.anchorDate === undefined) {
      return rule;
    }
    return { frequency: "once", startDate: date, endDate: date };
  }

  const anchorBeat = Math.round(clipAnchorBeat(clip));
  const anchorDate = dateOf(doc, anchorBeat);

  const startBeat = Math.round(clip.start);
  const endExclusive = Math.round(clip.start + clip.duration);
  // A window that began before today is drawn clamped at 0. Keep the real
  // past start as long as the clip still sits at 0.
  const startDate =
    startBeat <= 0 && beatOf(doc, rule.startDate) < 0
      ? rule.startDate
      : dateOf(doc, startBeat);

  const openEnd = openEndBeat(doc);
  const sameLength =
    previous !== null && Math.abs(previous.duration - clip.duration) <= EPS;
  const indefinite = wasIndefinite
    ? endExclusive >= openEnd || sameLength
    : endExclusive === openEnd;
  const endDate = indefinite ? undefined : dateOf(doc, endExclusive - 1);

  const nextAnchor = anchorDate === startDate ? undefined : anchorDate;
  if (
    rule.startDate === startDate &&
    rule.endDate === endDate &&
    (rule.anchorDate ?? rule.startDate) === (nextAnchor ?? startDate)
  ) {
    return rule;
  }
  const next: FinancialRecurrence = { frequency: rule.frequency, startDate };
  if (endDate !== undefined) next.endDate = endDate;
  if (nextAnchor !== undefined) next.anchorDate = nextAnchor;
  return next;
}

const POINT_TRACK_LABELS: Readonly<Record<FinancialItemKind, string>> = {
  income: "Ingresos únicos",
  expense: "Gastos únicos",
  loan: "Pagos de préstamo",
  "credit-card": "Tarjetas",
  "card-purchase": "Compras con tarjeta",
  "installment-plan": "MSI",
};

export function pointTrackId(kind: FinancialItemKind, lane = 0): string {
  return lane === 0 ? `trk-once-${kind}` : `trk-once-${kind}-${lane + 1}`;
}

/** True when `trackId` is one of the shared one-time lanes of `kind`. */
export function isPointTrackOf(trackId: string, kind: FinancialItemKind): boolean {
  const base = pointTrackId(kind);
  return trackId === base || trackId.startsWith(`${base}-`);
}

export function itemTrackId(item: FinancialItem): string {
  return isPointItem(item) ? pointTrackId(item.kind) : `trk-${item.id}`;
}

export function itemToClip(
  doc: FinancialDocument,
  item: FinancialItem,
  trackId: string,
): PlaylistClip {
  const geometry = itemClipGeometry(doc, item);
  const clip: PlaylistClip = {
    id: item.id,
    type: "pattern",
    trackId,
    start: geometry.start,
    duration: geometry.duration,
    label: item.name,
    color: itemColor(item),
    sourceId: item.id,
  };
  if (geometry.contentOffset !== 0) clip.contentOffset = geometry.contentOffset;
  if (item.enabled === false) clip.muted = true;
  if (!isSliceable(item)) clip.noSlice = true;
  return clip;
}

/**
 * Playlist state for a financial document: one track per window item
 * (grouped by kind), one shared track per kind for one-time events.
 */
export function createFinancialPlaylistState(
  doc: FinancialDocument,
): PlaylistState {
  const base = createDemoPlaylistState();
  const tracks: PlaylistTrack[] = [];
  const clips: PlaylistClip[] = [];

  for (const kind of KIND_ORDER) {
    // One-time events share lanes; a new lane opens only when an event
    // would overlap the previous one on every existing lane (greedy
    // interval packing, events sorted by start).
    const pointClips: PlaylistClip[] = [];
    for (const item of doc.items) {
      if (item.kind !== kind) continue;
      if (isPointItem(item)) {
        pointClips.push(itemToClip(doc, item, ""));
        continue;
      }
      const trackId = itemTrackId(item);
      tracks.push({ id: trackId, label: item.name, color: KIND_COLORS[kind] });
      clips.push(itemToClip(doc, item, trackId));
    }
    pointClips.sort((a, b) => a.start - b.start);
    const laneEnds: number[] = [];
    for (const clip of pointClips) {
      let lane = laneEnds.findIndex((end) => end <= clip.start);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(0);
        tracks.push({
          id: pointTrackId(kind, lane),
          label:
            lane === 0
              ? POINT_TRACK_LABELS[kind]
              : `${POINT_TRACK_LABELS[kind]} ${lane + 1}`,
          color: KIND_COLORS[kind],
        });
      }
      laneEnds[lane] = clip.start + clip.duration;
      clips.push({ ...clip, trackId: pointTrackId(kind, lane) });
    }
  }

  return {
    ...base,
    tracks: tracks.length > 0 ? tracks : [{ id: "trk-empty", label: "Track 1", color: "#888888" }],
    clips,
    markers: [{ id: "m-today", time: 0, kind: "start", label: "Hoy" }],
    viewport: { ...base.viewport, scrollX: 0, scrollY: 0, pxPerBeat: FINANCE_DEFAULT_PX_PER_DAY },
    snap: { mode: "beat", lastActiveMode: "beat" },
    selection: { clipIds: [], automationPointIds: [] },
    playPosition: { time: 0, isRunning: false },
  };
}
