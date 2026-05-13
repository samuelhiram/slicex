// Scene background + alternating track-row bands. Both go on the global
// sceneGraphics layer (under the mask), so the timeline mask hides them
// behind the ruler/header without an extra clip.
import type { Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";
import { COLORS } from "../palette";

export function drawSceneBackground(
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

export function drawTrackRowsBackground(
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
