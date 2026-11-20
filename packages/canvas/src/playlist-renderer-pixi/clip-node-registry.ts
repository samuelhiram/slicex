import { Container, Graphics, GraphicsContext, GraphicsPath, Text } from "pixi.js";
import {
  sortedUpperBound,
  type PlaylistClipContent,
  type PlaylistClipPresentation,
  type PlaylistRect,
} from "../playlist-core";
import {
  CANVAS_FONT_FAMILY,
  COLORS,
  mixColor,
  parseHexColor,
  type PlaylistThemePalette,
} from "./palette";

// Canon §3.8 — per-clip factory + cache with diffed redraws.
//
// Why this exists: every frame the previous renderer cleared one big
// `clipGraphics` and re-emitted roundRect/fill/stroke for every visible
// clip. That re-uploaded the whole batch to the GPU on each rAF, which
// at brush-tool firing rate (dozens of clips painted per second) saturates
// the batcher.
//
// With this registry, every clip owns a small Container with its own
// Graphics + Text children, drawn ONCE in local coordinates. Re-positions
// are just transform updates (Pixi v8 batcher reuses the cached mesh).
// Visual changes (color, label, muted state, selection ring) only redraw
// the affected node — never the whole scene.

// The renderer passes the LIVE theme palette (palette.ts COLORS), so a theme
// switch + invalidate() repaints every node with the new colours. Callers
// (tests) may pass just the core keys; the rest falls back to COLORS.
type PixiPaletteColors = Pick<
  PlaylistThemePalette,
  | "text"
  | "textMuted"
  | "selected"
  | "hover"
  | "rowLine"
  | "panel"
  | "panelStrong"
  | "automationLine"
> &
  Partial<PlaylistThemePalette>;

// Clip card: tinted surface + accent bar in the clip colour, hairline
// outline, title + detail in the theme text colours.
const CLIP_RADIUS = 8;
const CLIP_MUTED_TINT_SCALE = 0.4;
const CLIP_ACCENT_WIDTH = 3;
const CLIP_ACCENT_INSET = 4;
const CLIP_RESIZE_ALPHA = 0.32;
const TITLE_FONT_SIZE = 13;
// The name and amount lines get a thin outline in the card's own colour: a
// payment bar running behind them stops at each letter's edge, so the text
// stays crisp over the full-height bars. Pixi draws an outlined text half
// the outline further right and down: HALO_SHIFT puts the letters back.
const TEXT_HALO_WIDTH = 2;
const HALO_SHIFT = TEXT_HALO_WIDTH / 2;
const TITLE_PAD_X = 11;
// Right edge kept free of text: the resize grip column + a margin.
export const CLIP_TEXT_RIGHT_PAD = 6;
const TITLE_Y = 5;
// Conservative advance of the 12px / 600 title font (no canvas measuring:
// deterministic and headless-safe, same approach as the detail line).
const TITLE_CHAR_PX = 7.8;
// The card's THIRD ROW (providers.timeLock), under the name and the
// amount, holds TWO different things side by side:
//   - the lock: a BUTTON tucked into the card's bottom-left CORNER — a tab
//     flush with the left and bottom edges (its outer corner the card's
//     own radius, its inner one a generous curve), a solid fill under the
//     card's outline: the corner seems to swallow it. Stronger when the
//     dates are fixed and under the pointer — the only part that reacts to
//     it;
//   - the dates it covers (providers.getClipPeriod: "1 dic 2026 – 1 sep
//     2027", "13 nov 2026 – Indefinido", "9 dic 2026"): an information tag
//     with a calendar glyph, opaque in the card's own colour a shade lighter
//     (darker on a light theme), no border, the card's soft corners, the
//     amount line's grey — part of the card, and payment marks never run
//     under the dates.
// The row slides with the title (sticky: the tab then hugs the visible left
// edge, its corner square like that edge); on a card too short for a third
// row (stacked lanes) it sits BESIDE the name / amount block, centred, the
// lock a bordered badge there. Only a card whose text is hidden (narrower
// than LOCK_MIN_WIDTH) shows none.
const LOCK_MIN_WIDTH = 44;
// The lock button beside a short card's text: a badge a little wider than
// tall (a button, not a dot), as tall as the dates tag.
const LOCK_W = 24;
const LOCK_H = 18;
// The corner tab: its width (its height runs from TAB_PAD_TOP above the
// row to the card's bottom) and its inner corner's radius.
const TAB_W = 30;
// The tab reaches TAB_PAD_TOP above the dates it sits beside.
const TAB_PAD_TOP = 4;
const TAB_INNER_RADIUS = 10;
// Between the corner tab and the dates tag.
const TAB_DATE_GAP = 8;
// The third row's margin to the card's bottom edge: tight cards, roomy ones.
const ROW_BOTTOM_TIGHT = 2;
const ROW_BOTTOM_ROOMY = 4;
const ROW_ROOMY_MIN_HEIGHT = 64;
// The name and the amount ride in a PILL (providers.timeLock cards): a
// band of the canvas' own colour from the card's left edge, its right end
// round — the name in the clip's colour, the amount in grey — so they read
// as one label over whatever the card draws behind (payment marks, the
// accent bar).
const PILL_H = 22;
const PILL_PAD_R = 12;
// The text boxes' heights in the pill (13 / 12 px Inter).
const PILL_TITLE_TEXT_H = 17;
// The item's icon (providers.getClipIcon), first in the pill: a 24-unit
// stroke glyph drawn ICON_PX wide in the clip's colour, then ICON_GAP to
// the name.
const ICON_PX = 14;
const ICON_GAP = 6;
const ICON_ADVANCE = ICON_PX + ICON_GAP;
const ICON_GRID = 24;
const ICON_STROKE = 2;
// Between the lock button and the dates tag: two things, not one.
const LOCK_DATE_GAP = 6;
const CHIP_H = 16;
const CHIP_RADIUS = 5;
const DATE_PAD = 6;
const CAL_ICON = 10;
const CAL_GAP = 5;
const PERIOD_FONT_SIZE = 12;
// How much of the theme's ink the dates tag's fill takes over the card
// colour; and the lock button's: free · fixed · under the pointer.
const CHIP_SHADE = 0.08;
const LOCK_SHADE_FREE = 0.1;
const LOCK_SHADE_FIXED = 0.18;
const LOCK_SHADE_HOVER = 0.26;
// The lock button's width (the corner tab, or the badge beside a short
// card's text) and the gap to the dates tag after it.
const lockButtonW = (beside: boolean): number => (beside ? LOCK_W : TAB_W);
const lockDateGap = (beside: boolean): number => (beside ? LOCK_DATE_GAP : TAB_DATE_GAP);
// Px the third row takes with `chars` characters of dates (estimate:
// layout, never drawing): the lock, then the dates tag.
const chipPx = (chars: number, beside: boolean): number =>
  lockButtonW(beside) +
  (chars > 0 ? lockDateGap(beside) + DATE_PAD * 2 + CAL_ICON + CAL_GAP + chars * DETAIL_CHAR_PX : 0);

interface ClipNode {
  container: Container;
  body: Graphics;
  overlay: Graphics;
  // Lazy Text instances. We never destroy them (Pixi v8 TexturePool crash);
  // we just toggle visibility when the label drops below the draw threshold.
  label: Text | null;
  // Truncation cache for the title (same scheme as the detail line).
  labelSource: string;
  labelWidth: number;
  labelDisplay: string;
  // The outline colour the title / detail Text were last given (-1: none).
  labelHalo: number;
  detailHalo: number;
  // The card's fill, cached by the clip colour string and muted state it
  // was mixed from ("": stale — e.g. after a theme switch).
  cardColorSource: string;
  cardMuted: boolean;
  cardFill: number;
  ratioBadge: Text | null;
  offsetBadge: Text | null;
  // Secondary line under the title (host-provided via getClipDetail).
  detail: Text | null;
  // Truncation cache for the detail line: the display string is only
  // recomputed when the source text or the clip width changes, so steady
  // frames never allocate a new string.
  detailSource: string;
  detailWidth: number;
  // Where the detail's display was cut for (its start x): DETAIL_PAD_X, or
  // after the name on a short card's top line.
  detailStart: number;
  // The name's real width (measured once per display string; "": stale).
  labelMeasured: string;
  labelTextWidth: number;
  // The amount's real width (same), for the pill.
  detailMeasured: string;
  detailTextWidth: number;
  // The pill behind the name + amount (providers.timeLock): drawn when its
  // width / look change (pillKey; -1 = never), placed by transform.
  pill: Graphics | null;
  pillKey: number;
  pillWidth: number;
  // The clip's colour as a number (cardFillOf keeps it).
  clipHue: number;
  // The icon before the name (providers.getClipIcon): a Graphics sharing
  // the glyph's GraphicsContext (built once per glyph for the registry),
  // tinted with the clip's colour; the glyph it shows (reference compare),
  // its tint, and the room it takes before the name (0: none).
  icon: Graphics | null;
  iconSource: PlaylistClipIcon | null;
  iconTint: number;
  iconAdvance: number;
  // The icon advance the dates' display was cut for.
  periodAdvance: number;
  detailDisplay: string;
  // Sparkline array the body was last drawn with, as returned by the
  // per-renderer getClipSparkline provider (null = provider absent / returned
  // null). A different reference forces a body redraw even when the visual
  // hash is unchanged — see ClipNodeProviders.
  bars: readonly number[] | null;
  // Content the body was last drawn with (getClipContent; null = none) and
  // the clip geometry it was laid out for. Content sits at absolute beats,
  // so a move (start) or zoom (px per beat) re-lays it out even when the
  // host keeps the same reference.
  content: PlaylistClipContent | null;
  contentStart: number;
  contentPxPerBeat: number;
  // Host highlight the overlay was last drawn with.
  highlighted: boolean | "danger";
  // The lock button (providers.timeLock): its own small Graphics (between
  // the card's fill and its outline), redrawn only when its look / card
  // colour / height change (lockKey; -1 = never drawn), placed by transform
  // every frame with the title.
  lock: Graphics | null;
  lockKey: number;
  // The lock's size as last placed (its hit area: lockRectOf).
  lockW: number;
  lockH: number;
  // The dates next to the lock (providers.getClipPeriod); display string
  // cached per (source, width, height) — never rebuilt per frame.
  period: Text | null;
  periodSource: string | null;
  periodWidth: number;
  periodHeight: number;
  periodDisplay: string;
  // The dates tag (its own Graphics, redrawn when its width / card colour
  // change: periodBgKey) and the dates' text width, measured once per
  // display string.
  periodBg: Graphics | null;
  periodBgKey: number;
  periodMeasured: string;
  periodTextWidth: number;
  // Visual hash captures everything that would force a redraw. Position and
  // size are kept separate so we can skip a redraw when only x/y changed.
  hash: string;
  width: number;
  height: number;
}

// F9: deterministic hash → seed → sparkline bar count + heights. Picks N
// in [8, 19] from the clip id so two clips with the same id always get
// the same sparkline (no per-frame allocation). The motor financiero can
// replace this default later via setSparklineProvider.
function hashStringToSeed(value: string): number {
  let hash = 2166136261 >>> 0; // FNV-1a basis
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function defaultSparklineBars(clipId: string): number[] {
  return sparklineBarsForClipImpl(clipId);
}

function sparklineBarsForClipImpl(clipId: string): number[] {
  const seed = hashStringToSeed(clipId);
  const count = 8 + (seed % 12);
  const out: number[] = [];
  let s = seed || 1;
  for (let i = 0; i < count; i += 1) {
    // xorshift 32 — cheap and deterministic.
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s = s >>> 0;
    const ratio = (s % 1000) / 1000;
    out.push(0.2 + ratio * 0.65);
  }
  return out;
}

// Allow consumers to swap in a real provider (e.g. financial engine).
// Defaults to the deterministic hash above. Setting null reverts to default.
let sparklineProvider: ((clipId: string) => number[] | null) | null = null;

export function setSparklineProvider(
  provider: ((clipId: string) => number[] | null) | null,
): void {
  sparklineProvider = provider;
}

/**
 * An icon for a clip: SVG path data on a 24 × 24 grid, stroked 2 units wide
 * with round caps / joins (the Lucide convention). Drawn in the clip's
 * colour, first in the name's pill (providers.timeLock cards).
 */
export type PlaylistClipIcon = readonly string[];

export type ClipSparklineProvider = (
  clipId: string,
) => readonly number[] | null;
export type ClipDetailProvider = (clipId: string) => string | null;
export type ClipContentProvider = (
  clipId: string,
) => PlaylistClipContent | null;

// Per-renderer providers (PlaylistRendererCallbacks.getClipDetail /
// getClipSparkline). Both are called by syncFrame for VISIBLE clips only,
// once per frame each (getClipSparkline only for pattern clips). Both must
// be O(1) cached lookups — no projection work inside the frame.
//
// getClipDetail: return a stable string; a changed string redraws the clip
// (it is part of clipVisualHash).
//
// getClipSparkline: return the SAME array reference for as long as the bars
// are unchanged, and a NEW array when they change (never mutate a returned
// array in place — the registry cannot see that). The body redraws when the
// visual hash changes OR when the returned reference differs from the one
// it was last drawn with, so the bars may depend on anything the host likes
// (e.g. the clip's position on a calendar) without being in the hash. A
// provider that allocates a fresh array per call defeats the cache and
// redraws that clip every frame (canon §3.8). null falls back to the global
// setSparklineProvider / the deterministic default; [] draws no bars.
//
// Neither provider schedules a frame by itself: when provider data changes
// without a core notify, the host calls PlaylistRenderer.invalidate().
//
// getClipContent: same identity contract as getClipSparkline (SAME object
// while unchanged, a NEW object when it changes). Queried once per VISIBLE
// non-automation clip per frame. Non-null wins over the sparkline for that
// clip (getClipSparkline is then not queried). The body redraws only when
// the visual hash, the content reference, the clip start or the zoom
// changes; see drawClipContent for the layout.
export interface ClipNodeProviders {
  // Clips have a host "level" dragged from their top edge (see the
  // interaction controller's onClipLevelDrag): hovered clips show a grip.
  // With levelGrip the renderer draws it instead (where getClipLevelGripX
  // puts it, which follows the scroll): the node does not.
  levelHandles?: boolean;
  levelGrip?: boolean;
  // Host emphasis (e.g. "these payments cause the valley"): a warm ring;
  // "danger" (e.g. a delete sweep will remove it): a red ring + wash.
  // Called once per VISIBLE clip per frame: O(1), a primitive.
  isClipHighlighted?: (clipId: string) => boolean | "danger";
  // FL badges ("↻ offset" of a slipped clip, "×ratio" of a stretched one).
  // Default true; a host without slip / stretch meaning turns them off.
  badges?: boolean;
  getClipDetail?: ClipDetailProvider;
  getClipSparkline?: ClipSparklineProvider;
  getClipContent?: ClipContentProvider;
  // Clips carry a lock button (pair with the controller's clipTimeLock,
  // whose rectOf reads lockRectOf): closed on a time-locked clip, open and
  // quieter on a free one, opaque on a soft chip under the pointer.
  timeLock?: boolean;
  // The dates a clip covers, drawn after its lock (with timeLock). Called
  // once per VISIBLE clip per frame: O(1) cached, the SAME string while
  // unchanged; null = none.
  getClipPeriod?: (clipId: string) => string | null;
  // The clip's icon, first in the name's pill (with timeLock). Called once
  // per VISIBLE clip per frame: O(1), the SAME array while unchanged (a
  // glyph is built into geometry once per reference); null = none.
  getClipIcon?: (clipId: string) => PlaylistClipIcon | null;
}

function getSparklineBars(
  clipId: string,
  localBars: readonly number[] | null,
): readonly number[] {
  // Per-renderer provider wins over the global one; null falls through.
  // syncFrame already queried it this frame and passes the result in.
  if (localBars !== null) return localBars;
  if (sparklineProvider) {
    const custom = sparklineProvider(clipId);
    if (custom !== null) return custom;
  }
  return sparklineBarsForClipImpl(clipId);
}

// Exported for tests. `detail` is the host-provided secondary line (or null);
// including it lets a changed detail (and the sparkline that is derived from
// the same data, see ClipNodeProviders) trigger a redraw.
export function clipVisualHash(
  view: PlaylistClipPresentation,
  detail: string | null = null,
): string {
  const ratio = view.clip.stretchRatio ?? 1;
  const offset = view.clip.contentOffset ?? 0;
  return [
    view.clip.color,
    view.clip.label,
    view.effectivelyMuted ? 1 : 0,
    view.trackLocked ? 1 : 0,
    view.selected ? 1 : 0,
    view.hovered ? 1 : 0,
    view.isAutomation ? 1 : 0,
    // F9 invalidation: a clip becoming a pattern or losing pattern-ness
    // changes whether we draw the sparkline at all.
    view.clip.type,
    view.rect.width,
    view.rect.height,
    Math.round(view.titleRect.height * 100),
    ratio,
    offset,
    view.groupId ?? "",
    // A time-locked clip shows no resize grips.
    view.clip.timeLocked === true ? 1 : 0,
    detail ?? "",
  ].join("|");
}

// Detail line layout (local coords). Shown only when the body has room.
const DETAIL_FONT_SIZE = 12;
const DETAIL_LINE_HEIGHT = 16;
const DETAIL_MIN_BODY_HEIGHT = 14;
const DETAIL_MIN_WIDTH = 36;
export const DETAIL_PAD_X = 11;
// Conservative average glyph width for the 11px / 600 detail font (Inter
// digits measure ~6.6px). Same estimate style as the ratio badge: no canvas
// measuring, so the truncation is deterministic and works headless.
export const DETAIL_CHAR_PX = 7.3;

export function isClipDetailVisible(
  view: PlaylistClipPresentation,
  detail: string | null,
): boolean {
  return (
    detail !== null &&
    detail.length > 0 &&
    view.rect.width >= DETAIL_MIN_WIDTH &&
    view.rect.height >= view.titleRect.height + DETAIL_MIN_BODY_HEIGHT
  );
}

// Truncates `text` with an ellipsis so it fits inside a clip of `width` px
// (left pad DETAIL_PAD_X, right pad CLIP_TEXT_RIGHT_PAD). Pure; returns the
// input when it fits.
export function truncateClipDetail(text: string, width: number): string {
  return truncateToChars(
    text,
    Math.floor((width - DETAIL_PAD_X - CLIP_TEXT_RIGHT_PAD) / DETAIL_CHAR_PX),
  );
}

/**
 * Px a card needs to show `title` and `detail` whole: the same conservative
 * advances and pads as the truncation (headless-safe, no measuring). For a
 * host that sizes tags to their text (PlaylistLayoutOptions.clipMinWidthPx).
 */
export function clipTextWidthPx(title: string, detail: string | null): number {
  const text = Math.max(
    TITLE_PAD_X + title.length * TITLE_CHAR_PX,
    detail ? DETAIL_PAD_X + detail.length * DETAIL_CHAR_PX : 0,
  );
  return Math.ceil(text + CLIP_TEXT_RIGHT_PAD + 1);
}

// Between the name and the amount in the pill.
const TITLE_DETAIL_GAP = 10;

// Where things go on a lock-carrying card of `height`:
//   ROW_SECOND  two lines: the pill (name + amount) centred in the room
//               above the bottom line, which holds the lock (the corner
//               tab) and the dates;
//   ROW_BESIDE  (a card too short for two lines) one line: the pill, then
//               the lock badge and the dates.
const ROW_SECOND = 1;
const ROW_BESIDE = 2;
const TWO_LINES_MIN_HEIGHT = PILL_H + CHIP_H + ROW_BOTTOM_TIGHT + 4;

function rowMode(height: number, _titleHeight: number): number {
  return height >= TWO_LINES_MIN_HEIGHT ? ROW_SECOND : ROW_BESIDE;
}

/** No room for the row under the name: it goes beside the text block. */
function lockBeside(height: number, titleHeight: number): boolean {
  return rowMode(height, titleHeight) === ROW_BESIDE;
}

/** Local x where the pill (the icon, the name, then its amount) ends (estimate). */
function pillEnd(titleChars: number, detailChars: number, iconAdvance = 0): number {
  return (
    TITLE_PAD_X +
    iconAdvance +
    titleChars * TITLE_CHAR_PX +
    (detailChars > 0 ? TITLE_DETAIL_GAP + detailChars * DETAIL_CHAR_PX : 0) +
    PILL_PAD_R
  );
}

/** Local x where the text block (title, detail) ends, without the sticky shift. */
function textBlockEnd(titleChars: number, detailChars: number): number {
  return Math.max(
    TITLE_PAD_X + titleChars * TITLE_CHAR_PX,
    detailChars > 0 ? DETAIL_PAD_X + detailChars * DETAIL_CHAR_PX : 0,
  );
}

/** Local x where the third row (lock, then dates) starts: the card's left edge (the corner tab), or after the text block (beside). */
function lockRowStart(beside: boolean, blockEnd: number): number {
  return beside ? blockEnd + 8 : 0;
}

/** Local x where the third row ends; `periodChars` 0 = the lock alone. */
function lockRowEnd(beside: boolean, blockEnd: number, periodChars: number): number {
  return lockRowStart(beside, blockEnd) + chipPx(periodChars, beside);
}

/** Local y of the third row (under the text): at the card's bottom, so the room left goes above it. */
function cornerRowY(height: number): number {
  return height - CHIP_H - (height >= ROW_ROOMY_MIN_HEIGHT ? ROW_BOTTOM_ROOMY : ROW_BOTTOM_TIGHT);
}

/** Height of the corner tab: from TAB_PAD_TOP above the row to the card's bottom. */
function cornerTabHeight(height: number): number {
  return height - cornerRowY(height) + TAB_PAD_TOP;
}

/** Local y of the pill: centred above the bottom line (two lines) or on the card (one). */
function pillTop(height: number): number {
  return Math.max(
    1,
    Math.round(((height >= TWO_LINES_MIN_HEIGHT ? cornerRowY(height) : height) - PILL_H) / 2),
  );
}

/**
 * Px a lock-carrying card (providers.timeLock) of `height` needs to show
 * its title, detail, lock and dates whole — the same layout and estimates
 * the drawing uses (headless-safe). For hosts that size tags to their text
 * (PlaylistLayoutOptions.clipMinWidthPx).
 */
export function clipCardWidthPx(
  title: string,
  detail: string | null,
  period: string | null,
  height: number,
  titleHeight: number,
  icon = false,
): number {
  // The amount rides in the pill, beside the name, at any height.
  const detailChars = detail ? detail.length : 0;
  const periodChars = period ? period.length : 0;
  const pill = pillEnd(title.length, detailChars, icon ? ICON_ADVANCE : 0);
  if (rowMode(height, titleHeight) === ROW_SECOND) {
    // The pill on top; lock and dates on the line below.
    return Math.ceil(Math.max(pill, chipPx(periodChars, false)) + CLIP_TEXT_RIGHT_PAD + 1);
  }
  // One line: the pill, then the lock badge and the dates.
  return Math.ceil(lockRowEnd(true, pill, periodChars) + CLIP_TEXT_RIGHT_PAD + 1);
}

// Title of a clip of `width` px (same pads as the detail line). Truncated
// in the MIDDLE ("Pago T…Plata"): names that share a start ("Pago Tarjeta
// Plata" / "Pago Tarjeta Oro") stay tellable apart.
export function truncateClipTitle(text: string, width: number): string {
  return truncateMiddle(
    text,
    Math.floor((width - TITLE_PAD_X - CLIP_TEXT_RIGHT_PAD) / TITLE_CHAR_PX),
  );
}

export function truncateMiddle(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars <= 4) return truncateToChars(text, maxChars);
  const keep = maxChars - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head).trimEnd()}…${text.slice(text.length - tail).trimStart()}`;
}

function truncateToChars(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return "…";
  return `${text.slice(0, maxChars - 1)}…`;
}

// Content area of the body: below the title bar (and the detail line when
// it is shown, so the text stays readable), 3px above the bottom edge.
const CONTENT_BOTTOM_PAD = 5;
// Event bars (payments): opaque enough to read at a glance, money out a
// touch quieter than money in.
const CONTENT_EVENT_ALPHA_POS = 1;
const CONTENT_EVENT_ALPHA_NEG = 0.9;
// Event bars are fine lines: marks of a rhythm, not blocks.
const CONTENT_EVENT_WIDTH = 1.5;
const CONTENT_LEVEL_FILL_ALPHA = 0.2;
// A level (a debt's balance) needs this much height under the text.
const LEVEL_MIN_AREA = 8;
const CONTENT_LEVEL_LINE_ALPHA = 0.95;
const MARK_DASH = 3;
// Free space kept right of the accent bar: content never touches it.
const ACCENT_CLEARANCE = 2;

/** The card draws its accent bar at this size (drawClipBodyLocal). */
function clipHasAccent(width: number, height: number): boolean {
  return width >= 10 && height - CLIP_ACCENT_INSET * 2 >= 6;
}

/**
 * Left edge of the content area (local x). The accent bar already marks the
 * clip's start, so an event or a guide on the start day — drawn at the
 * clip's left edge — would stack three lines there (border, bar, accent):
 * content starts right of the accent instead and anything left of that is
 * not drawn.
 */
function contentLeftPx(width: number, height: number): number {
  return clipHasAccent(width, height)
    ? CLIP_ACCENT_INSET - 1 + CLIP_ACCENT_WIDTH + ACCENT_CLEARANCE
    : 1;
}

// Draws PlaylistClipContent in the body (local coords). Beats are absolute:
// x = (beat - clip.start) * pxPerBeat. Only what falls inside the clip window
// [start, start + duration] is drawn; the window start is found by binary
// search, so a long series costs O(log n + items inside the clip).
//   events: one fine bar (CONTENT_EVENT_WIDTH) per event, every one the card's whole height
//           (the accent bar's span: its full height minus the same inset),
//           whatever its amount — an even rhythm of marks; the sign only
//           sets the bar's opacity (money in / out reads from the colour).
//           The text paints over them.
//   level:  filled step area from the bottom; value / max = height.
export function drawClipContent(
  body: Graphics,
  view: PlaylistClipPresentation,
  palette: PixiPaletteColors,
  content: PlaylistClipContent,
  detailVisible: boolean,
): void {
  const width = view.rect.width;
  const height = view.rect.height;
  const clip = view.clip;
  const pxPerBeat = width / Math.max(clip.duration, 1e-9);
  const top =
    view.titleRect.height + (detailVisible ? DETAIL_LINE_HEIGHT : 0) + 2;
  const bottom = height - CONTENT_BOTTOM_PAD;
  // The area under the text (guide marks, a level); event bars take the
  // card's whole height instead.
  const available = bottom - top;
  if (width < 4) return;
  const start = clip.start;
  const end = start + clip.duration;
  const alphaScale = view.effectivelyMuted ? 0.45 : 1;
  // Content is drawn in the clip's own colour (the card is a tint of it).
  const ink = parseHexColor(clip.color, palette.text);
  const left = contentLeftPx(width, height);

  // Guide marks (e.g. billing cuts): dashed vertical lines across the
  // content area, under the bars. Binary search to the first visible one.
  const marks = content.marks;
  if (marks && marks.length > 0 && available >= LEVEL_MIN_AREA) {
    let drew = false;
    for (let i = sortedUpperBound(marks, start - 1e-9); i < marks.length; i += 1) {
      const beat = marks[i]!;
      if (beat > end + 1e-9) break;
      const x = Math.round((beat - start) * pxPerBeat) + 0.5;
      if (x < Math.max(2, left) || x > width - 2) continue;
      for (let y = top; y < bottom; y += MARK_DASH * 2) {
        body.moveTo(x, y).lineTo(x, Math.min(bottom, y + MARK_DASH));
      }
      drew = true;
    }
    if (drew) {
      body.stroke({ color: palette.textMuted, width: 1, alpha: 0.55 * alphaScale });
    }
  }

  if (content.kind === "events") {
    const beats = content.beats;
    const values = content.values;
    const count = Math.min(beats.length, values.length);
    const barWidth = CONTENT_EVENT_WIDTH;
    const maxX = width - barWidth - 1;
    // The card's whole height, inset like the accent bar.
    const barTop = CLIP_ACCENT_INSET;
    const span = height - CLIP_ACCENT_INSET * 2;
    // First event at or after the clip start.
    let index = sortedUpperBound(beats, start - 1e-9);
    for (; index < count; index += 1) {
      const beat = beats[index]!;
      if (beat > end + 1e-9) break;
      const raw = values[index]!;
      if (raw === 0 || !Number.isFinite(raw)) continue;
      const center = (beat - start) * pxPerBeat;
      // On the accent (an event on the start day): the accent shows it.
      if (Math.round(center - barWidth / 2) < left) continue;
      const x = Math.min(maxX, Math.round(center - barWidth / 2));
      body.rect(x, barTop, barWidth, span).fill({
        color: ink,
        alpha: (raw > 0 ? CONTENT_EVENT_ALPHA_POS : CONTENT_EVENT_ALPHA_NEG) * alphaScale,
      });
    }
    return;
  }

  // level — not in a sliver too thin to read (a short card's last line,
  // where its text sits).
  const series = content.series;
  const max = content.max;
  if (!(max > 0) || available < LEVEL_MIN_AREA) return;
  const beats = series.beats;
  const values = series.values;
  const count = Math.min(beats.length, values.length);
  const yOf = (value: number): number => {
    const ratio = value <= 0 ? 0 : value >= max ? 1 : value / max;
    return bottom - ratio * available;
  };
  const firstIndex = Math.min(sortedUpperBound(beats, start), count);
  const firstValue = firstIndex === 0 ? series.initial : values[firstIndex - 1]!;
  // Filled area.
  let y = yOf(firstValue);
  body.moveTo(0, bottom).lineTo(0, y);
  for (let index = firstIndex; index < count; index += 1) {
    const beat = beats[index]!;
    if (beat >= end) break;
    const x = (beat - start) * pxPerBeat;
    const nextY = yOf(values[index]!);
    body.lineTo(x, y).lineTo(x, nextY);
    y = nextY;
  }
  body
    .lineTo(width, y)
    .lineTo(width, bottom)
    .closePath()
    .fill({
      color: ink,
      alpha: CONTENT_LEVEL_FILL_ALPHA * alphaScale,
    });
  // Top edge as a crisp line (same walk, stroke only).
  y = yOf(firstValue);
  body.moveTo(0, y);
  for (let index = firstIndex; index < count; index += 1) {
    const beat = beats[index]!;
    if (beat >= end) break;
    const x = (beat - start) * pxPerBeat;
    const nextY = yOf(values[index]!);
    body.lineTo(x, y).lineTo(x, nextY);
    y = nextY;
  }
  body.lineTo(width, y).stroke({
    color: ink,
    width: 1.5,
    alpha: CONTENT_LEVEL_LINE_ALPHA * alphaScale,
  });
}

function drawClipBodyLocal(
  body: Graphics,
  view: PlaylistClipPresentation,
  palette: PixiPaletteColors,
  localBars: readonly number[] | null,
  detailVisible: boolean,
  content: PlaylistClipContent | null = null,
): void {
  body.clear();
  const width = view.rect.width;
  const height = view.rect.height;
  const color = parseHexColor(view.clip.color, 0x777777);
  const muted = view.effectivelyMuted;
  const surface = palette.background ?? COLORS.background;
  const tint =
    (palette.clipTint ?? COLORS.clipTint) *
    (muted ? CLIP_MUTED_TINT_SCALE : 1);
  // Card: the clip colour tinted onto the theme surface (opaque, so the
  // grid never shows through), plus an inset accent bar in the full colour.
  // A content `extent` (e.g. a one-day event drawn a week wide so its name
  // fits): the real span is the card, the rest a faint tag.
  const extentPx = contentExtentPx(view, content);
  if (extentPx < width) {
    body
      .roundRect(0, 0, width, height, clipRadius(width, height))
      .fill({ color: mixColor(surface, color, tint * CLIP_TAG_TINT_SCALE) });
    body
      .roundRect(0, 0, extentPx, height, clipRadius(extentPx, height))
      .fill({ color: mixColor(surface, color, Math.min(1, tint * CLIP_DAY_TINT_SCALE)) });
  } else {
    body
      .roundRect(0, 0, width, height, clipRadius(width, height))
      .fill({ color: mixColor(surface, color, tint) });
  }
  const accentHeight = height - CLIP_ACCENT_INSET * 2;
  if (clipHasAccent(width, height)) {
    drawAccent(body, accentHeight, color, muted ? 0.4 : 1, content?.accent ?? "solid");
  }
  if (muted) {
    const step = 8;
    for (let x = -height; x <= width + height; x += step) {
      const x1 = x;
      const x2 = x + height;
      const clampedX1 = Math.max(0, x1);
      const clampedX2 = Math.min(width, x2);
      if (clampedX1 >= clampedX2) continue;
      body
        .moveTo(clampedX1, clampedX1 - x1)
        .lineTo(clampedX2, clampedX2 - x1)
        .stroke({ color: palette.textMuted, alpha: 0.22, width: 1 });
    }
  }
  // Host content (getClipContent) replaces the sparkline for this clip.
  if (content !== null) {
    drawClipContent(body, view, palette, content, detailVisible);
    return;
  }
  // F9: sparkline stub for pattern clips. Skipped on automation (drawn by
  // the overlay polyline) and on audio (no internal preview today). The
  // bars are pure visual filler until the financial engine plugs in real
  // data via setSparklineProvider.
  if (view.clip.type === "pattern" && width >= 60 && height >= 18) {
    const bars = getSparklineBars(view.clip.id, localBars);
    if (bars.length > 0) {
      // Reserve the detail line so the bars don't run under its text.
      const titleH =
        view.titleRect.height + (detailVisible ? DETAIL_LINE_HEIGHT : 0);
      const drawableHeight = height - titleH - 6;
      if (drawableHeight > 2) {
        const padX = 8;
        const usable = Math.max(0, width - padX * 2);
        const barWidth = 2;
        const slot = bars.length > 1 ? usable / (bars.length - 1) : usable;
        for (let i = 0; i < bars.length; i += 1) {
          const ratio = bars[i]!;
          const h = Math.max(1, Math.round(drawableHeight * ratio));
          const x = padX + Math.round(i * slot);
          if (x + barWidth > width - padX) continue;
          const yTop = titleH + 3 + (drawableHeight - h);
          body
            .rect(x, yTop, barWidth, h)
            .fill({ color, alpha: 0.6 });
        }
      }
    }
  }
}

function clipRadius(width: number, height: number): number {
  return Math.max(0, Math.min(CLIP_RADIUS, width / 2, height / 2));
}

// The faint tag after a one-day extent, and how much stronger the day is.
const CLIP_TAG_TINT_SCALE = 0.45;
const CLIP_DAY_TINT_SCALE = 2.2;
const CLIP_EXTENT_MIN_PX = 8;

// Look bits of a lock button: 1 shown free · 2 shown fixed · +4 under the
// pointer · +8 muted · +16 the corner tab (else the badge) · +32 its outer
// corner square (sticky: it hugs the visible edge). 0 = hidden.
const LOCK_FREE = 1;
const LOCK_FIXED = 2;
const LOCK_HOVER = 4;
const LOCK_MUTED = 8;
const LOCK_CORNER = 16;
const LOCK_SQUARE = 32;

// A tab path in the bottom-left corner of a box (0, 0)-(w, h): square top-left
// and bottom-right corners, `outer` the bottom-left radius, `inner` the
// top-right one.
function cornerTabPath(g: Graphics, x: number, y: number, w: number, h: number, outer: number, inner: number): void {
  const ri = Math.max(0, Math.min(inner, w / 2, h / 2));
  const ro = Math.max(0, Math.min(outer, w / 2, h / 2));
  g.moveTo(x, y)
    .lineTo(x + w - ri, y)
    .arcTo(x + w, y, x + w, y + ri, ri)
    .lineTo(x + w, y + h)
    .lineTo(x + ro, y + h)
    .arcTo(x, y + h, x, y + h - ro, ro)
    .closePath();
}

// The padlock glyph centred on (cx, cy): closed and filled when the dates
// are fixed, open (shackle lifted off its left post) and outlined when free.
function drawPadlock(g: Graphics, cx: number, cy: number, fixed: boolean, color: number, alpha: number): void {
  const top = cy - 0.5;
  if (fixed) {
    g.moveTo(cx - 3, top)
      .lineTo(cx - 3, top - 2.5)
      .arc(cx, top - 2.5, 3, Math.PI, 0)
      .lineTo(cx + 3, top)
      .stroke({ color, alpha, width: 1.4 });
    g.roundRect(cx - 4.5, top, 9, 6.5, 1.5).fill({ color, alpha });
  } else {
    g.moveTo(cx + 3, top)
      .lineTo(cx + 3, top - 4)
      .arc(cx, top - 4, 3, 0, Math.PI, true)
      .lineTo(cx - 3, top - 2.5)
      .stroke({ color, alpha, width: 1.4 });
    g.roundRect(cx - 4, top + 0.5, 8, 6, 1.5).stroke({ color, alpha, width: 1.2 });
  }
}

// The lock in the card's corner: a TAB_W x `tabH` tab, one solid fill (the
// card's colour shaded toward the ink), flush with the card's edges on the
// corner side (`outer`: the card's radius, 0 when it hugs the visible
// edge). The padlock sits on the dates' line, a hair toward the corner.
function drawLockCornerLocal(
  g: Graphics,
  look: number,
  card: number,
  tabH: number,
  outer: number,
  palette: PixiPaletteColors,
): void {
  g.clear();
  const fixed = (look & LOCK_FIXED) !== 0;
  const hovered = (look & LOCK_HOVER) !== 0;
  const muted = (look & LOCK_MUTED) !== 0;
  const shade = hovered ? LOCK_SHADE_HOVER : fixed ? LOCK_SHADE_FIXED : LOCK_SHADE_FREE;
  const fill = mixColor(card, palette.text, shade * (muted ? 0.6 : 1));
  cornerTabPath(g, 0, 0, TAB_W, tabH, outer, TAB_INNER_RADIUS);
  g.fill({ color: fill });
  const alpha = hovered ? 1 : muted ? 0.45 : fixed ? 0.95 : 0.75;
  // On the dates' line (the row sits TAB_PAD_TOP under the tab's top).
  drawPadlock(g, TAB_W / 2 - 1, TAB_PAD_TOP + CHIP_H / 2 + 1, fixed, palette.text, alpha);
}

// The lock beside a short card's text: a LOCK_W x LOCK_H badge — the
// card's colour shaded toward the ink, a hairline border of the ink — with
// the padlock centred; stronger when the dates are fixed and under the
// pointer. Muted cards: all of it quieter.
function drawLockBadgeLocal(g: Graphics, look: number, card: number, palette: PixiPaletteColors): void {
  g.clear();
  const fixed = (look & LOCK_FIXED) !== 0;
  const hovered = (look & LOCK_HOVER) !== 0;
  const muted = (look & LOCK_MUTED) !== 0;
  const shade = hovered ? LOCK_SHADE_HOVER : fixed ? LOCK_SHADE_FIXED : LOCK_SHADE_FREE;
  g.roundRect(0, 0, LOCK_W, LOCK_H, CHIP_RADIUS).fill({ color: mixColor(card, palette.text, shade) });
  const border = (hovered ? 0.5 : fixed ? 0.32 : 0.22) * (muted ? 0.6 : 1);
  g.roundRect(0.5, 0.5, LOCK_W - 1, LOCK_H - 1, CHIP_RADIUS - 0.5).stroke({
    color: palette.text,
    alpha: border,
    width: 1,
  });
  const alpha = hovered ? 1 : muted ? 0.45 : fixed ? 0.95 : 0.75;
  drawPadlock(g, LOCK_W / 2, LOCK_H / 2, fixed, palette.text, alpha);
}

// The dates tag: a soft rectangle in the card's colour shaded toward the
// ink (opaque: it hides what runs behind the dates), a small calendar glyph.
function drawDateTagLocal(
  g: Graphics,
  width: number,
  card: number,
  ink: number,
  muted: boolean,
  palette: PixiPaletteColors,
): void {
  g.clear();
  g.roundRect(0, 0, width, CHIP_H, CHIP_RADIUS).fill({ color: mixColor(card, palette.text, CHIP_SHADE) });
  const ix = DATE_PAD;
  const iy = (CHIP_H - CAL_ICON) / 2;
  const line = { color: ink, alpha: muted ? 0.6 : 0.9 };
  g.roundRect(ix + 0.5, iy + 1.5, CAL_ICON - 1, CAL_ICON - 2, 2).stroke({ ...line, width: 1.2 });
  g.rect(ix + 0.5, iy + 1.5, CAL_ICON - 1, 2.5).fill(line);
  g.moveTo(ix + 3, iy).lineTo(ix + 3, iy + 2.5).stroke({ ...line, width: 1.2 });
  g.moveTo(ix + CAL_ICON - 3, iy).lineTo(ix + CAL_ICON - 3, iy + 2.5).stroke({ ...line, width: 1.2 });
}

// px of the card that is the clip's real extent (content.extent, beats),
// or the whole width.
export function contentExtentPx(
  view: PlaylistClipPresentation,
  content: PlaylistClipContent | null,
): number {
  const width = view.rect.width;
  if (!content || content.kind !== "events" || content.extent === undefined) return width;
  const pxPerBeat = width / Math.max(view.clip.duration, 1e-9);
  return Math.min(width, Math.max(CLIP_EXTENT_MIN_PX, content.extent * pxPerBeat));
}

// Accent bar in the clip colour; its shape tells kinds apart without colour.
function drawAccent(
  body: Graphics,
  accentHeight: number,
  color: number,
  alpha: number,
  shape: "solid" | "dashed" | "dotted",
): void {
  const x = CLIP_ACCENT_INSET - 1;
  const top = CLIP_ACCENT_INSET;
  if (shape === "solid") {
    body
      .roundRect(x, top, CLIP_ACCENT_WIDTH, accentHeight, CLIP_ACCENT_WIDTH / 2)
      .fill({ color, alpha });
    return;
  }
  const dash = shape === "dashed" ? 7 : 3;
  const gap = shape === "dashed" ? 3 : 3;
  for (let y = top; y < top + accentHeight; y += dash + gap) {
    const h = Math.min(dash, top + accentHeight - y);
    if (h < 2) break;
    body.roundRect(x, y, CLIP_ACCENT_WIDTH, h, CLIP_ACCENT_WIDTH / 2);
  }
  body.fill({ color, alpha });
}

function drawClipOverlayLocal(
  overlay: Graphics,
  view: PlaylistClipPresentation,
  palette: PixiPaletteColors,
  levelHandles = false,
  highlighted: boolean | "danger" = false,
  extentPx: number = view.rect.width,
): void {
  overlay.clear();
  const width = view.rect.width;
  const height = view.rect.height;
  const radius = clipRadius(width, height);
  const color = parseHexColor(view.clip.color, palette.rowLine);

  // Selection: a soft halo + a crisp accent ring. Host highlight: a warm
  // ring ("danger": red ring + wash, it is about to go). Otherwise a
  // hairline in the clip colour (stronger on hover) — around the real
  // extent only for a one-day tag, unless hovered.
  if (highlighted === "danger") {
    const danger = palette.toneDanger ?? COLORS.toneDanger;
    overlay
      .roundRect(0, 0, width, height, radius)
      .fill({ color: danger, alpha: 0.14 });
    overlay
      .roundRect(-3, -3, width + 6, height + 6, radius + 3)
      .stroke({ color: danger, width: 4, alpha: 0.25 });
    overlay
      .roundRect(0, 0, width, height, radius)
      .stroke({ color: danger, width: 2, alpha: 1 });
  } else if (highlighted && !view.selected) {
    const warm = palette.toneWarning ?? COLORS.toneWarning;
    overlay
      .roundRect(-3, -3, width + 6, height + 6, radius + 3)
      .stroke({ color: warm, width: 4, alpha: 0.25 });
    overlay
      .roundRect(0, 0, width, height, radius)
      .stroke({ color: warm, width: 2, alpha: 1 });
  } else if (view.selected) {
    overlay
      .roundRect(-2, -2, width + 4, height + 4, radius + 2)
      .stroke({ color: palette.selected, width: 3, alpha: 0.22 });
    overlay
      .roundRect(0, 0, width, height, radius)
      .stroke({ color: palette.selected, width: 1.75, alpha: 1 });
  } else {
    const outline = view.hovered ? width : extentPx;
    overlay
      .roundRect(0.5, 0.5, outline - 1, height - 1, clipRadius(outline, height))
      .stroke({
        color,
        width: 1,
        alpha: view.hovered
          ? 0.9
          : (palette.clipBorderAlpha ?? COLORS.clipBorderAlpha),
      });
  }

  // Resize affordance: two short grips, only while it is actionable. They
  // sit below the title + detail rows when the card is tall enough, so they
  // never cross the text.
  const textBottom = view.titleRect.height + DETAIL_LINE_HEIGHT + 2;
  const gripTop = height - textBottom >= 12 ? textBottom : 6;
  const gripHeight = Math.min(16, height - gripTop - 6);
  if (
    (view.hovered || view.selected) &&
    view.clip.timeLocked !== true &&
    width >= 24 &&
    gripHeight >= 6
  ) {
    const gripY = gripTop + (height - gripTop - 6 - gripHeight) / 2;
    const inset = Math.min(4, view.resizeLeftRect.width / 2);
    // Selected: in the selection accent, like the rest of its handles (a
    // grey grip next to the blue ring read as a leftover).
    const grip = view.selected
      ? { color: palette.selected, alpha: 0.9 }
      : { color: palette.text, alpha: CLIP_RESIZE_ALPHA };
    overlay.roundRect(inset, gripY, 2, gripHeight, 1).fill(grip);
    overlay.roundRect(width - inset - 2, gripY, 2, gripHeight, 1).fill(grip);
  }

  // Level grip: a short bar centred on the top edge of a hovered (or, for
  // touch, selected) clip.
  if (levelHandles && (view.hovered || view.selected) && !view.isAutomation && width >= 40) {
    overlay
      .roundRect(width / 2 - 9, 1.5, 18, 3, 1.5)
      .fill({ color: palette.text, alpha: 0.4 });
  }

  // F6: subtle dot in the top-right corner when a clip belongs to a group
  // and the user is hovering. Renders only on hover so a fully-grouped
  // playlist doesn't look noisy.
  if (view.groupId && view.hovered) {
    const dotX = Math.max(8, width - 10);
    const dotY = 8;
    overlay.circle(dotX, dotY, 3).fill({
      color: palette.selected,
      alpha: 0.85,
    });
  }

  if (view.isAutomation && view.automationPoints.length > 0) {
    const points = view.automationPoints;
    const localX = (px: number) => px - view.rect.x;
    const localY = (py: number) => py - view.rect.y;
    overlay.moveTo(localX(points[0]!.position.x), localY(points[0]!.position.y));
    for (let i = 1; i < points.length; i += 1) {
      overlay.lineTo(localX(points[i]!.position.x), localY(points[i]!.position.y));
    }
    overlay.stroke({ color: palette.automationLine, width: 4, alpha: 0.55 });
    overlay.moveTo(localX(points[0]!.position.x), localY(points[0]!.position.y));
    for (let i = 1; i < points.length; i += 1) {
      overlay.lineTo(localX(points[i]!.position.x), localY(points[i]!.position.y));
    }
    overlay.stroke({ color: palette.text, width: 2, alpha: 0.9 });
    for (const point of points) {
      overlay
        .circle(
          localX(point.position.x),
          localY(point.position.y),
          point.selected ? 6.5 : 5,
        )
        .fill({
          color: point.selected ? palette.selected : palette.panelStrong,
        })
        .stroke({ color: palette.text, width: 1.5 });
    }
  }
}

function hidePeriod(node: ClipNode): void {
  hideText(node.period);
  if (node.periodBg) node.periodBg.visible = false;
}

function ensureText(
  node: ClipNode,
  key: "label" | "ratioBadge" | "offsetBadge" | "detail" | "period",
  factory: () => Text,
): Text {
  let existing = node[key];
  if (!existing) {
    existing = factory();
    existing.eventMode = "none";
    node.container.addChild(existing);
    node[key] = existing;
  }
  return existing;
}

function hideText(t: Text | null): void {
  if (t) t.visible = false;
}

function applyText(
  text: Text,
  value: string,
  color: number,
  size: number,
  weight: string,
): void {
  if (text.text !== value) text.text = value;
  const style = text.style;
  if (style.fill !== color) style.fill = color;
  if (style.fontSize !== size) style.fontSize = size;
  if (style.fontWeight !== weight) style.fontWeight = weight as any;
  text.visible = true;
}

export interface ClipNodeRegistry {
  // `stickyLeft`: screen x of the visible timeline's left edge; titles of
  // clips starting before it stick to it (default: no sticking).
  syncFrame(parent: Container, views: PlaylistClipPresentation[], stickyLeft?: number): void;
  // Screen rect of the lock button drawn on `clipId` in the last frame
  // (fills `out`), or null when it shows none (off-screen, too narrow, no
  // providers.timeLock). O(1). The controller's clipTimeLock.rectOf.
  lockRectOf(clipId: string, out: PlaylistRect): PlaylistRect | null;
  // Re-rasterises every node's labels with the fonts available now (a web
  // font that finished loading after the nodes were created). Once, never
  // per frame.
  refreshText(): void;
  // Forces every cached node to redraw on its next sync (e.g. after a
  // theme switch changed the live palette). O(nodes), never per frame.
  invalidate(): void;
  destroy(): void;
}

export function createClipNodeRegistry(
  palette: PixiPaletteColors,
  providers: ClipNodeProviders = {},
): ClipNodeRegistry {
  const cache = new Map<string, ClipNode>();
  const getClipDetail = providers.getClipDetail;
  const getClipSparkline = providers.getClipSparkline;
  const getClipContent = providers.getClipContent;
  const levelHandles = providers.levelHandles === true && providers.levelGrip !== true;
  const isClipHighlighted = providers.isClipHighlighted;
  const badges = providers.badges !== false;
  const timeLock = providers.timeLock === true;
  const getClipPeriod = timeLock ? providers.getClipPeriod : undefined;
  const getClipIcon = timeLock ? providers.getClipIcon : undefined;
  // The card shows its chip: its text shows (labels need 44 x 24) and the
  // chip fits its height.
  const lockFits = (view: PlaylistClipPresentation): boolean =>
    timeLock && view.rect.width >= LOCK_MIN_WIDTH && view.rect.height >= Math.max(24, CHIP_H + 2);

  // A lock-carrying card: the name and the amount in the pill.
  const detailBesideTitle = (view: PlaylistClipPresentation): boolean => timeLock && lockFits(view);

  // The card's own fill (the same mix the body paints), re-mixed only when
  // the clip's colour / muted state changed (no string parsing per frame).
  function cardFillOf(node: ClipNode, view: PlaylistClipPresentation): number {
    const muted = view.effectivelyMuted;
    if (node.cardColorSource !== view.clip.color || node.cardMuted !== muted) {
      node.cardColorSource = view.clip.color;
      node.cardMuted = muted;
      node.clipHue = parseHexColor(view.clip.color, 0x777777);
      node.cardFill = mixColor(
        palette.background ?? COLORS.background,
        node.clipHue,
        (palette.clipTint ?? COLORS.clipTint) * (muted ? CLIP_MUTED_TINT_SCALE : 1),
      );
    }
    return node.cardFill;
  }

  // The pill's colour: the canvas' own (near black on the dark theme, white
  // on the light one).
  const pillFill = (): number => palette.background ?? COLORS.background;

  // Gives `text` an outline of `color` when it changed since `last` (a new
  // style object only then: re-rasterised once, never per frame).
  function setHalo(text: Text, color: number, last: number): number {
    if (color !== last) text.style.stroke = { color, width: TEXT_HALO_WIDTH, join: "round" };
    return color;
  }

  // Secondary line under the title bar. Created lazily ONCE per node (same
  // factory pattern as the title label), never per frame.
  function applyDetail(
    node: ClipNode,
    view: PlaylistClipPresentation,
    detail: string | null,
    visible: boolean,
    shift: number,
  ): void {
    if (!visible || detail === null) {
      hideText(node.detail);
      return;
    }
    const width = view.rect.width;
    // On a short card the amount moves up beside the name: it gets the room
    // the name leaves (the name's real width, measured once per string).
    const besideTitle = detailBesideTitle(view);
    let start = DETAIL_PAD_X;
    if (besideTitle) {
      const label = node.label;
      if (label !== null && label.visible && node.labelDisplay.length > 0) {
        if (node.labelMeasured !== node.labelDisplay) {
          node.labelMeasured = node.labelDisplay;
          node.labelTextWidth = measured(label, node.labelDisplay.length * TITLE_CHAR_PX);
        }
        start = TITLE_PAD_X + node.iconAdvance + node.labelTextWidth + TITLE_DETAIL_GAP;
      } else {
        start = TITLE_PAD_X + node.iconAdvance;
      }
    }
    if (node.detailSource !== detail || node.detailWidth !== width || node.detailStart !== start) {
      node.detailSource = detail;
      node.detailWidth = width;
      node.detailStart = start;
      node.detailDisplay = besideTitle
        ? truncateToChars(detail, Math.floor((width - start - CLIP_TEXT_RIGHT_PAD) / DETAIL_CHAR_PX))
        : truncateClipDetail(detail, width);
    }
    if (node.detailDisplay.length === 0) {
      hideText(node.detail);
      return;
    }
    const text = ensureText(node, "detail", () =>
      new Text({
        text: node.detailDisplay,
        style: {
          fill: palette.textMuted,
          fontFamily: CANVAS_FONT_FAMILY,
          fontSize: DETAIL_FONT_SIZE,
          fontWeight: "600" as any,
        },
      }),
    );
    applyText(
      text,
      node.detailDisplay,
      palette.textMuted,
      DETAIL_FONT_SIZE,
      "600",
    );
    if (besideTitle) {
      node.detailHalo = setHalo(text, pillFill(), node.detailHalo);
      if (node.detailMeasured !== node.detailDisplay) {
        node.detailMeasured = node.detailDisplay;
        node.detailTextWidth = measured(text, node.detailDisplay.length * DETAIL_CHAR_PX);
      }
      // In the pill, after the name (its baseline: 1 px lower, the font
      // being 1 px smaller).
      text.x = start + shift - HALO_SHIFT;
      text.y = pillTop(view.rect.height) + Math.round((PILL_H - PILL_TITLE_TEXT_H) / 2) + 1 - HALO_SHIFT;
      return;
    }
    node.detailHalo = setHalo(text, cardFillOf(node, view), node.detailHalo);
    text.x = DETAIL_PAD_X + shift - HALO_SHIFT;
    text.y = view.titleRect.height + 2 - HALO_SHIFT;
  }

  // Sticky text: when the clip starts left of the visible timeline, its
  // title + detail slide right to stay at the left edge (you always know
  // which item it is), but never past the clip's own right end. Pure
  // arithmetic on cached display strings: a transform per frame, no redraw.
  function stickyShift(node: ClipNode, view: PlaylistClipPresentation, left: number): number {
    const hidden = left - view.rect.x;
    if (!(hidden > 0)) return 0;
    const besideTitle = detailBesideTitle(view);
    const block = besideTitle
      ? pillEnd(node.labelDisplay.length, node.detailDisplay.length, node.iconAdvance)
      : textBlockEnd(node.labelDisplay.length, node.detailDisplay.length);
    // The lock row slides with the text: it must fit too.
    const row = !besideTitle
      ? 0
      : lockBeside(view.rect.height, view.titleRect.height)
        ? lockRowEnd(true, block, node.periodDisplay.length)
        : chipPx(node.periodDisplay.length, false);
    const textWidth = Math.max(block, row);
    const room = view.rect.width - textWidth - CLIP_TEXT_RIGHT_PAD;
    return Math.round(Math.max(0, Math.min(hidden, room)));
  }

  function applyLabels(
    node: ClipNode,
    view: PlaylistClipPresentation,
    detailVisible: boolean,
    stickyLeft: number,
  ): number {
    const width = view.rect.width;
    const height = view.rect.height;
    if (width < 44 || height < 24) {
      hideText(node.label);
      hideText(node.ratioBadge);
      hideText(node.offsetBadge);
      if (node.lock) node.lock.visible = false;
      return 0;
    }
    refreshTitle(node, view);
    const shift = stickyShift(node, view, stickyLeft);
    if (node.labelDisplay.length === 0) {
      hideText(node.label);
    } else {
      const label = ensureText(node, "label", () =>
        new Text({
          text: node.labelDisplay,
          style: {
            fill: palette.text,
            fontFamily: CANVAS_FONT_FAMILY,
            fontSize: TITLE_FONT_SIZE,
            fontWeight: "600" as any,
          },
        }),
      );
      const inPill = detailBesideTitle(view);
      cardFillOf(node, view);
      applyText(
        label,
        node.labelDisplay,
        view.effectivelyMuted ? palette.textMuted : inPill ? node.clipHue : palette.text,
        TITLE_FONT_SIZE,
        inPill ? "700" : "600",
      );
      node.labelHalo = setHalo(label, inPill ? pillFill() : node.cardFill, node.labelHalo);
      // After the icon, when the pill has one.
      label.x = TITLE_PAD_X + node.iconAdvance + shift - HALO_SHIFT;
      label.y = inPill
        ? pillTop(height) + Math.round((PILL_H - PILL_TITLE_TEXT_H) / 2) - HALO_SHIFT
        : TITLE_Y - HALO_SHIFT;
    }

    const ratio = view.clip.stretchRatio ?? 1;
    if (badges && Math.abs(ratio - 1) > 0.001 && width >= 60) {
      const tagText = `×${ratio.toFixed(2).replace(/\.?0+$/, "")}`;
      const badge = ensureText(node, "ratioBadge", () =>
        new Text({
          text: tagText,
          style: {
            fill: palette.text,
            fontFamily: CANVAS_FONT_FAMILY,
            fontSize: 11,
            fontWeight: "700" as any,
          },
        }),
      );
      applyText(badge, tagText, palette.text, 11, "700");
      badge.x = width - 8 - tagText.length * 6;
      badge.y = 4;
    } else {
      hideText(node.ratioBadge);
    }

    const offset = view.clip.contentOffset ?? 0;
    if (badges && Math.abs(offset) > 0.001 && width >= 80) {
      const offsetText = `↻${offset.toFixed(2).replace(/\.?0+$/, "")}`;
      const badge = ensureText(node, "offsetBadge", () =>
        new Text({
          text: offsetText,
          style: {
            fill: palette.textMuted,
            fontFamily: CANVAS_FONT_FAMILY,
            fontSize: 11,
            fontWeight: "600" as any,
          },
        }),
      );
      applyText(badge, offsetText, palette.textMuted, 11, "600");
      badge.x = 12;
      // With a detail line present the badge drops below it (or hides when
      // there is no room) so the two never overlap.
      if (detailVisible) {
        const y = view.titleRect.height + 1 + DETAIL_LINE_HEIGHT;
        badge.y = y;
        if (y + DETAIL_LINE_HEIGHT > height) badge.visible = false;
      } else {
        badge.y = 18;
      }
    } else {
      hideText(node.offsetBadge);
    }
    return shift;
  }

  function refreshTitle(node: ClipNode, view: PlaylistClipPresentation): void {
    // The icon takes its room from the name's.
    const width = view.rect.width - node.iconAdvance;
    if (node.labelSource !== view.clip.label || node.labelWidth !== width) {
      node.labelSource = view.clip.label;
      node.labelWidth = width;
      node.labelDisplay = truncateClipTitle(view.clip.label, width);
    }
  }

  // The dates' display: truncated to the room the lock row leaves (by
  // width / height / the text it follows, not by the sticky shift), so it is
  // rebuilt only when one of those changes.
  function refreshPeriod(
    node: ClipNode,
    view: PlaylistClipPresentation,
    period: string | null,
    detailVisible: boolean,
  ): void {
    const width = view.rect.width;
    const height = view.rect.height;
    if (
      node.periodSource === period &&
      node.periodWidth === width &&
      node.periodHeight === height &&
      node.periodAdvance === node.iconAdvance
    ) {
      return;
    }
    node.periodSource = period;
    node.periodWidth = width;
    node.periodHeight = height;
    node.periodAdvance = node.iconAdvance;
    if (period === null || period.length === 0) {
      node.periodDisplay = "";
      return;
    }
    const block = pillEnd(node.labelDisplay.length, detailVisible ? node.detailDisplay.length : 0, node.iconAdvance);
    const beside = lockBeside(height, view.titleRect.height);
    const start =
      lockRowStart(beside, block) +
      lockButtonW(beside) +
      lockDateGap(beside) +
      DATE_PAD +
      CAL_ICON +
      CAL_GAP;
    node.periodDisplay = truncateToChars(
      period,
      Math.floor((width - start - DATE_PAD - CLIP_TEXT_RIGHT_PAD) / DETAIL_CHAR_PX),
    );
  }

  // The real width of a Text (measured once per string; the estimate where
  // there is no canvas to measure with, e.g. headless).
  function measured(text: Text, estimate: number): number {
    try {
      return Math.ceil(text.width);
    } catch {
      return Math.ceil(estimate);
    }
  }

  // The third row: the lock button, then the dates tag — under the name and
  // the amount or, on a card too short for it, beside the text block,
  // centred. Placed by transform with the title's sticky shift; each piece
  // redrawn only when its look / width / card colour change.
  function placeLockRow(node: ClipNode, view: PlaylistClipPresentation, shift: number): void {
    const muted = view.effectivelyMuted;
    // The card's own fill under the row.
    const card = cardFillOf(node, view);

    let lock = node.lock;
    if (!lock) {
      lock = new Graphics();
      node.lock = lock;
      // Over the card's fill, UNDER its outline (the overlay): the corner's
      // edge stays the card's, crisp over the tab.
      node.container.addChildAt(lock, node.container.getChildIndex(node.overlay));
    }
    const height = view.rect.height;
    const beside = lockBeside(height, view.titleRect.height);
    const tabH = beside ? LOCK_H : cornerTabHeight(height);
    // Sticky: the tab hugs the visible left edge — square, like that edge.
    const outer = shift > 0 ? 0 : clipRadius(view.rect.width, height);
    const look =
      (view.clip.timeLocked === true ? LOCK_FIXED : LOCK_FREE) |
      (view.lockHovered ? LOCK_HOVER : 0) |
      (muted ? LOCK_MUTED : 0) |
      (beside ? 0 : LOCK_CORNER) |
      (outer === 0 ? LOCK_SQUARE : 0);
    // Numbers, not a string: no allocation per frame.
    const lockKey = (card * 64 + look) * 32 + tabH;
    if (lockKey !== node.lockKey) {
      if (beside) drawLockBadgeLocal(lock, look, card, palette);
      else drawLockCornerLocal(lock, look, card, tabH, outer, palette);
      node.lockKey = lockKey;
    }
    node.lockW = lockButtonW(beside);
    node.lockH = tabH;

    // Where the row sits: at the card's bottom (the room left is air under
    // the amount), or centred on the whole card (beside).
    const rowY = beside
      ? Math.min(Math.round((height - CHIP_H) / 2), height - CHIP_H - 1)
      : cornerRowY(height);
    let x: number;
    // The badge beside the text is a touch taller than the dates tag.
    let y = rowY - (LOCK_H - CHIP_H) / 2;
    if (!beside) {
      // The corner: flush with the left and bottom edges.
      x = lockRowStart(false, 0) + shift;
      y = height - tabH;
    } else {
      // After the pill (its real width).
      x = Math.min(lockRowStart(true, node.pillWidth) + shift, view.rect.width - LOCK_W - 2);
    }
    lock.x = Math.round(x);
    lock.y = y;
    lock.visible = true;

    // The dates tag, a few px after the lock: a different thing.
    if (!node.periodDisplay) {
      hidePeriod(node);
      return;
    }
    // The tag first, so the text (added after) paints over it.
    let tag = node.periodBg;
    if (!tag) {
      tag = new Graphics();
      node.periodBg = tag;
      node.container.addChild(tag);
    }
    // The amount line's grey: one family with the text above.
    const ink = palette.textMuted;
    const text = ensureText(node, "period", () =>
      new Text({
        text: node.periodDisplay,
        style: {
          fill: ink,
          fontFamily: CANVAS_FONT_FAMILY,
          fontSize: PERIOD_FONT_SIZE,
          fontWeight: "600" as any,
        },
      }),
    );
    applyText(text, node.periodDisplay, ink, PERIOD_FONT_SIZE, "600");
    text.alpha = muted ? 0.7 : 1;
    if (node.periodMeasured !== node.periodDisplay) {
      node.periodMeasured = node.periodDisplay;
      node.periodTextWidth = measured(text, node.periodDisplay.length * DETAIL_CHAR_PX);
    }
    const tagWidth = DATE_PAD * 2 + CAL_ICON + CAL_GAP + node.periodTextWidth;
    const tagKey = (card * 4096 + tagWidth) * 2 + (muted ? 1 : 0);
    if (tagKey !== node.periodBgKey) {
      drawDateTagLocal(tag, tagWidth, card, ink, muted, palette);
      node.periodBgKey = tagKey;
    }
    tag.x = lock.x + lockButtonW(beside) + lockDateGap(beside);
    tag.y = rowY;
    tag.visible = true;
    text.x = tag.x + DATE_PAD + CAL_ICON + CAL_GAP;
    text.y = tag.y + Math.round((CHIP_H - DETAIL_LINE_HEIGHT) / 2);
  }

  // The pill behind the name and the amount: from the card's left edge
  // (the sticky shift: the visible one) to just past the amount, its right
  // end round. Under the card's outline, over its fill and marks.
  function placePill(node: ClipNode, view: PlaylistClipPresentation, shift: number): void {
    const label = node.label;
    if (!detailBesideTitle(view) || label === null || !label.visible) {
      if (node.pill) node.pill.visible = false;
      node.pillWidth = 0;
      return;
    }
    if (node.labelMeasured !== node.labelDisplay) {
      node.labelMeasured = node.labelDisplay;
      node.labelTextWidth = measured(label, node.labelDisplay.length * TITLE_CHAR_PX);
    }
    const detail = node.detail;
    const detailShown = detail !== null && detail.visible && node.detailDisplay.length > 0;
    const width = Math.min(
      Math.ceil(
        TITLE_PAD_X +
          node.iconAdvance +
          node.labelTextWidth +
          (detailShown ? TITLE_DETAIL_GAP + node.detailTextWidth : 0) +
          PILL_PAD_R,
      ),
      Math.max(0, Math.floor(view.rect.width - shift)),
    );
    let pill = node.pill;
    if (!pill) {
      pill = new Graphics();
      node.pill = pill;
      node.container.addChildAt(pill, node.container.getChildIndex(node.overlay));
    }
    const muted = view.effectivelyMuted;
    // Numbers, not a string: no allocation per frame.
    const key = width * 2 + (muted ? 1 : 0);
    if (key !== node.pillKey) {
      node.pillKey = key;
      pill.clear();
      const r = PILL_H / 2;
      pill
        .moveTo(0, 0)
        .lineTo(Math.max(0, width - r), 0)
        .arcTo(width, 0, width, r, r)
        .arcTo(width, PILL_H, Math.max(0, width - r), PILL_H, r)
        .lineTo(0, PILL_H)
        .closePath()
        .fill({ color: pillFill(), alpha: muted ? 0.6 : 1 });
    }
    pill.x = shift;
    pill.y = pillTop(view.rect.height);
    pill.visible = true;
    node.pillWidth = width;
  }

  // One GraphicsContext per glyph for the whole registry (built the first
  // time a glyph shows, never per frame): every node with that icon draws
  // the same geometry, tinted with its own colour.
  const glyphContexts = new Map<PlaylistClipIcon, GraphicsContext>();
  function glyphContext(glyph: PlaylistClipIcon): GraphicsContext {
    let context = glyphContexts.get(glyph);
    if (!context) {
      context = new GraphicsContext();
      for (const d of glyph) {
        // White, so the node's tint IS the colour.
        context.path(new GraphicsPath(d)).stroke({ width: ICON_STROKE, color: 0xffffff, cap: "round", join: "round" });
      }
      glyphContexts.set(glyph, context);
    }
    return context;
  }

  // The icon, first in the pill: shown with the name (never alone), in the
  // clip's colour (grey when muted). Placed by transform with the sticky
  // shift; its geometry changes only with the glyph's reference.
  function placeIcon(
    node: ClipNode,
    view: PlaylistClipPresentation,
    glyph: PlaylistClipIcon | null,
    shift: number,
  ): void {
    const label = node.label;
    if (glyph === null || node.iconAdvance === 0 || label === null || !label.visible) {
      if (node.icon) node.icon.visible = false;
      return;
    }
    let icon = node.icon;
    if (!icon) {
      icon = new Graphics(glyphContext(glyph));
      icon.eventMode = "none";
      icon.scale.set(ICON_PX / ICON_GRID);
      node.icon = icon;
      node.container.addChild(icon);
    } else if (node.iconSource !== glyph) {
      icon.context = glyphContext(glyph);
    }
    node.iconSource = glyph;
    const tint = view.effectivelyMuted ? palette.textMuted : node.clipHue;
    if (node.iconTint !== tint) {
      icon.tint = tint;
      node.iconTint = tint;
    }
    icon.x = TITLE_PAD_X + shift;
    icon.y = pillTop(view.rect.height) + (PILL_H - ICON_PX) / 2;
    icon.visible = true;
  }

  function createNode(): ClipNode {
    const container = new Container();
    container.eventMode = "none";
    const body = new Graphics();
    const overlay = new Graphics();
    container.addChild(body, overlay);
    return {
      container,
      body,
      overlay,
      label: null,
      labelSource: "",
      labelWidth: -1,
      labelDisplay: "",
      labelHalo: -1,
      detailHalo: -1,
      cardColorSource: "",
      cardMuted: false,
      cardFill: 0,
      ratioBadge: null,
      offsetBadge: null,
      detail: null,
      detailSource: "",
      detailWidth: -1,
      detailStart: -1,
      labelMeasured: "",
      labelTextWidth: 0,
      detailMeasured: "",
      detailTextWidth: 0,
      pill: null,
      pillKey: -1,
      pillWidth: 0,
      clipHue: 0x777777,
      icon: null,
      iconSource: null,
      iconTint: -1,
      iconAdvance: 0,
      periodAdvance: 0,
      detailDisplay: "",
      bars: null,
      content: null,
      contentStart: 0,
      contentPxPerBeat: 0,
      highlighted: false,
      lock: null,
      lockKey: -1,
      lockW: 0,
      lockH: 0,
      period: null,
      periodSource: null,
      periodWidth: -1,
      periodHeight: -1,
      periodDisplay: "",
      periodBg: null,
      periodBgKey: -1,
      periodMeasured: "",
      periodTextWidth: 0,

      hash: "",
      width: 0,
      height: 0,
    };
  }

  function syncFrame(
    parent: Container,
    views: PlaylistClipPresentation[],
    stickyLeft: number = Number.NEGATIVE_INFINITY,
  ): void {
    const seen = new Set<string>();
    for (const view of views) {
      seen.add(view.clip.id);
      let node = cache.get(view.clip.id);
      if (!node) {
        node = createNode();
        cache.set(view.clip.id, node);
        parent.addChild(node.container);
      }
      node.container.visible = true;
      node.container.x = Math.round(view.rect.x);
      node.container.y = Math.round(view.rect.y);
      const detail = getClipDetail ? getClipDetail(view.clip.id) : null;
      // In the pill the amount sits beside the name: it needs no body room.
      const detailVisible = detailBesideTitle(view)
        ? detail !== null && detail.length > 0
        : isClipDetailVisible(view, detail);
      // Queried every frame for visible pattern clips (O(1) by contract) so
      // bars that depend on data outside the hash — e.g. the clip's calendar
      // position — still repaint; the reference compare keeps it free.
      const content =
        getClipContent && !view.isAutomation
          ? getClipContent(view.clip.id)
          : null;
      const bars =
        content === null && getClipSparkline && view.clip.type === "pattern"
          ? getClipSparkline(view.clip.id)
          : null;
      const hash = clipVisualHash(view, detail);
      const highlighted = isClipHighlighted ? isClipHighlighted(view.clip.id) : false;
      const visualChanged =
        hash !== node.hash ||
        node.width !== view.rect.width ||
        node.height !== view.rect.height ||
        highlighted !== node.highlighted;
      // Content is laid out at absolute beats: a move or a zoom re-lays it
      // out even with the same reference (number compares, no allocation).
      const contentPxPerBeat =
        content !== null
          ? view.rect.width / Math.max(view.clip.duration, 1e-9)
          : 0;
      const contentChanged =
        content !== node.content ||
        (content !== null &&
          (node.contentStart !== view.clip.start ||
            node.contentPxPerBeat !== contentPxPerBeat));
      if (visualChanged || bars !== node.bars || contentChanged) {
        // New bars / content alone only touch the body; the overlay
        // (outline, handles, automation polyline) does not depend on them.
        drawClipBodyLocal(
          node.body,
          view,
          palette,
          bars,
          detailVisible,
          content,
        );
        node.bars = bars;
        node.content = content;
        node.contentStart = view.clip.start;
        node.contentPxPerBeat = contentPxPerBeat;
      }
      if (visualChanged) {
        drawClipOverlayLocal(
          node.overlay,
          view,
          palette,
          levelHandles,
          highlighted,
          contentExtentPx(view, content),
        );
        node.highlighted = highlighted;
        node.hash = hash;
        node.width = view.rect.width;
        node.height = view.rect.height;
      }
      // The detail's, title's and dates' display strings feed the sticky
      // width: refresh them first.
      if (detail !== null && (node.detailSource !== detail || node.detailWidth !== view.rect.width)) {
        node.detailSource = detail;
        node.detailWidth = view.rect.width;
        node.detailDisplay = truncateClipDetail(detail, view.rect.width);
        // applyDetail cuts it again for where it starts (beside the name).
        node.detailStart = -1;
      }
      // The icon rides in the pill: it takes room before the name there.
      const glyph = getClipIcon && detailBesideTitle(view) ? getClipIcon(view.clip.id) : null;
      node.iconAdvance = glyph !== null ? ICON_ADVANCE : 0;
      if (getClipPeriod) {
        refreshTitle(node, view);
        refreshPeriod(node, view, getClipPeriod(view.clip.id), detailVisible);
      }
      const shift = applyLabels(node, view, detailVisible, stickyLeft);
      applyDetail(node, view, detail, detailVisible, shift);
      placePill(node, view, shift);
      placeIcon(node, view, glyph, shift);
      if (timeLock) {
        if (lockFits(view)) {
          placeLockRow(node, view, shift);
        } else {
          if (node.lock) node.lock.visible = false;
          hidePeriod(node);
        }
      }
    }
    // Hide nodes whose clips are off-screen this frame. We keep them
    // parented so future frames can show them again in O(1) — only
    // destroy() runs on registry tear-down. PERF-EXEMPT n/a: this is
    // exactly the cache + recycle pattern §3.8 prescribes.
    for (const [id, node] of cache) {
      if (seen.has(id)) continue;
      node.container.visible = false;
      hideText(node.label);
      hideText(node.ratioBadge);
      hideText(node.offsetBadge);
      hideText(node.detail);
      hidePeriod(node);
      if (node.pill) node.pill.visible = false;
      if (node.icon) node.icon.visible = false;
    }
  }

  function destroy(): void {
    for (const node of cache.values()) {
      try {
        node.container.removeFromParent();
        // Graphics destroys are safe; Text is left to GC to avoid the v8
        // TexturePool tear-down crash (canon §3 + dispose-text history).
        node.body.destroy();
        node.overlay.destroy();
        node.lock?.destroy();
        node.periodBg?.destroy();
        node.pill?.destroy();
        // Its context is the registry's (shared): destroyed below, once.
        node.icon?.destroy();
        if (node.label) node.label.removeFromParent();
        if (node.ratioBadge) node.ratioBadge.removeFromParent();
        if (node.offsetBadge) node.offsetBadge.removeFromParent();
        if (node.detail) node.detail.removeFromParent();
        if (node.period) node.period.removeFromParent();
      } catch {
        // noop — best-effort cleanup
      }
    }
    cache.clear();
    for (const context of glyphContexts.values()) context.destroy();
    glyphContexts.clear();
  }

  function invalidate(): void {
    for (const node of cache.values()) {
      node.hash = "";
      node.lockKey = -1;
      node.periodBgKey = -1;
      node.pillKey = -1;
      node.iconTint = -1;
      // The palette changed: the card's fill is mixed again.
      node.cardColorSource = "";
    }
  }

  function refreshText(): void {
    for (const node of cache.values()) {
      // style.update() bumps the style key, so Pixi rasterises a new
      // texture (its texture cache is keyed by text + style key).
      node.label?.style.update();
      node.ratioBadge?.style.update();
      node.offsetBadge?.style.update();
      node.detail?.style.update();
      node.period?.style.update();
      // Re-measured with the fonts available now.
      node.periodMeasured = "";
      node.labelMeasured = "";
      node.detailMeasured = "";
    }
  }

  function lockRectOf(clipId: string, out: PlaylistRect): PlaylistRect | null {
    const node = cache.get(clipId);
    if (!node || !node.container.visible || !node.lock || !node.lock.visible) return null;
    // The lock button alone (the dates tag is information, not a control).
    out.x = node.container.x + node.lock.x;
    out.y = node.container.y + node.lock.y;
    out.width = node.lockW;
    out.height = node.lockH;
    return out;
  }

  return { syncFrame, refreshText, invalidate, destroy, lockRectOf };
}
