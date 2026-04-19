import { Application, Container, Graphics, Text } from "pixi.js";
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
function parseHexColor(value, fallback) {
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
function addText(layer, text, x, y, options = {}) {
  const label = new Text({
    text,
    style: {
      fill: options.color ?? COLORS.text,
      fontFamily: "Segoe UI, Arial, sans-serif",
      fontSize: options.size ?? 12,
      fontWeight: options.weight ?? "500",
      letterSpacing: 0,
    },
  });
  label.eventMode = "none";
  label.x = Math.round(x);
  label.y = Math.round(y);
  layer.addChild(label);
}
function clearTextLayer(layer) {
  for (const child of layer.removeChildren()) {
    child.destroy();
  }
}
function drawGridAndRuler(graphics, textLayer, presentation) {
  const { layout, metrics } = presentation;
  graphics
    .rect(
      layout.sceneRect.x,
      layout.sceneRect.y,
      layout.sceneRect.width,
      layout.sceneRect.height,
    )
    .fill({ color: COLORS.background });
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
      .moveTo(tick.x, metrics.rulerHeight)
      .lineTo(tick.x, layout.sceneRect.height)
      .stroke({
        alpha: tick.isBar ? 0.95 : 0.55,
        color: tick.isBar ? COLORS.gridMajor : COLORS.gridMinor,
        width: tick.isBar ? 1.25 : 1,
      });
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
}
function drawTimelineGridOverlay(graphics, presentation) {
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
function drawTrackRows(graphics, textLayer, presentation) {
  const { metrics } = presentation;
  for (const row of presentation.trackRows) {
    const color = parseHexColor(row.track.color, COLORS.textMuted);
    const rowColor = row.index % 2 === 0 ? COLORS.rowA : COLORS.rowB;
    graphics
      .rect(row.rowRect.x, row.rowRect.y, row.rowRect.width, row.rowRect.height)
      .fill({ color: rowColor });
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
      .fill({ color });
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
    addText(textLayer, row.track.label, 16, row.rowRect.y + 13, {
      color: COLORS.text,
      size: 13,
      weight: row.isVirtual ? "500" : "700",
    });
    addText(
      textLayer,
      row.isVirtual ? "Empty" : `Track ${row.index + 1}`,
      16,
      row.rowRect.y + 34,
      {
        color: COLORS.textMuted,
        size: 11,
      },
    );
    if (row.hasSelectedClips) {
      graphics
        .rect(row.headerRect.x, row.headerRect.y, row.headerRect.width, 2)
        .fill({ color: COLORS.selected, alpha: 0.6 });
    }
  }
}
function drawAutomation(graphics, clipView) {
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
function drawClipLabel(textLayer, clipView) {
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
}
function drawClip(graphics, textLayer, clipView) {
  const color = parseHexColor(clipView.clip.color, 0x777777);
  graphics
    .roundRect(
      clipView.rect.x,
      clipView.rect.y,
      clipView.rect.width,
      clipView.rect.height,
      4,
    )
    .fill({ color, alpha: clipView.isAutomation ? 0.82 : 0.9 })
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
      clipView.titleRect.x,
      clipView.titleRect.y,
      clipView.titleRect.width,
      clipView.titleRect.height,
    )
    .fill({ color: COLORS.panel, alpha: 0.34 });
  graphics
    .rect(
      clipView.resizeLeftRect.x,
      clipView.resizeLeftRect.y,
      clipView.resizeLeftRect.width,
      clipView.resizeLeftRect.height,
    )
    .fill({ color: COLORS.text, alpha: 0.2 });
  graphics
    .rect(
      clipView.resizeRightRect.x,
      clipView.resizeRightRect.y,
      clipView.resizeRightRect.width,
      clipView.resizeRightRect.height,
    )
    .fill({ color: COLORS.text, alpha: 0.2 });
  drawClipLabel(textLayer, clipView);
  if (clipView.isAutomation) {
    drawAutomation(graphics, clipView);
  }
}
function drawClips(graphics, textLayer, presentation) {
  for (const clipView of presentation.visibleClipViews) {
    drawClip(graphics, textLayer, clipView);
  }
}
function drawContextMenu(graphics, textLayer, presentation) {
  if (!presentation.contextMenu) {
    return;
  }
  const { rect, items } = presentation.contextMenu;
  graphics
    .roundRect(rect.x, rect.y, rect.width, rect.height, 4)
    .fill({ color: COLORS.panelMenu, alpha: 0.98 })
    .stroke({ color: COLORS.rowLine, width: 1 });
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (index % 2 === 0) {
      graphics
        .rect(item.rect.x, item.rect.y, item.rect.width, item.rect.height)
        .fill({ color: 0x252525, alpha: 0.72 });
    }
    addText(textLayer, item.label, item.rect.x + 8, item.rect.y + 7, {
      color: item.disabled ? COLORS.disabled : COLORS.text,
      size: 12,
      weight: index <= 1 ? "700" : "500",
    });
  }
}
function drawScrollbars(graphics, presentation) {
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
function drawOverlay(graphics, presentation) {
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
function drawPlaylist(graphics, textLayer, presentation) {
  graphics.clear();
  clearTextLayer(textLayer);
  drawGridAndRuler(graphics, textLayer, presentation);
  drawTrackRows(graphics, textLayer, presentation);
  drawTimelineGridOverlay(graphics, presentation);
  drawClips(graphics, textLayer, presentation);
  drawOverlay(graphics, presentation);
  drawScrollbars(graphics, presentation);
  drawContextMenu(graphics, textLayer, presentation);
  addText(textLayer, "SliceX Playlist", 15, 11, {
    color: COLORS.text,
    size: 13,
    weight: "700",
  });
}
export function createPlaylistRenderer(container, core, callbacks = {}) {
  const app = new Application();
  const root = new Container();
  const graphics = new Graphics();
  const textLayer = new Container();
  let destroyed = false;
  let ready = false;
  root.eventMode = "none";
  root.addChild(graphics, textLayer);
  const renderNow = () => {
    if (!ready || destroyed) {
      return;
    }
    drawPlaylist(graphics, textLayer, core.getPresentation());
    app.render?.();
  };
  const resize = () => {
    if (!ready || destroyed) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const viewport = core.getPresentation().state.viewport;
    app.renderer.resize(width, height);
    if (viewport.width !== width || viewport.height !== height) {
      core.setViewportSize(width, height);
      return;
    }
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
      const canvas = app.canvas;
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
    .catch((error) => {
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
