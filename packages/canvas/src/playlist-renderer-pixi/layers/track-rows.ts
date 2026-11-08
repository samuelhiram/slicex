// Track header panel (rows on the left): name, color strip, M/S/L buttons,
// reorder handle, divider line. Lives on the global chromeGraphics layer
// (outside the timeline mask) so headers stay legible while clips slide.
import type { Container, Graphics } from "pixi.js";
import {
  getTracksTop,
  type PlaylistPresentation,
  type PlaylistTrackMeta,
  type PlaylistTrackRowPresentation,
} from "../../playlist-core";
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

export function createTrackMetaSource(
  get: (trackId: string) => PlaylistTrackMeta | null,
): TrackMetaSource {
  return { get, cache: new Map() };
}

const SUBTITLE_Y = 23;
const SUBTITLE_SIZE = 10;
const SUBTITLE_CHAR_PX = 5.6;
// Row heights below which the subtitle / meter would collide with the
// M/S/L button row (which sits at height - 22).
const SUBTITLE_MIN_ROW_HEIGHT = 58;
const METER_Y = 39;
const METER_HEIGHT = 3;
const METER_MIN_ROW_HEIGHT = 66;

function truncateSubtitle(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return "…";
  return `${text.slice(0, maxChars - 1)}…`;
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
    ? truncateSubtitle(
        meta.subtitle,
        Math.floor((headerWidth - 16 - 10) / SUBTITLE_CHAR_PX),
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
  if (subtitle.length > 0 && height >= SUBTITLE_MIN_ROW_HEIGHT) {
    addText(textLayer, subtitle, 16, top + SUBTITLE_Y, {
      color: COLORS.textMuted,
      size: SUBTITLE_SIZE,
      weight: muted ? "400" : "500",
    });
  }
  const meter = meta.meter;
  if (
    meter === undefined ||
    !Number.isFinite(meter) ||
    height < METER_MIN_ROW_HEIGHT
  ) {
    return;
  }
  const value = meter < -1 ? -1 : meter > 1 ? 1 : meter;
  const x0 = 16;
  const width = row.headerRect.width - x0 - 14;
  if (width <= 4) return;
  const half = width / 2;
  const center = x0 + half;
  const y = top + METER_Y;
  graphics
    .rect(x0, y, width, METER_HEIGHT)
    .fill({ color: COLORS.text, alpha: 0.08 });
  if (value > 0) {
    graphics
      .rect(center, y, half * value, METER_HEIGHT)
      .fill({ color: COLORS.tonePositive, alpha: muted ? 0.5 : 1 });
  } else if (value < 0) {
    graphics
      .rect(center + half * value, y, -half * value, METER_HEIGHT)
      .fill({ color: COLORS.toneDanger, alpha: muted ? 0.5 : 1 });
  }
  graphics
    .rect(center - 0.5, y - 1, 1, METER_HEIGHT + 2)
    .fill({ color: COLORS.textMuted, alpha: 0.6 });
}

interface ButtonRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function drawTrackHeaderButton(
  graphics: Graphics,
  textLayer: Container,
  rect: ButtonRect,
  letter: string,
  active: boolean,
  activeColor: number,
): void {
  graphics
    .roundRect(rect.x, rect.y, rect.width, rect.height, 3)
    .fill({
      color: active ? activeColor : COLORS.panelStrong,
      alpha: active ? 1 : 0.85,
    })
    .stroke({ color: COLORS.rowLine, width: 1, alpha: 0.7 });
  addText(textLayer, letter, rect.x + rect.width / 2 - 3.5, rect.y + 1, {
    color: active ? COLORS.text : COLORS.textMuted,
    size: 11,
    weight: "700",
  });
}

function drawReorderHandle(graphics: Graphics, rect: ButtonRect): void {
  for (let i = 0; i < 3; i += 1) {
    const y = rect.y + 4 + i * 4;
    graphics
      .moveTo(rect.x + 3, y)
      .lineTo(rect.x + rect.width - 3, y)
      .stroke({ color: COLORS.textMuted, width: 1, alpha: 0.7 });
  }
}

export function drawTrackRows(
  graphics: Graphics,
  textLayer: Container,
  presentation: PlaylistPresentation,
  metaSource: TrackMetaSource | null = null,
): void {
  const { metrics } = presentation;
  const tracksTop = getTracksTop(metrics);
  const viewportBottom = presentation.state.viewport.height;

  for (const row of presentation.trackRows) {
    const color = parseHexColor(row.track.color, COLORS.textMuted);
    const muted = row.track.muted === true;
    const soloed = row.track.soloed === true;
    const locked = row.track.locked === true;
    const headerAlpha = muted ? 0.55 : 1;

    graphics
      .rect(
        row.headerRect.x,
        row.headerRect.y,
        row.headerRect.width,
        row.headerRect.height,
      )
      .fill({
        color: row.index % 2 === 0 ? COLORS.panelHeaderA : COLORS.panelHeaderB,
      });
    graphics
      .rect(
        row.stripRect.x,
        row.stripRect.y,
        row.stripRect.width,
        row.stripRect.height,
      )
      .fill({ color, alpha: headerAlpha });
    graphics
      .moveTo(row.rowRect.x, row.rowRect.y + row.rowRect.height - 1)
      .lineTo(
        row.rowRect.x + row.rowRect.width,
        row.rowRect.y + row.rowRect.height - 1,
      )
      .stroke({ color: COLORS.rowLine, width: 1 });
    graphics
      .moveTo(metrics.trackHeaderWidth - 0.5, row.rowRect.y)
      .lineTo(
        metrics.trackHeaderWidth - 0.5,
        row.rowRect.y + row.rowRect.height,
      )
      .stroke({ color: COLORS.rowLine, width: 1.5 });

    addText(textLayer, row.track.label, 16, row.rowRect.y + 6, {
      color: muted ? COLORS.textMuted : COLORS.text,
      size: 13,
      weight: row.isVirtual ? "500" : "700",
    });

    drawTrackHeaderButton(
      graphics,
      textLayer,
      row.buttons.mute,
      "M",
      muted,
      COLORS.playPosition,
    );
    drawTrackHeaderButton(
      graphics,
      textLayer,
      row.buttons.solo,
      "S",
      soloed,
      COLORS.selected,
    );
    drawTrackHeaderButton(
      graphics,
      textLayer,
      row.buttons.lock,
      "L",
      locked,
      COLORS.hover,
    );
    drawReorderHandle(graphics, row.reorderHandleRect);

    if (row.hasSelectedClips) {
      graphics
        .rect(row.headerRect.x, row.headerRect.y, row.headerRect.width, 2)
        .fill({ color: COLORS.selected, alpha: 0.6 });
    }

    // Host header extras: only real rows actually on screen.
    if (
      metaSource !== null &&
      !row.isVirtual &&
      row.rowRect.y + row.rowRect.height > tracksTop &&
      row.rowRect.y < viewportBottom
    ) {
      const entry = resolveTrackMeta(
        metaSource,
        row.track.id,
        row.headerRect.width,
      );
      if (entry) {
        drawTrackMeta(
          graphics,
          textLayer,
          row,
          entry.meta,
          entry.subtitle,
          muted,
        );
      }
    }

    // F10: microtext "—" inside empty real tracks. Virtual rows already
    // read as "empty" by virtue of having no label weight; we only mark
    // materialised tracks with no clips so the user can tell a virtual
    // row apart from a real-but-empty one.
    if (!row.hasClips && !row.isVirtual) {
      addText(textLayer, "—", row.headerRect.x + row.headerRect.width - 24, row.rowRect.y + 6, {
        color: COLORS.textMuted,
        size: 10,
        weight: "500",
      });
    }
  }
}
