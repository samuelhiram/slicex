import { Application, Container, Graphics, Text } from "pixi.js";
import {
  DEFAULT_PLAYLIST_METRICS,
  getAutomationPointPosition,
  getClipRect,
  isAutomationClip,
  normalizeRect,
  screenXToTime,
  timeToScreenX,
  trackIndexToScreenY,
} from "../playlist-core";
import type {
  PlaylistAutomationClip,
  PlaylistClip,
  PlaylistCore,
  PlaylistMetrics,
  PlaylistState,
} from "../playlist-core";

export interface PlaylistRendererCallbacks {
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

export interface PlaylistRenderer {
  destroy: () => void;
}

const COLORS = {
  background: 0x181818,
  panel: 0x222222,
  panelStrong: 0x2a2a2a,
  rowA: 0x1d1d1d,
  rowB: 0x202020,
  rowLine: 0x303030,
  gridMinor: 0x2d2d2d,
  gridMajor: 0x414141,
  text: 0xf1f1e8,
  textMuted: 0xb8b3a5,
  selected: 0xf4d35e,
  hover: 0xffffff,
  playhead: 0xf05d3b,
  marquee: 0x9ecbff,
  automationLine: 0x111111,
};

function parseHexColor(value: string, fallback: number): number {
  const normalized = value.trim();

  if (!normalized.startsWith("#")) {
    return fallback;
  }

  const hex = normalized.slice(1);

  if (hex.length !== 6) {
    return fallback;
  }

  const parsed = Number.parseInt(hex, 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function addText(
  layer: Container,
  text: string,
  x: number,
  y: number,
  options: { size?: number; color?: number; weight?: string } = {},
): void {
  const label = new Text({
    text,
    style: {
      fill: options.color ?? COLORS.text,
      fontFamily: "Segoe UI, Arial, sans-serif",
      fontSize: options.size ?? 12,
      fontWeight: (options.weight ?? "500") as any,
      letterSpacing: 0,
    },
  });

  label.eventMode = "none";
  label.x = Math.round(x);
  label.y = Math.round(y);
  layer.addChild(label);
}

function clearTextLayer(layer: Container): void {
  for (const child of layer.removeChildren()) {
    child.destroy();
  }
}

function pickGridStep(pxPerBeat: number): number {
  if (pxPerBeat >= 52) {
    return 0.25;
  }

  if (pxPerBeat >= 28) {
    return 0.5;
  }

  if (pxPerBeat >= 14) {
    return 1;
  }

  if (pxPerBeat >= 9) {
    return 2;
  }

  return 4;
}

function drawGridAndRuler(
  graphics: Graphics,
  textLayer: Container,
  state: PlaylistState,
  metrics: PlaylistMetrics,
): void {
  const { width, height, pxPerBeat } = state.viewport;

  graphics.rect(0, 0, width, height).fill({ color: COLORS.background });
  graphics
    .rect(0, 0, metrics.trackHeaderWidth, height)
    .fill({ color: COLORS.panel });
  graphics
    .rect(metrics.trackHeaderWidth, 0, width - metrics.trackHeaderWidth, metrics.rulerHeight)
    .fill({ color: COLORS.panelStrong });
  graphics
    .rect(0, 0, metrics.trackHeaderWidth, metrics.rulerHeight)
    .fill({ color: COLORS.panel });

  graphics
    .moveTo(0, metrics.rulerHeight - 1)
    .lineTo(width, metrics.rulerHeight - 1)
    .stroke({ color: COLORS.rowLine, width: 1 });
  graphics
    .moveTo(metrics.trackHeaderWidth - 1, 0)
    .lineTo(metrics.trackHeaderWidth - 1, height)
    .stroke({ color: COLORS.rowLine, width: 1 });

  const step = pickGridStep(pxPerBeat);
  const startBeat = Math.floor(screenXToTime(state, metrics.trackHeaderWidth, metrics) / step) * step;
  const endBeat = screenXToTime(state, width, metrics) + step;

  for (let beat = startBeat; beat <= endBeat; beat += step) {
    const x = Math.round(timeToScreenX(state, beat, metrics)) + 0.5;
    const isBar = Math.abs(beat % metrics.beatsPerBar) < 0.001;

    if (x < metrics.trackHeaderWidth) {
      continue;
    }

    graphics
      .moveTo(x, metrics.rulerHeight)
      .lineTo(x, height)
      .stroke({
        alpha: isBar ? 0.95 : 0.55,
        color: isBar ? COLORS.gridMajor : COLORS.gridMinor,
        width: isBar ? 1.25 : 1,
      });

    graphics
      .moveTo(x, metrics.rulerHeight - (isBar ? 15 : 8))
      .lineTo(x, metrics.rulerHeight)
      .stroke({
        color: isBar ? COLORS.textMuted : COLORS.gridMajor,
        width: 1,
      });

    if (isBar) {
      addText(
        textLayer,
        String(Math.floor(beat / metrics.beatsPerBar) + 1),
        x + 5,
        10,
        { color: COLORS.textMuted, size: 11, weight: "600" },
      );
    }
  }
}

function drawTracks(
  graphics: Graphics,
  textLayer: Container,
  state: PlaylistState,
  metrics: PlaylistMetrics,
): void {
  const startIndex = Math.max(
    0,
    Math.floor(state.viewport.scrollY / metrics.trackHeight),
  );
  const endIndex = Math.min(
    state.tracks.length - 1,
    Math.ceil(
      (state.viewport.scrollY + state.viewport.height - metrics.rulerHeight) /
        metrics.trackHeight,
    ),
  );

  for (let index = startIndex; index <= endIndex; index += 1) {
    const track = state.tracks[index];
    const y = trackIndexToScreenY(state, index, metrics);
    const color = parseHexColor(track.color, COLORS.textMuted);
    const rowColor = index % 2 === 0 ? COLORS.rowA : COLORS.rowB;

    graphics
      .rect(0, y, state.viewport.width, metrics.trackHeight)
      .fill({ color: rowColor });
    graphics.rect(0, y, 5, metrics.trackHeight).fill({ color });
    graphics
      .moveTo(0, y + metrics.trackHeight - 1)
      .lineTo(state.viewport.width, y + metrics.trackHeight - 1)
      .stroke({ color: COLORS.rowLine, width: 1 });

    addText(textLayer, track.label, 16, y + 13, {
      color: COLORS.text,
      size: 13,
      weight: "700",
    });
    addText(textLayer, `Track ${index + 1}`, 16, y + 34, {
      color: COLORS.textMuted,
      size: 11,
    });
  }
}

function drawTimelineGridOverlay(
  graphics: Graphics,
  state: PlaylistState,
  metrics: PlaylistMetrics,
): void {
  const step = pickGridStep(state.viewport.pxPerBeat);
  const startBeat =
    Math.floor(screenXToTime(state, metrics.trackHeaderWidth, metrics) / step) *
    step;
  const endBeat = screenXToTime(state, state.viewport.width, metrics) + step;

  for (let beat = startBeat; beat <= endBeat; beat += step) {
    const x = Math.round(timeToScreenX(state, beat, metrics)) + 0.5;
    const isBar = Math.abs(beat % metrics.beatsPerBar) < 0.001;

    if (x < metrics.trackHeaderWidth) {
      continue;
    }

    graphics
      .moveTo(x, metrics.rulerHeight)
      .lineTo(x, state.viewport.height)
      .stroke({
        alpha: isBar ? 0.72 : 0.42,
        color: isBar ? COLORS.gridMajor : COLORS.gridMinor,
        width: isBar ? 1.25 : 1,
      });
  }
}

function drawClipLabel(
  textLayer: Container,
  clip: PlaylistClip,
  rect: ReturnType<typeof getClipRect>,
): void {
  if (rect.width < 44 || rect.height < 24) {
    return;
  }

  addText(textLayer, clip.label, rect.x + 12, rect.y + 4, {
    color: COLORS.text,
    size: 12,
    weight: "700",
  });
}

function drawAutomation(
  graphics: Graphics,
  state: PlaylistState,
  clip: PlaylistAutomationClip,
  metrics: PlaylistMetrics,
): void {
  const sortedPoints = [...clip.points].sort((left, right) => left.time - right.time);

  if (sortedPoints.length === 0) {
    return;
  }

  const first = getAutomationPointPosition(state, clip, sortedPoints[0], metrics);
  graphics.moveTo(first.x, first.y);

  for (const point of sortedPoints.slice(1)) {
    const position = getAutomationPointPosition(state, clip, point, metrics);
    graphics.lineTo(position.x, position.y);
  }

  graphics.stroke({ color: COLORS.automationLine, width: 4, alpha: 0.55 });
  graphics.moveTo(first.x, first.y);

  for (const point of sortedPoints.slice(1)) {
    const position = getAutomationPointPosition(state, clip, point, metrics);
    graphics.lineTo(position.x, position.y);
  }

  graphics.stroke({ color: COLORS.text, width: 2, alpha: 0.9 });

  for (const point of sortedPoints) {
    const position = getAutomationPointPosition(state, clip, point, metrics);
    const selected = state.selection.automationPointIds.includes(point.id);

    graphics
      .circle(position.x, position.y, selected ? 6.5 : 5)
      .fill({ color: selected ? COLORS.selected : COLORS.panelStrong })
      .stroke({ color: COLORS.text, width: 1.5 });
  }
}

function drawClip(
  graphics: Graphics,
  textLayer: Container,
  state: PlaylistState,
  clip: PlaylistClip,
  metrics: PlaylistMetrics,
): void {
  const rect = getClipRect(state, clip, metrics);

  if (
    rect.x + rect.width < metrics.trackHeaderWidth ||
    rect.x > state.viewport.width ||
    rect.y + rect.height < metrics.rulerHeight ||
    rect.y > state.viewport.height
  ) {
    return;
  }

  const color = parseHexColor(clip.color, 0x777777);
  const selected = state.selection.clipIds.includes(clip.id);
  const hovered =
    state.hover != null &&
    state.hover.kind !== "automation-point" &&
    "clipId" in state.hover &&
    state.hover.clipId === clip.id;
  const handleHeight =
    clip.type === "automation" ? metrics.clipTitleHeight : rect.height;

  graphics
    .roundRect(rect.x, rect.y, rect.width, rect.height, 4)
    .fill({ color, alpha: clip.type === "automation" ? 0.82 : 0.9 })
    .stroke({
      color: selected ? COLORS.selected : hovered ? COLORS.hover : COLORS.rowLine,
      width: selected ? 2 : 1,
      alpha: hovered || selected ? 1 : 0.8,
    });
  graphics
    .rect(rect.x, rect.y, rect.width, metrics.clipTitleHeight)
    .fill({ color: COLORS.panel, alpha: 0.34 });

  graphics
    .rect(rect.x, rect.y, metrics.resizeHandleWidth, handleHeight)
    .fill({ color: COLORS.text, alpha: 0.2 });
  graphics
    .rect(
      rect.x + rect.width - metrics.resizeHandleWidth,
      rect.y,
      metrics.resizeHandleWidth,
      handleHeight,
    )
    .fill({ color: COLORS.text, alpha: 0.2 });

  drawClipLabel(textLayer, clip, rect);

  if (isAutomationClip(clip)) {
    drawAutomation(graphics, state, clip, metrics);
  }
}

function drawOverlay(
  graphics: Graphics,
  state: PlaylistState,
  metrics: PlaylistMetrics,
): void {
  const playheadX = timeToScreenX(state, state.playhead, metrics);

  if (
    playheadX >= metrics.trackHeaderWidth &&
    playheadX <= state.viewport.width
  ) {
    graphics
      .moveTo(playheadX + 0.5, 0)
      .lineTo(playheadX + 0.5, state.viewport.height)
      .stroke({ color: COLORS.playhead, width: 2 });
  }

  if (state.marquee) {
    const rect = normalizeRect({
      x: state.marquee.start.x,
      y: state.marquee.start.y,
      width: state.marquee.current.x - state.marquee.start.x,
      height: state.marquee.current.y - state.marquee.start.y,
    });

    graphics
      .rect(rect.x, rect.y, rect.width, rect.height)
      .fill({ color: COLORS.marquee, alpha: 0.13 })
      .stroke({ color: COLORS.marquee, width: 1.5, alpha: 0.75 });
  }
}

function drawPlaylist(
  graphics: Graphics,
  textLayer: Container,
  state: PlaylistState,
  metrics: PlaylistMetrics,
): void {
  graphics.clear();
  clearTextLayer(textLayer);

  drawGridAndRuler(graphics, textLayer, state, metrics);
  drawTracks(graphics, textLayer, state, metrics);
  drawTimelineGridOverlay(graphics, state, metrics);

  for (const clip of state.clips) {
    drawClip(graphics, textLayer, state, clip, metrics);
  }

  drawOverlay(graphics, state, metrics);
  addText(textLayer, "SliceX Playlist", 15, 11, {
    color: COLORS.text,
    size: 13,
    weight: "700",
  });
}

export function createPlaylistRenderer(
  container: HTMLElement,
  core: PlaylistCore,
  callbacks: PlaylistRendererCallbacks = {},
): PlaylistRenderer {
  const metrics = core.metrics ?? DEFAULT_PLAYLIST_METRICS;
  const app = new Application();
  const root = new Container();
  const graphics = new Graphics();
  const textLayer = new Container();
  let destroyed = false;
  let ready = false;

  root.eventMode = "none";
  root.addChild(graphics, textLayer);

  const renderNow = (): void => {
    if (!ready || destroyed) {
      return;
    }

    drawPlaylist(graphics, textLayer, core.getState(), metrics);
    (app as any).render?.();
  };

  const resize = (): void => {
    if (!ready || destroyed) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const viewport = core.getState().viewport;

    app.renderer.resize(width, height);

    if (viewport.width !== width || viewport.height !== height) {
      core.setViewportSize(width, height);
      return;
    }

    renderNow();
  };

  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(resize)
      : null;
  const subscription = core.subscribe(renderNow);

  void app
    .init({
      antialias: true,
      autoDensity: true,
      backgroundColor: COLORS.background,
      resolution:
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    })
    .then(() => {
      if (destroyed) {
        app.destroy(true);
        return;
      }

      const canvas = (app as any).canvas as HTMLCanvasElement;
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      container.appendChild(canvas);
      app.stage.addChild(root);
      ready = true;
      resizeObserver?.observe(container);
      resize();
      callbacks.onReady?.();
    })
    .catch((error: unknown) => {
      callbacks.onError?.(error);
    });

  return {
    destroy() {
      destroyed = true;
      subscription.unsubscribe();
      resizeObserver?.disconnect();
      clearTextLayer(textLayer);

      try {
        app.stage.removeChild(root);
      } catch {
        // noop
      }

      try {
        app.destroy(true);
      } catch {
        // noop
      }
    },
  };
}
