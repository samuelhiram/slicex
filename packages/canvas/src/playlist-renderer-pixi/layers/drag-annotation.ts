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
  TOOLTIP_HEIGHT,
  TOOLTIP_OFFSET_X,
  TOOLTIP_OFFSET_Y,
  TOOLTIP_PADDING_X,
} from "./tooltip";

const PILL_HEIGHT = 24;
const PILL_GAP = 4;
const DOT_SPACE = 14;
// Average advance of the 11px / 600 text: sentences are narrower per char
// than the tooltip's dates (spaces, separators).
const TEXT_CHAR_WIDTH = 6.05;

export interface DragAnnotationParts {
  container: Container;
  background: Graphics;
  textLayer: Container;
}

export interface DragAnnotationLayer {
  sync(
    presentation: PlaylistPresentation,
    annotation: PlaylistDragAnnotation | null,
    // Height of the tooltip it hangs under (taller with a detail line).
    tooltipHeight?: number,
  ): void;
  readonly stats: { repaints: number };
  // Repaint on the next sync even with the same annotation (theme change).
  invalidate(): void;
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
      Math.max(annotation.text.length, 1) * TEXT_CHAR_WIDTH +
      TOOLTIP_PADDING_X * 2 +
      DOT_SPACE;
    // Raised card: soft shadow (light theme), hairline in the tone, a tone
    // dot and the text in the tone (all tones are AA on the surface).
    if (COLORS.shadowAlpha > 0) {
      parts.background
        .roundRect(0, 2, width, PILL_HEIGHT, 8)
        .fill({ color: 0x000000, alpha: COLORS.shadowAlpha * 1.6 });
    }
    parts.background
      .roundRect(0, 0, width, PILL_HEIGHT, 8)
      .fill({ color: COLORS.panelStrong })
      .stroke({ color, width: 1, alpha: 0.45 });
    parts.background
      .circle(TOOLTIP_PADDING_X + 3, PILL_HEIGHT / 2, 3.5)
      .fill({ color });
    addText(
      parts.textLayer,
      annotation.text,
      TOOLTIP_PADDING_X + DOT_SPACE,
      5,
      { color, size: 11, weight: "600" },
    );
  }

  function sync(
    presentation: PlaylistPresentation,
    annotation: PlaylistDragAnnotation | null,
    tooltipHeight: number = TOOLTIP_HEIGHT,
  ): void {
    const tooltip = presentation.tooltipView;
    if (!tooltip || !annotation) {
      if (parts.container.visible) parts.container.visible = false;
      return;
    }
    if (annotation !== painted) repaint(annotation);
    const tooltipY = Math.round(tooltip.y + TOOLTIP_OFFSET_Y);
    let y = tooltipY + tooltipHeight + PILL_GAP;
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

  function invalidate(): void {
    painted = null;
  }

  return { sync, stats, invalidate, dispose };
}
