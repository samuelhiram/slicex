// Time tooltips carry their beat (PlaylistTooltip.time) so the host can add
// a detail line under the date (renderer getTooltipDetail, e.g. the cash
// that day); the drag pill then hangs under the taller tooltip.
import { Container, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { createDemoPlaylistState, createPlaylistCore } from "../src/playlist-core";
import {
  TOOLTIP_DETAIL_HEIGHT,
  TOOLTIP_HEIGHT,
  drawTooltip,
} from "../src/playlist-renderer-pixi/layers/tooltip";
import { createDragAnnotationLayer } from "../src/playlist-renderer-pixi/layers/drag-annotation";

function coreWithTooltip(time?: number) {
  const core = createPlaylistCore(createDemoPlaylistState());
  core.setViewportSize(1200, 700);
  core.setTooltip({ kind: "time", text: "mar 1 dic 2026", anchor: { x: 300, y: 300 }, time });
  return core;
}

describe("time tooltip detail line", () => {
  it("the tooltip view carries its beat", () => {
    expect(coreWithTooltip(42).getPresentation().tooltipView?.time).toBe(42);
    expect(coreWithTooltip().getPresentation().tooltipView?.time).toBeNull();
  });

  it("a detail adds a second line and makes the pill taller", () => {
    const core = coreWithTooltip(42);
    const ctx = { container: new Container(), background: new Graphics(), textLayer: new Container() };
    expect(drawTooltip(ctx, core.getPresentation())).toBe(TOOLTIP_HEIGHT);
    const lines = ctx.textLayer.children.filter((child) => child.visible).length;
    const ctx2 = { container: new Container(), background: new Graphics(), textLayer: new Container() };
    expect(drawTooltip(ctx2, core.getPresentation(), "Caja $12,000")).toBe(
      TOOLTIP_HEIGHT + TOOLTIP_DETAIL_HEIGHT,
    );
    expect(ctx2.textLayer.children.filter((child) => child.visible).length).toBe(lines + 1);
  });

  it("several detail lines ('\n'), each its own row", () => {
    const core = coreWithTooltip(42);
    const ctx = { container: new Container(), background: new Graphics(), textLayer: new Container() };
    const before = ctx.textLayer.children.filter((child) => child.visible).length;
    expect(drawTooltip(ctx, core.getPresentation(), "Caja $2,500\n+$9,000 Sueldo\n−$7,500 Renta")).toBe(
      TOOLTIP_HEIGHT + 3 * TOOLTIP_DETAIL_HEIGHT,
    );
    expect(ctx.textLayer.children.filter((child) => child.visible).length).toBe(before + 4);
  });

  it("the drag pill sits under the taller tooltip", () => {
    const core = coreWithTooltip(42);
    const annotation = { text: "horizonte +$1", tone: "positive" as const };
    const tallParts = { container: new Container(), background: new Graphics(), textLayer: new Container() };
    createDragAnnotationLayer(tallParts).sync(
      core.getPresentation(),
      annotation,
      TOOLTIP_HEIGHT + TOOLTIP_DETAIL_HEIGHT,
    );
    const lowParts = { container: new Container(), background: new Graphics(), textLayer: new Container() };
    createDragAnnotationLayer(lowParts).sync(core.getPresentation(), annotation);
    expect(tallParts.container.y - lowParts.container.y).toBe(TOOLTIP_DETAIL_HEIGHT);
  });
});
