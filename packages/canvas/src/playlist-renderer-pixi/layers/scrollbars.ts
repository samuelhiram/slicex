// Horizontal + vertical scrollbar tracks/thumbs plus the corner block. Sits
// on foregroundGraphics so it overlays everything (including the timeline
// mask).
import type { Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";
import { COLORS } from "../palette";

export function drawScrollbars(
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
