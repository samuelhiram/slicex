// Track header panel (rows on the left): name, color strip, M/S/L buttons,
// reorder handle, divider line. Lives on the global chromeGraphics layer
// (outside the timeline mask) so headers stay legible while clips slide.
import type { Container, Graphics } from "pixi.js";
import type { PlaylistPresentation } from "../../playlist-core";
import { COLORS, parseHexColor } from "../palette";
import { addText } from "../text-pool";

interface ButtonRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function drawTrackHeaderButton(
  graphics: Graphics,
  textLayer: Container,
  rect: ButtonRect,
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

function drawReorderHandle(graphics: Graphics, rect: ButtonRect): void {
  for (let i = 0; i < 3; i += 1) {
    const y = rect.y + 4 + i * 4;
    graphics
      .moveTo(rect.x + 3, y)
      .lineTo(rect.x + rect.width - 3, y)
      .stroke({ color: COLORS.textMuted, width: 1, alpha: 0.7 });
  }
}

export function drawTrackRows(
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
