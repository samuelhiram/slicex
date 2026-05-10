import { Application, Container, Graphics, Text } from "pixi.js";
import {
  type PlaylistClipPresentation,
  type PlaylistCore,
  type PlaylistPresentation,
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
  panelHeaderA: 0x272727,
  panelHeaderB: 0x242424,
  panelMenu: 0x202020,
  rowA: 0x1d1d1d,
  rowB: 0x202020,
  rowLine: 0x303030,
  gridMinor: 0x2d2d2d,
  gridMajor: 0x414141,
  text: 0xf1f1e8,
  textMuted: 0xb8b3a5,
  selected: 0xf4d35e,
  hover: 0xffffff,
  playPosition: 0xf05d3b,
  marquee: 0x9ecbff,
  automationLine: 0x111111,
  disabled: 0x6f6f6f,
  scrollbarTrack: 0x151515,
  scrollbarThumb: 0x5f5f5f,
};

const CLIP_BODY_ALPHA = 1;
const CLIP_BODY_ALPHA_MUTED = 0.28;
const CLIP_TITLE_ALPHA = 0.34;
const CLIP_RESIZE_ALPHA = 0.2;

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

function drawSceneBackground(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  graphics
    .rect(
      presentation.layout.sceneRect.x,
      presentation.layout.sceneRect.y,
      presentation.layout.sceneRect.width,
      presentation.layout.sceneRect.height,
    )
    .fill({ color: COLORS.background });
}

function drawRulerChrome(
  graphics: Graphics,
  textLayer: Container,
  presentation: PlaylistPresentation,
): void {
  const { layout, metrics } = presentation;

  graphics
    .rect(
      layout.trackHeaderRect.x,
      layout.trackHeaderRect.y,
      layout.trackHeaderRect.width,
      layout.trackHeaderRect.height,
    )
    .fill({ color: COLORS.panel });
  graphics
    .rect(
      layout.rulerRect.x,
      layout.rulerRect.y,
      layout.rulerRect.width,
      layout.rulerRect.height,
    )
    .fill({ color: COLORS.panelStrong });
  graphics
    .rect(0, 0, layout.trackHeaderRect.width, layout.rulerRect.height)
    .fill({ color: COLORS.panel });

  graphics
    .moveTo(0, metrics.rulerHeight - 1)
    .lineTo(layout.sceneRect.width, metrics.rulerHeight - 1)
    .stroke({ color: COLORS.rowLine, width: 1 });
  graphics
    .moveTo(metrics.trackHeaderWidth - 1, 0)
    .lineTo(metrics.trackHeaderWidth - 1, layout.sceneRect.height)
    .stroke({ color: COLORS.rowLine, width: 1 });

  for (const tick of presentation.rulerTicks) {
    graphics
      .moveTo(tick.x, metrics.rulerHeight - (tick.isBar ? 15 : 8))
      .lineTo(tick.x, metrics.rulerHeight)
      .stroke({
        color: tick.isBar ? COLORS.textMuted : COLORS.gridMajor,
        width: 1,
      });

    if (tick.isBar && tick.label) {
      addText(textLayer, tick.label, tick.x + 5, 10, {
        color: COLORS.textMuted,
        size: 11,
        weight: "600",
      });
    }
  }

  addText(textLayer, "SliceX Playlist", 15, 11, {
    color: COLORS.text,
    size: 13,
    weight: "700",
  });
}

function drawTrackRowsBackground(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  for (const row of presentation.trackRows) {
    const rowColor = row.index % 2 === 0 ? COLORS.rowA : COLORS.rowB;

    graphics
      .rect(row.rowRect.x, row.rowRect.y, row.rowRect.width, row.rowRect.height)
      .fill({ color: rowColor });
  }
}

function drawTimelineGrid(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  const { metrics, rulerTicks, layout } = presentation;

  for (const tick of rulerTicks) {
    graphics
      .moveTo(tick.x, metrics.rulerHeight)
      .lineTo(tick.x, layout.sceneRect.height)
      .stroke({
        alpha: tick.isBar ? 0.72 : 0.42,
        color: tick.isBar ? COLORS.gridMajor : COLORS.gridMinor,
        width: tick.isBar ? 1.25 : 1,
      });
  }
}

function drawTrackHeaderButton(
  graphics: Graphics,
  textLayer: Container,
  rect: { x: number; y: number; width: number; height: number },
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

function drawReorderHandle(
  graphics: Graphics,
  rect: { x: number; y: number; width: number; height: number },
): void {
  for (let i = 0; i < 3; i += 1) {
    const y = rect.y + 4 + i * 4;
    graphics
      .moveTo(rect.x + 3, y)
      .lineTo(rect.x + rect.width - 3, y)
      .stroke({ color: COLORS.textMuted, width: 1, alpha: 0.7 });
  }
}

function drawTrackRows(
  graphics: Graphics,
  textLayer: Container,
  presentation: PlaylistPresentation,
): void {
  const { metrics } = presentation;

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
  }
}

function drawPlayPositionRulerMarker(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  const { metrics, playPosition } = presentation;

  if (!playPosition.isVisible) {
    return;
  }

  graphics
    .roundRect(playPosition.x - 7, 3, 14, metrics.rulerHeight - 6, 3)
    .fill({ color: COLORS.playPosition })
    .stroke({ color: COLORS.text, width: 1, alpha: 0.8 });
  graphics
    .moveTo(playPosition.x - 7, metrics.rulerHeight - 1)
    .lineTo(playPosition.x + 7, metrics.rulerHeight - 1)
    .lineTo(playPosition.x, metrics.rulerHeight + 7)
    .lineTo(playPosition.x - 7, metrics.rulerHeight - 1)
    .fill({ color: COLORS.playPosition });
}

function drawAutomation(
  graphics: Graphics,
  clipView: PlaylistClipPresentation,
): void {
  if (clipView.automationPoints.length === 0) {
    return;
  }

  const sortedPoints = clipView.automationPoints;
  const first = sortedPoints[0];
  graphics.moveTo(first.position.x, first.position.y);

  for (const point of sortedPoints.slice(1)) {
    graphics.lineTo(point.position.x, point.position.y);
  }

  graphics.stroke({ color: COLORS.automationLine, width: 4, alpha: 0.55 });
  graphics.moveTo(first.position.x, first.position.y);

  for (const point of sortedPoints.slice(1)) {
    graphics.lineTo(point.position.x, point.position.y);
  }

  graphics.stroke({ color: COLORS.text, width: 2, alpha: 0.9 });

  for (const point of sortedPoints) {
    graphics
      .circle(point.position.x, point.position.y, point.selected ? 6.5 : 5)
      .fill({ color: point.selected ? COLORS.selected : COLORS.panelStrong })
      .stroke({ color: COLORS.text, width: 1.5 });
  }
}

function drawClipLabel(
  textLayer: Container,
  clipView: PlaylistClipPresentation,
): void {
  if (clipView.rect.width < 44 || clipView.rect.height < 24) {
    return;
  }

  addText(
    textLayer,
    clipView.clip.label,
    clipView.rect.x + 12,
    clipView.rect.y + 4,
    {
      color: COLORS.text,
      size: 12,
      weight: "700",
    },
  );

  const ratio = clipView.clip.stretchRatio ?? 1;
  const offset = clipView.clip.contentOffset ?? 0;
  const tagY = clipView.rect.y + 4;

  if (Math.abs(ratio - 1) > 0.001 && clipView.rect.width >= 60) {
    const tagText = `×${ratio.toFixed(2).replace(/\.?0+$/, "")}`;
    addText(
      textLayer,
      tagText,
      clipView.rect.x + clipView.rect.width - 8 - tagText.length * 6,
      tagY,
      { color: COLORS.text, size: 10, weight: "700" },
    );
  }

  if (Math.abs(offset) > 0.001 && clipView.rect.width >= 80) {
    addText(
      textLayer,
      `↻${offset.toFixed(2).replace(/\.?0+$/, "")}`,
      clipView.rect.x + 12,
      tagY + 14,
      { color: COLORS.textMuted, size: 10, weight: "600" },
    );
  }
}

function drawClipBody(
  graphics: Graphics,
  clipView: PlaylistClipPresentation,
): void {
  const color = parseHexColor(clipView.clip.color, 0x777777);
  const muted = clipView.effectivelyMuted;
  const bodyAlpha = muted ? CLIP_BODY_ALPHA_MUTED : CLIP_BODY_ALPHA;

  graphics
    .roundRect(
      clipView.rect.x,
      clipView.rect.y,
      clipView.rect.width,
      clipView.rect.height,
      4,
    )
    .fill({ color, alpha: bodyAlpha });
  graphics
    .rect(
      clipView.titleRect.x,
      clipView.titleRect.y,
      clipView.titleRect.width,
      clipView.titleRect.height,
    )
    .fill({
      color: COLORS.panel,
      alpha: muted ? CLIP_TITLE_ALPHA * 0.6 : CLIP_TITLE_ALPHA,
    });

  if (muted) {
    // Diagonal-stripe overlay so the muted state is unambiguous even on
    // colour-blind / low-contrast displays.
    const step = 8;
    const startOffset = clipView.rect.x - clipView.rect.height;
    const totalWidth = clipView.rect.width + clipView.rect.height;
    for (let offset = 0; offset <= totalWidth; offset += step) {
      const x1 = startOffset + offset;
      const y1 = clipView.rect.y;
      const x2 = x1 + clipView.rect.height;
      const y2 = clipView.rect.y + clipView.rect.height;
      const clampedX1 = Math.max(clipView.rect.x, x1);
      const clampedX2 = Math.min(
        clipView.rect.x + clipView.rect.width,
        x2,
      );
      if (clampedX1 >= clampedX2) {
        continue;
      }
      graphics
        .moveTo(clampedX1, y1 + (clampedX1 - x1))
        .lineTo(clampedX2, y1 + (clampedX2 - x1))
        .stroke({ color: COLORS.text, alpha: 0.18, width: 1 });
    }
  }
}

function drawClipOverlay(
  graphics: Graphics,
  clipView: PlaylistClipPresentation,
): void {
  graphics
    .roundRect(
      clipView.rect.x,
      clipView.rect.y,
      clipView.rect.width,
      clipView.rect.height,
      4,
    )
    .stroke({
      color: clipView.selected
        ? COLORS.selected
        : clipView.hovered
          ? COLORS.hover
          : COLORS.rowLine,
      width: clipView.selected ? 2 : 1,
      alpha: clipView.hovered || clipView.selected ? 1 : 0.8,
    });

  graphics
    .rect(
      clipView.resizeLeftRect.x,
      clipView.resizeLeftRect.y,
      clipView.resizeLeftRect.width,
      clipView.resizeLeftRect.height,
    )
    .fill({ color: COLORS.text, alpha: CLIP_RESIZE_ALPHA });
  graphics
    .rect(
      clipView.resizeRightRect.x,
      clipView.resizeRightRect.y,
      clipView.resizeRightRect.width,
      clipView.resizeRightRect.height,
    )
    .fill({ color: COLORS.text, alpha: CLIP_RESIZE_ALPHA });

  if (clipView.isAutomation) {
    drawAutomation(graphics, clipView);
  }
}

function drawClip(
  clipGraphics: Graphics,
  clipTextLayer: Container,
  overlayGraphics: Graphics,
  clipView: PlaylistClipPresentation,
): void {
  drawClipBody(clipGraphics, clipView);
  drawClipLabel(clipTextLayer, clipView);
  drawClipOverlay(overlayGraphics, clipView);
}

function drawClips(
  clipGraphics: Graphics,
  clipTextLayer: Container,
  overlayGraphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  for (const clipView of presentation.visibleClipViews) {
    drawClip(clipGraphics, clipTextLayer, overlayGraphics, clipView);
  }
}

function drawScrollbars(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  const { horizontal, vertical } = presentation.scrollbars;

  graphics
    .rect(
      horizontal.trackRect.x,
      horizontal.trackRect.y,
      horizontal.trackRect.width,
      horizontal.trackRect.height,
    )
    .fill({ color: COLORS.scrollbarTrack, alpha: 0.96 })
    .stroke({ color: COLORS.rowLine, width: 1 });
  graphics
    .roundRect(
      horizontal.thumbRect.x,
      horizontal.thumbRect.y,
      horizontal.thumbRect.width,
      horizontal.thumbRect.height,
      4,
    )
    .fill({ color: COLORS.scrollbarThumb });

  graphics
    .rect(
      vertical.trackRect.x,
      vertical.trackRect.y,
      vertical.trackRect.width,
      vertical.trackRect.height,
    )
    .fill({ color: COLORS.scrollbarTrack, alpha: 0.96 })
    .stroke({ color: COLORS.rowLine, width: 1 });
  graphics
    .roundRect(
      vertical.thumbRect.x,
      vertical.thumbRect.y,
      vertical.thumbRect.width,
      vertical.thumbRect.height,
      4,
    )
    .fill({ color: COLORS.scrollbarThumb });

  graphics
    .rect(
      presentation.layout.scrollbarCornerRect.x,
      presentation.layout.scrollbarCornerRect.y,
      presentation.layout.scrollbarCornerRect.width,
      presentation.layout.scrollbarCornerRect.height,
    )
    .fill({ color: COLORS.panelStrong });
}

function drawTimelineOverlay(
  graphics: Graphics,
  presentation: PlaylistPresentation,
): void {
  const { metrics, playPosition, marquee, layout } = presentation;

  if (playPosition.isVisible) {
    graphics
      .roundRect(playPosition.x - 7, 3, 14, metrics.rulerHeight - 6, 3)
      .fill({ color: COLORS.playPosition })
      .stroke({ color: COLORS.text, width: 1, alpha: 0.8 });
    graphics
      .moveTo(playPosition.x - 7, metrics.rulerHeight - 1)
      .lineTo(playPosition.x + 7, metrics.rulerHeight - 1)
      .lineTo(playPosition.x, metrics.rulerHeight + 7)
      .lineTo(playPosition.x - 7, metrics.rulerHeight - 1)
      .fill({ color: COLORS.playPosition });
    graphics
      .moveTo(playPosition.x + 0.5, 0)
      .lineTo(playPosition.x + 0.5, layout.sceneRect.height)
      .stroke({ color: COLORS.playPosition, width: 2 });
  }

  if (marquee) {
    graphics
      .rect(
        marquee.rect.x,
        marquee.rect.y,
        marquee.rect.width,
        marquee.rect.height,
      )
      .fill({ color: COLORS.marquee, alpha: 0.13 })
      .stroke({ color: COLORS.marquee, width: 1.5, alpha: 0.75 });
  }
}

export function createPlaylistRenderer(
  container: HTMLElement,
  core: PlaylistCore,
  callbacks: PlaylistRendererCallbacks = {},
): PlaylistRenderer {
  const app = new Application();
  const root = new Container();
  const sceneGraphics = new Graphics();
  const timelineMask = new Graphics();
  const timelineContainer = new Container();
  const timelineGridGraphics = new Graphics();
  const clipGraphics = new Graphics();
  const clipTextLayer = new Container();
  const overlayGraphics = new Graphics();
  const chromeGraphics = new Graphics();
  const chromeTextLayer = new Container();
  const foregroundGraphics = new Graphics();
  const foregroundTextLayer = new Container();
  let destroyed = false;
  let ready = false;

  root.eventMode = "none";
  timelineContainer.mask = timelineMask;
  timelineContainer.addChild(
    timelineGridGraphics,
    clipGraphics,
    clipTextLayer,
    overlayGraphics,
  );
  root.addChild(
    sceneGraphics,
    timelineMask,
    timelineContainer,
    chromeGraphics,
    chromeTextLayer,
    foregroundGraphics,
    foregroundTextLayer,
  );

  const renderNow = (): void => {
    if (!ready || destroyed) {
      return;
    }

    const presentation = core.getPresentation();

    sceneGraphics.clear();
    timelineMask.clear();
    timelineGridGraphics.clear();
    clipGraphics.clear();
    clearTextLayer(clipTextLayer);
    overlayGraphics.clear();
    chromeGraphics.clear();
    clearTextLayer(chromeTextLayer);
    foregroundGraphics.clear();
    clearTextLayer(foregroundTextLayer);

    drawSceneBackground(sceneGraphics, presentation);
    drawTrackRowsBackground(sceneGraphics, presentation);

    timelineMask
      .rect(
        presentation.layout.timelineRect.x,
        presentation.layout.timelineRect.y,
        presentation.layout.timelineRect.width,
        presentation.layout.timelineRect.height,
      )
      .fill({ color: 0xffffff });

    drawTimelineGrid(timelineGridGraphics, presentation);
    drawClips(clipGraphics, clipTextLayer, overlayGraphics, presentation);
    drawTimelineOverlay(overlayGraphics, presentation);

    drawRulerChrome(chromeGraphics, chromeTextLayer, presentation);
    drawTrackRows(chromeGraphics, chromeTextLayer, presentation);
    drawPlayPositionRulerMarker(chromeGraphics, presentation);

    drawScrollbars(foregroundGraphics, presentation);

    (app as any).render?.();
  };

  const resize = (): void => {
    if (!ready || destroyed) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const viewport = core.getPresentation().state.viewport;
    const sizeChanged =
      viewport.width !== width || viewport.height !== height;

    app.renderer.resize(width, height);

    if (sizeChanged) {
      // setViewportSize dispatches + notifies, which re-enters renderNow
      // via the subscribe callback. No need to also call it directly.
      core.setViewportSize(width, height);
      return;
    }

    // Size unchanged: nothing dispatches, so subscribe won't fire. Render
    // explicitly so the first frame after init isn't skipped when the
    // container already matches the model's initial viewport (1×1 from
    // the demo when getBoundingClientRect briefly reports 0×0 during a
    // StrictMode remount).
    renderNow();
  };

  const resizeObserver =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
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
      // Catch a layout that wasn't ready during the initial resize call
      // (StrictMode double-mount can land the .then() before the browser
      // has paint-resolved the container's real size). One follow-up tick
      // is enough — if the size has stabilized by then, the call is a
      // cheap no-op via setViewportSize idempotency.
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(() => {
          if (!destroyed) resize();
        });
      }
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
      sceneGraphics.clear();
      timelineMask.clear();
      timelineGridGraphics.clear();
      clipGraphics.clear();
      clearTextLayer(clipTextLayer);
      overlayGraphics.clear();
      chromeGraphics.clear();
      clearTextLayer(chromeTextLayer);
      foregroundGraphics.clear();
      clearTextLayer(foregroundTextLayer);

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
