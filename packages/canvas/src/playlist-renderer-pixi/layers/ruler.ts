// Ruler chrome (top band with bar numbers) + the timeline grid that drops
// behind clips. The orchestrator owns the dirty-key cache for the grid;
// this module just emits draw commands when invoked.
import type { Container, Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";
import { COLORS } from "../palette";
import { addText } from "../text-pool";

export function drawRulerChrome(
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

export function drawTimelineGrid(
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
