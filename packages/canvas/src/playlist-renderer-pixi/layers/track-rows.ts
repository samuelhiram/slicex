// Track header panel (rows on the left): colour dot, name, host subtitle +
// meter, mute / solo / lock icon toggles, reorder grip, hairlines. Lives on
// the global chromeGraphics layer (outside the timeline mask) so headers
// stay legible while clips slide.
//
// Icons instead of "M S L" letters: mute = eye (crossed out while muted),
// solo = focus ring, lock = padlock. Inactive toggles are quiet glyphs;
// active ones get a tinted chip so the state reads at a glance.
import type { Container, Graphics } from "pixi.js";
import {
  getTracksTop,
  type PlaylistPresentation,
  type PlaylistTrackMeta,
  type PlaylistTrackRowPresentation,
} from "../../playlist-core";
import { truncateMiddle } from "../clip-node-registry";
import { COLORS, parseHexColor } from "../palette";
import { addText } from "../text-pool";

// Host-provided header extras (PlaylistRendererCallbacks.getTrackMeta).
// Queried once per VISIBLE real row per frame (O(1) by contract). The
// derived display string (truncated subtitle) is cached per track and
// recomputed only when the provider returns a different meta object, so a
// steady frame allocates nothing.
export interface TrackMetaSource {
  get: (trackId: string) => PlaylistTrackMeta | null;
  cache: Map<string, { meta: PlaylistTrackMeta; subtitle: string }>;
}

// Host-provided display name of a row, cached per source label (bounded
// by the number of distinct labels): a steady frame is a Map hit.
export function createTrackLabelFormatter(
  format: (label: string) => string,
): (label: string) => string {
  const cache = new Map<string, string>();
  return (label) => {
    let shown = cache.get(label);
    if (shown === undefined) {
      shown = format(label);
      cache.set(label, shown);
    }
    return shown;
  };
}

export function createTrackMetaSource(
  get: (trackId: string) => PlaylistTrackMeta | null,
): TrackMetaSource {
  return { get, cache: new Map() };
}

// Vertical layout comes from the presentation (row.headerLayout /
// row.titleY: "full" / "compact" / "mini" by row height), shared with the
// hit-test so the toggles are drawn where they are clicked.
const NAME_X = 30;
const NAME_SIZE = 13;
const NAME_CHAR_PX = 7.6;
const DOT_X = 17;
const DOT_RADIUS = 4;
const SUBTITLE_Y = 28;
const SUBTITLE_SIZE = 11;
const SUBTITLE_CHAR_PX = 6.2;
const METER_HEIGHT = 3;
// Compact rows: the meter under the subtitle, when the row has room.
const COMPACT_METER_Y = 46;
const COMPACT_METER_MIN_ROW_HEIGHT = 52;

function truncateText(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return "…";
  return `${text.slice(0, maxChars - 1)}…`;
}

// Truncated track names, keyed by width budget, then source label. Two
// budgets coexist in a frame (a compact row with its toggles showing gets a
// shorter one), so each keeps its own map: a steady frame is a Map hit
// (no alloc). Bounded by budgets x distinct labels.
const nameCache = new Map<number, Map<string, string>>();

function displayName(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label;
  let byLabel = nameCache.get(maxChars);
  if (!byLabel) {
    byLabel = new Map();
    nameCache.set(maxChars, byLabel);
  }
  let display = byLabel.get(label);
  if (display === undefined) {
    // Middle ellipsis: a derived title keeps its "+N" ("Pago Tar… +1").
    display = truncateMiddle(label, maxChars);
    byLabel.set(label, display);
  }
  return display;
}

function resolveTrackMeta(
  source: TrackMetaSource,
  trackId: string,
  headerWidth: number,
): { meta: PlaylistTrackMeta; subtitle: string } | null {
  const meta = source.get(trackId);
  if (!meta) return null;
  let entry = source.cache.get(trackId);
  if (!entry) {
    entry = { meta, subtitle: "" };
    source.cache.set(trackId, entry);
  } else if (entry.meta === meta) {
    return entry;
  }
  entry.meta = meta;
  entry.subtitle = meta.subtitle
    ? truncateText(
        meta.subtitle,
        Math.floor((headerWidth - NAME_X - 12) / SUBTITLE_CHAR_PX),
      )
    : "";
  return entry;
}

function drawTrackMeta(
  graphics: Graphics,
  textLayer: Container,
  row: PlaylistTrackRowPresentation,
  meta: PlaylistTrackMeta,
  subtitle: string,
  muted: boolean,
): void {
  const top = row.rowRect.y;
  const height = row.rowRect.height;
  // Mini rows: the name alone.
  if (row.headerLayout === "mini") return;
  if (subtitle.length > 0) {
    addText(textLayer, subtitle, NAME_X, top + SUBTITLE_Y, {
      color: COLORS.textMuted,
      size: SUBTITLE_SIZE,
      weight: "500",
    });
  }
  const meter = meta.meter;
  if (meter === undefined || !Number.isFinite(meter)) return;
  const value = meter < -1 ? -1 : meter > 1 ? 1 : meter;
  let x0: number;
  let x1: number;
  let y: number;
  if (row.headerLayout === "full") {
    // Thin centred meter on the toggle row, between the toggles and the grip.
    const lock = row.buttons.lock;
    x0 = lock.x + lock.width + 12;
    x1 = row.reorderHandleRect.x - 10;
    y = Math.round(lock.y + lock.height / 2 - METER_HEIGHT / 2);
  } else {
    // Compact: under the subtitle (the toggles moved up to the name).
    if (height < COMPACT_METER_MIN_ROW_HEIGHT) return;
    x0 = NAME_X;
    x1 = row.headerRect.x + row.headerRect.width - 16;
    y = top + COMPACT_METER_Y;
  }
  const width = x1 - x0;
  if (width <= 8) return;
  const half = width / 2;
  const center = x0 + half;
  graphics
    .roundRect(x0, y, width, METER_HEIGHT, METER_HEIGHT / 2)
    .fill({ color: COLORS.rowLine });
  if (value > 0) {
    graphics
      .roundRect(center, y, Math.max(METER_HEIGHT, half * value), METER_HEIGHT, METER_HEIGHT / 2)
      .fill({ color: COLORS.tonePositive, alpha: muted ? 0.45 : 1 });
  } else if (value < 0) {
    const w = Math.max(METER_HEIGHT, -half * value);
    graphics
      .roundRect(center - w, y, w, METER_HEIGHT, METER_HEIGHT / 2)
      .fill({ color: COLORS.toneDanger, alpha: muted ? 0.45 : 1 });
  }
  graphics
    .rect(center - 0.5, y - 2, 1, METER_HEIGHT + 4)
    .fill({ color: COLORS.textSubtle, alpha: 0.8 });
}

interface ButtonRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function drawToggleChip(
  graphics: Graphics,
  rect: ButtonRect,
  color: number,
): void {
  graphics
    .roundRect(rect.x - 2, rect.y - 2, rect.width + 4, rect.height + 4, 5)
    .fill({ color, alpha: 0.14 });
}

// Eye (visible) / crossed eye (muted).
function drawMuteIcon(graphics: Graphics, rect: ButtonRect, muted: boolean): void {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const color = muted ? COLORS.toneDanger : COLORS.textSubtle;
  if (muted) drawToggleChip(graphics, rect, COLORS.toneDanger);
  graphics.ellipse(cx, cy, 6, 3.8).stroke({ color, width: 1.3 });
  graphics.circle(cx, cy, 1.7).fill({ color });
  if (muted) {
    graphics
      .moveTo(cx - 5.5, cy + 5.5)
      .lineTo(cx + 5.5, cy - 5.5)
      .stroke({ color, width: 1.4 });
  }
}

// Focus ring (solo).
function drawSoloIcon(graphics: Graphics, rect: ButtonRect, soloed: boolean): void {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const color = soloed ? COLORS.selected : COLORS.textSubtle;
  if (soloed) drawToggleChip(graphics, rect, COLORS.selected);
  graphics.circle(cx, cy, 5.2).stroke({ color, width: 1.3 });
  graphics.circle(cx, cy, 1.9).fill({ color });
}

// Padlock (closed while locked, open shackle otherwise).
function drawLockIcon(graphics: Graphics, rect: ButtonRect, locked: boolean): void {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const color = locked ? COLORS.text : COLORS.textSubtle;
  if (locked) drawToggleChip(graphics, rect, COLORS.text);
  graphics.roundRect(cx - 4.5, cy - 1, 9, 6.5, 1.5);
  if (locked) graphics.fill({ color });
  graphics.stroke({ color, width: 1.3 });
  const shackleX = locked ? cx : cx + 2.5;
  graphics
    .moveTo(shackleX - 2.8, cy - 1)
    .lineTo(shackleX - 2.8, cy - 3.2)
    .arc(shackleX, cy - 3.2, 2.8, Math.PI, 0)
    .lineTo(shackleX + 2.8, locked ? cy - 1 : cy - 2.6)
    .stroke({ color, width: 1.3 });
}

// Six-dot drag grip.
function drawReorderHandle(graphics: Graphics, rect: ButtonRect): void {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  for (let i = -1; i <= 1; i += 1) {
    graphics.circle(cx - 2.5, cy + i * 4, 1.1).fill({ color: COLORS.textSubtle });
    graphics.circle(cx + 2.5, cy + i * 4, 1.1).fill({ color: COLORS.textSubtle });
  }
}

export function drawTrackRows(
  graphics: Graphics,
  textLayer: Container,
  presentation: PlaylistPresentation,
  metaSource: TrackMetaSource | null = null,
  trackLabel: ((label: string) => string) | null = null,
): void {
  const { metrics } = presentation;
  const tracksTop = getTracksTop(metrics);
  const viewportBottom = presentation.state.viewport.height;
  const nameChars = Math.floor(
    (metrics.trackHeaderWidth - NAME_X - 10) / NAME_CHAR_PX,
  );

  const hover = presentation.state.hover;
  const hoveredTrackId = hover?.kind === "track" ? hover.trackId : null;
  for (const row of presentation.trackRows) {
    const color = parseHexColor(row.track.color, COLORS.textMuted);
    const muted = row.track.muted === true;
    const soloed = row.track.soloed === true;
    const locked = row.track.locked === true;

    graphics
      .rect(
        row.headerRect.x,
        row.headerRect.y,
        row.headerRect.width,
        row.headerRect.height,
      )
      .fill({ color: COLORS.panel });
    if (row.hasSelectedClips) {
      graphics
        .rect(row.headerRect.x, row.headerRect.y, row.headerRect.width, row.headerRect.height)
        .fill({ color: COLORS.selected, alpha: 0.07 });
      graphics
        .rect(row.headerRect.x, row.headerRect.y + 6, 2, row.headerRect.height - 12)
        .fill({ color: COLORS.selected });
    }
    graphics
      .moveTo(0, row.rowRect.y + row.rowRect.height - 0.5)
      .lineTo(
        row.rowRect.x + row.rowRect.width,
        row.rowRect.y + row.rowRect.height - 0.5,
      )
      .stroke({ color: COLORS.rowLine, width: 1 });
    graphics
      .moveTo(metrics.trackHeaderWidth - 0.5, row.rowRect.y)
      .lineTo(
        metrics.trackHeaderWidth - 0.5,
        row.rowRect.y + row.rowRect.height,
      )
      .stroke({ color: COLORS.rowLine, width: 1 });

    graphics
      .circle(DOT_X, row.rowRect.y + row.titleY + 8, DOT_RADIUS)
      .fill({ color, alpha: muted ? 0.35 : 1 });
    // Controls appear where they act: on the hovered / selected row, or
    // when their state is on (a muted row keeps its eye so you see why).
    // The hit areas stay put, so hovering reveals them before the click.
    const showControls = row.track.id === hoveredTrackId || row.hasSelectedClips;
    // Compact / mini rows carry the toggles on the name's line: the name
    // stops before them while any of them shows.
    const togglesOnNameLine =
      row.headerLayout !== "full" && (showControls || muted || soloed || locked);
    const rowNameChars = togglesOnNameLine
      ? Math.max(1, Math.floor((row.buttons.mute.x - 8 - NAME_X) / NAME_CHAR_PX))
      : nameChars;
    // Host header extras: only real rows actually on screen. Resolved
    // before the name: the host may name the row (meta.title).
    const entry =
      metaSource !== null &&
      !row.isVirtual &&
      row.rowRect.y + row.rowRect.height > tracksTop &&
      row.rowRect.y < viewportBottom
        ? resolveTrackMeta(metaSource, row.track.id, row.headerRect.width)
        : null;
    const label =
      entry?.meta.title ?? (trackLabel ? trackLabel(row.track.label) : row.track.label);
    addText(
      textLayer,
      displayName(label, rowNameChars),
      NAME_X,
      row.rowRect.y + row.titleY,
      {
        color: muted ? COLORS.textMuted : COLORS.text,
        size: NAME_SIZE,
        weight: row.isVirtual ? "500" : "600",
      },
    );

    if (showControls || muted) drawMuteIcon(graphics, row.buttons.mute, muted);
    if (showControls || soloed) drawSoloIcon(graphics, row.buttons.solo, soloed);
    if (showControls || locked) drawLockIcon(graphics, row.buttons.lock, locked);
    if (showControls) drawReorderHandle(graphics, row.reorderHandleRect);

    if (entry) {
      drawTrackMeta(graphics, textLayer, row, entry.meta, entry.subtitle, muted);
    }
  }
}
