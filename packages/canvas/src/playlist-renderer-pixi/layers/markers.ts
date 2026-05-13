// Timeline markers — flag-shaped triangles on the ruler plus a subtle
// vertical line that drops behind clips. Drawn on chromeGraphics so it sits
// above the timeline mask.
import type { Container, Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";
import { COLORS, markerColor } from "../palette";
import { addText } from "../text-pool";

export function drawMarkers(
  graphics: Graphics,
  textLayer: Container,
  presentation: PlaylistPresentation,
): void {
  const { metrics } = presentation;
  for (const view of presentation.markerViews) {
    if (!view.isVisible) continue;
    if (view.x < metrics.trackHeaderWidth) continue;
    const color = markerColor(view.marker.kind);
    const baseY = 4;
    // Flag-shaped triangle pointing down so the user sees where it anchors.
    graphics
      .moveTo(view.x, metrics.rulerHeight - 2)
      .lineTo(view.x - 6, baseY)
      .lineTo(view.x + 6, baseY)
      .lineTo(view.x, metrics.rulerHeight - 2)
      .fill({ color, alpha: 0.92 })
      .stroke({ color: COLORS.text, width: 1, alpha: 0.7 });
    // Vertical line down the timeline (subtle).
    graphics
      .moveTo(view.x + 0.5, metrics.rulerHeight)
      .lineTo(view.x + 0.5, presentation.layout.sceneRect.height)
      .stroke({ color, alpha: 0.18, width: 1 });
    const label = view.marker.label;
    if (label) {
      addText(textLayer, label, view.x + 8, baseY + 1, {
        color: COLORS.text,
        size: 10,
        weight: "600",
      });
    }
  }
}
