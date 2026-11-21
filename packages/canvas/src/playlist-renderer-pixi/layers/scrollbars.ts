// Scrollbars + the timeline navigator.
//
// The horizontal scrollbar is a NAVIGATOR: its track maps the whole
// addressable timeline and draws a miniature of the host's overview curve
// (e.g. the cash over the year); the thumb is the visible window, with zoom
// grips on its ends (drag an end to zoom, the middle to pan, the track to
// glide there, double-click to see everything), and a tick marks the
// playhead.
//
// Canon §3.10: the track + miniature live on their own Graphics, rebuilt
// only when their key changes (track geometry, zoom / extent, data
// reference, theme); the thumb, the playhead tick and the vertical bar are a
// few rects per frame on the foreground Graphics.
import type { Graphics } from "pixi.js";
import {
  SCROLLBAR_EDGE_MIN_THUMB,
  getHorizontalContentExtent,
  sortedUpperBound,
  type PlaylistOverviewData,
  type PlaylistPresentation,
  type PlaylistRect,
} from "../../playlist-core";
import { COLORS } from "../palette";

const THUMB_INSET = 3;
const MINI_PAD_Y = 4;

function drawThumb(graphics: Graphics, rect: PlaylistRect): void {
  const width = rect.width - THUMB_INSET * 2;
  const height = rect.height - THUMB_INSET * 2;
  if (width <= 0 || height <= 0) return;
  graphics
    .roundRect(
      rect.x + THUMB_INSET,
      rect.y + THUMB_INSET,
      width,
      height,
      Math.min(width, height) / 2,
    )
    .fill({ color: COLORS.scrollbarThumb });
}

export interface NavigatorLayer {
  /** Track + miniature (cached). Call once per frame; cheap when unchanged. */
  sync(presentation: PlaylistPresentation, data: PlaylistOverviewData | null): void;
  invalidate(): void;
  readonly stats: { rebuilds: number };
}

/**
 * The navigator's static part on its own Graphics (created by renderer
 * init). Rebuilt only on key change — scroll alone doesn't change it (the
 * track maps the whole extent), zoom does.
 */
export function createNavigatorLayer(graphics: Graphics): NavigatorLayer {
  const stats = { rebuilds: 0 };
  let key = "";
  let lastData: PlaylistOverviewData | null = null;

  return {
    stats,
    invalidate() {
      key = "";
    },
    sync(presentation, data) {
      const track = presentation.scrollbars.horizontal.trackRect;
      const state = presentation.state;
      const extent = getHorizontalContentExtent(state, presentation.metrics);
      const nextKey = `${track.x}|${track.y}|${track.width}|${track.height}|${Math.round(extent)}|${state.viewport.pxPerBeat}`;
      if (nextKey === key && data === lastData) return;
      key = nextKey;
      lastData = data;
      stats.rebuilds += 1;
      graphics.clear();
      if (track.width <= 0 || track.height <= 0) return;

      // Track: a quiet well; top hairline separates it from the tracks.
      graphics.rect(track.x, track.y, track.width, track.height).fill({ color: COLORS.scrollbarTrack });
      graphics
        .roundRect(
          track.x + 2,
          track.y + 2,
          Math.max(0, track.width - 4),
          Math.max(0, track.height - 4),
          Math.min(6, (track.height - 4) / 2),
        )
        .fill({ color: COLORS.gridMinor });
      graphics
        .moveTo(track.x, track.y + 0.5)
        .lineTo(track.x + track.width, track.y + 0.5)
        .stroke({ color: COLORS.rowLine, width: 1 });

      // Miniature of the overview curve across the whole extent.
      const series = data?.primary;
      if (!series || extent <= 0) return;
      const px = state.viewport.pxPerBeat;
      const beatsTotal = extent / px;
      const endBeat = Math.min(beatsTotal, data.endBeat ?? beatsTotal);
      const xOf = (beat: number): number => track.x + (beat / beatsTotal) * track.width;
      let min = series.initial;
      let max = series.initial;
      const values = series.values;
      const beats = series.beats;
      const count = Math.min(values.length, beats.length);
      const last = Math.min(count, sortedUpperBound(beats, endBeat));
      for (let i = 0; i < last; i += 1) {
        const v = values[i]!;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const top = track.y + MINI_PAD_Y;
      const bottom = track.y + track.height - MINI_PAD_Y;
      const span = max - min;
      const yOf = (value: number): number =>
        span > 0 ? bottom - ((value - min) / span) * (bottom - top) : (top + bottom) / 2;
      // Sample at most ~2 points per track pixel: never the whole series.
      const step = Math.max(1, Math.floor(last / Math.max(1, track.width * 2)));
      let y = yOf(series.initial);
      graphics.moveTo(xOf(0), y);
      for (let i = 0; i < last; i += step) {
        const x = xOf(beats[i]!);
        graphics.lineTo(x, y);
        y = yOf(values[i]!);
        graphics.lineTo(x, y);
      }
      graphics.lineTo(xOf(endBeat), y);
      graphics.stroke({ color: COLORS.overviewBaseline, width: 1, alpha: 0.85 });
      // Below zero, a faint warning band on the miniature.
      if (min < 0 && max > 0) {
        const zeroY = Math.round(yOf(0)) + 0.5;
        graphics
          .moveTo(track.x + 2, zeroY)
          .lineTo(track.x + track.width - 2, zeroY)
          .stroke({ color: COLORS.toneDanger, width: 1, alpha: 0.35 });
      }
    },
  };
}

export function drawScrollbars(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  const { horizontal, vertical } = presentation.scrollbars;
  const h = horizontal.trackRect;
  const v = vertical.trackRect;
  const state = presentation.state;

  // Navigator window: the visible range over the miniature.
  const thumb = horizontal.thumbRect;
  if (thumb.width > 0 && thumb.height > 0) {
    const x = thumb.x + 1;
    const y = thumb.y + 2;
    const w = Math.max(4, thumb.width - 2);
    const hh = Math.max(4, thumb.height - 4);
    graphics
      .roundRect(x, y, w, hh, Math.min(6, hh / 2))
      .fill({ color: COLORS.selected, alpha: 0.13 })
      .stroke({ color: COLORS.selected, width: 1.25, alpha: 0.6 });
    if (thumb.width >= SCROLLBAR_EDGE_MIN_THUMB) {
      const gripH = Math.max(4, hh - 8);
      const gripY = y + (hh - gripH) / 2;
      graphics.roundRect(x + 3, gripY, 2, gripH, 1).fill({ color: COLORS.selected, alpha: 0.85 });
      graphics.roundRect(x + w - 5, gripY, 2, gripH, 1).fill({ color: COLORS.selected, alpha: 0.85 });
    }
  }

  // Playhead tick on the navigator.
  const extent = getHorizontalContentExtent(state, presentation.metrics);
  if (extent > 0 && h.width > 0) {
    const playX =
      h.x + ((state.playPosition.time * state.viewport.pxPerBeat) / extent) * h.width;
    if (playX >= h.x && playX <= h.x + h.width) {
      graphics
        .rect(Math.round(playX), h.y + 2, 1.5, Math.max(0, h.height - 4))
        .fill({ color: COLORS.playPosition });
    }
  }

  graphics.rect(v.x, v.y, v.width, v.height).fill({ color: COLORS.scrollbarTrack });
  graphics
    .moveTo(v.x + 0.5, v.y)
    .lineTo(v.x + 0.5, v.y + v.height)
    .stroke({ color: COLORS.rowLine, width: 1 });
  drawThumb(graphics, vertical.thumbRect);

  const corner = presentation.layout.scrollbarCornerRect;
  graphics
    .rect(corner.x, corner.y, corner.width, corner.height)
    .fill({ color: COLORS.scrollbarTrack });
}
