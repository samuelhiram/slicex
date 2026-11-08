// Drag annotation — a pill attached below the floating tooltip while it is
// visible, showing a host-provided line (PlaylistRendererCallbacks.
// getDragAnnotation), e.g. the effect of the gesture in progress.
//
// Canon §3.8: the pill is drawn ONCE per annotation reference in local
// coordinates (own Graphics + pooled Text, created by renderer-impl init);
// following the cursor is a transform update of its container. A new
// reference = one repaint; the same reference across N pointermoves = 0.
import type { Container, Graphics } from "pixi.js";
import type {
  PlaylistDragAnnotation,
  PlaylistPresentation,
} from "../../playlist-core";
import { COLORS } from "../palette";
import { addText, clearTextLayer, disposeTextLayer } from "../text-pool";
import {
  TOOLTIP_CHAR_WIDTH,
  TOOLTIP_HEIGHT,
  TOOLTIP_OFFSET_X,
  TOOLTIP_OFFSET_Y,
  TOOLTIP_PADDING_X,
} from "./tooltip";

const PILL_HEIGHT = 20;
const PILL_GAP = 3;
const ACCENT_WIDTH = 3;

export interface DragAnnotationParts {
  container: Container;
  background: Graphics;
  textLayer: Container;
}

export interface DragAnnotationLayer {
  sync(
    presentation: PlaylistPresentation,
    annotation: PlaylistDragAnnotation | null,
  ): void;
  readonly stats: { repaints: number };
  dispose(): void;
}

function toneColor(tone: PlaylistDragAnnotation["tone"]): number {
  if (tone === "positive") return COLORS.tonePositive;
  if (tone === "negative") return COLORS.toneDanger;
  return COLORS.textMuted;
}

export function createDragAnnotationLayer(
  parts: DragAnnotationParts,
): DragAnnotationLayer {
  const stats = { repaints: 0 };
  let painted: PlaylistDragAnnotation | null = null;

  function repaint(annotation: PlaylistDragAnnotation): void {
    stats.repaints += 1;
    painted = annotation;
    parts.background.clear();
    clearTextLayer(parts.textLayer);
    const color = toneColor(annotation.tone);
    const width =
      Math.max(annotation.text.length, 1) * TOOLTIP_CHAR_WIDTH +
      TOOLTIP_PADDING_X * 2 +
      ACCENT_WIDTH;
    parts.background
      .roundRect(0, 0, width, PILL_HEIGHT, 4)
      .fill({ color: COLORS.panelStrong, alpha: 0.96 })
      .stroke({ color, width: 1, alpha: 0.75 });
    parts.background
      .rect(1, 1, ACCENT_WIDTH, PILL_HEIGHT - 2)
      .fill({ color });
    addText(
      parts.textLayer,
      annotation.text,
      ACCENT_WIDTH + TOOLTIP_PADDING_X,
      4,
      { color, size: 11, weight: "700" },
    );
  }

  function sync(
    presentation: PlaylistPresentation,
    annotation: PlaylistDragAnnotation | null,
  ): void {
    const tooltip = presentation.tooltipView;
    if (!tooltip || !annotation) {
      if (parts.container.visible) parts.container.visible = false;
      return;
    }
    if (annotation !== painted) repaint(annotation);
    const tooltipY = Math.round(tooltip.y + TOOLTIP_OFFSET_Y);
    let y = tooltipY + TOOLTIP_HEIGHT + PILL_GAP;
    // Near the bottom edge: sit above the tooltip instead.
    if (y + PILL_HEIGHT > presentation.state.viewport.height) {
      y = tooltipY - PILL_GAP - PILL_HEIGHT;
    }
    parts.container.x = Math.round(tooltip.x + TOOLTIP_OFFSET_X);
    parts.container.y = y;
    if (!parts.container.visible) parts.container.visible = true;
  }

  function dispose(): void {
    parts.background.clear();
    disposeTextLayer(parts.textLayer);
    painted = null;
  }

  return { sync, stats, dispose };
}
