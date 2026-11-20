// @vitest-environment jsdom
// The table's corner pad (ZoomPad): ↔ zoom (left edge kept), ↕ every line's
// height; arrows in steps; one drag = one undo step; the height travels with
// the plan's saved layout (rowHeight).
import { afterEach, describe, expect, it } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FinancialDocument } from "@slicex/core";
import { createPlaylistCore, type PlaylistCore } from "@slicex/canvas";
import { ZoomPad, zoomKeepingLeft } from "../src/finance/components/ZoomPad";
import { TimelineCell } from "../src/finance/components/TimelineCell";
import {
  FINANCE_DEFAULT_PX_PER_DAY,
  FINANCE_PLAYLIST_METRICS,
  createFinancialPlaylistState,
  parseTrackLayout,
  trackLayoutOf,
} from "../src/finance/mapping";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DOC: FinancialDocument = {
  id: "t",
  name: "t",
  startDate: "2026-11-07",
  initialCash: 5000,
  minimumCashReserve: 1000,
  horizonMonths: 12,
  items: [
    {
      id: "sal",
      kind: "income",
      name: "Sueldo",
      amount: 9000,
      recurrence: { frequency: "biweekly", startDate: "2026-11-13" },
    },
  ],
};

function makeCore(): PlaylistCore {
  const core = createPlaylistCore(createFinancialPlaylistState(DOC), {
    metrics: FINANCE_PLAYLIST_METRICS,
    stretchEnabled: false,
  });
  core.setViewportSize(1400, 800);
  return core;
}

let root: Root | null = null;
let container: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const NORMAL = FINANCE_PLAYLIST_METRICS.trackHeight;

function mount(core: PlaylistCore): HTMLButtonElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props = { core, normalHeight: NORMAL, defaultPxPerBeat: FINANCE_DEFAULT_PX_PER_DAY };
  act(() =>
    root!.render(
      React.createElement(React.Fragment, null, React.createElement(ZoomPad, props), React.createElement(TimelineCell, props)),
    ),
  );
  return container.querySelector<HTMLButtonElement>(".fin-zoompad")!;
}

const click = (el: Element) =>
  act(() => {
    (el as HTMLElement).click();
  });

const press = (pad: HTMLElement, key: string) =>
  act(() => {
    pad.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

describe("the corner pad", () => {
  it("is a named control that reads the visible span and the lines' height", () => {
    const core = makeCore();
    const pad = mount(core);
    expect(pad.getAttribute("aria-label")).toBe("Zoom y alto de las líneas");
    expect(pad.textContent).toContain(`Alto ${core.metrics.trackHeight}`);
    expect(pad.querySelector(".fin-zoompad__span")!.textContent).toMatch(/≈|días/);
  });

  it("arrows: ↑ ↓ every line's height, ← → zoom keeping the left edge's day", () => {
    const core = makeCore();
    const pad = mount(core);
    const height = core.metrics.trackHeight;
    press(pad, "ArrowUp");
    expect(core.metrics.trackHeight).toBe(height + 8);
    expect(core.getState().tracks.every((track) => track.height === height + 8)).toBe(true);
    expect(pad.textContent).toContain(`Alto ${height + 8}`);
    press(pad, "ArrowDown");
    expect(core.metrics.trackHeight).toBe(height);
    core.updateViewport({ scrollX: 30 * core.getState().viewport.pxPerBeat });
    const leftDay = core.getState().viewport.scrollX / core.getState().viewport.pxPerBeat;
    const px = core.getState().viewport.pxPerBeat;
    press(pad, "ArrowRight");
    expect(core.getState().viewport.pxPerBeat).toBeCloseTo(px * 1.25, 6);
    expect(core.getState().viewport.scrollX / core.getState().viewport.pxPerBeat).toBeCloseTo(leftDay, 6);
    press(pad, "ArrowLeft");
    expect(core.getState().viewport.pxPerBeat).toBeCloseTo(px, 6);
  });

  it("zoomKeepingLeft stays within the metrics", () => {
    const core = makeCore();
    zoomKeepingLeft(core, 1e9);
    expect(core.getState().viewport.pxPerBeat).toBe(core.metrics.maxPxPerBeat);
    zoomKeepingLeft(core, 0.0001);
    expect(core.getState().viewport.pxPerBeat).toBe(core.metrics.minPxPerBeat);
  });

  it("a drag is one undo step for the heights (the pointer stays visible without pointer lock)", async () => {
    const core = makeCore();
    const pad = mount(core);
    const height = core.metrics.trackHeight;
    const pointer = (type: string, x: number, y: number) =>
      new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y });
    act(() => {
      pad.dispatchEvent(pointer("pointerdown", 100, 100));
    });
    act(() => {
      pad.dispatchEvent(pointer("pointermove", 100, 50)); // 50 px up: +20 px
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    act(() => {
      pad.dispatchEvent(pointer("pointerup", 100, 50));
    });
    expect(core.metrics.trackHeight).toBe(height + 20);
    core.undo();
    expect(core.metrics.trackHeight).toBe(height);
  });
});

describe("Restaurar (↺) and 'Plano de eventos'", () => {
  it("↺ is off at the normal sizes; after a change it brings the lines' height and the zoom back", () => {
    const core = makeCore();
    const pad = mount(core);
    const reset = container!.querySelector<HTMLButtonElement>(".fin-zoompad__reset")!;
    expect(reset.getAttribute("aria-label")).toBe("Restaurar tamaños y zoom");
    expect(reset.disabled).toBe(true);
    press(pad, "ArrowUp");
    press(pad, "ArrowRight");
    expect(reset.disabled).toBe(false);
    click(reset);
    expect(core.metrics.trackHeight).toBe(NORMAL);
    expect(core.getState().viewport.pxPerBeat).toBeCloseTo(FINANCE_DEFAULT_PX_PER_DAY, 6);
    expect(reset.disabled).toBe(true);
  });

  it("the lane's cell says 'Plano de eventos'; 'Alto normal' puts every line back, in one click", () => {
    const core = makeCore();
    mount(core);
    const cell = container!.querySelector<HTMLElement>(".fin-lanecell")!;
    expect(cell.getAttribute("aria-label")).toBe("Plano de eventos");
    expect(cell.textContent).toContain("Plano de eventos");
    // Icon only: its name is in aria-label (and the tooltip).
    const normal = cell.querySelector<HTMLButtonElement>('button[aria-label="Todas las líneas a su alto normal"]')!;
    expect(normal.textContent).toBe("");
    expect(normal.title).toContain("Alto normal");
    expect(normal.disabled).toBe(true);
    act(() => core.setAllTrackHeights(50));
    expect(normal.disabled).toBe(false);
    click(normal);
    expect(core.metrics.trackHeight).toBe(NORMAL);
    expect(core.getState().tracks.every((track) => (track.height ?? NORMAL) === NORMAL)).toBe(true);
    expect(normal.disabled).toBe(true);
    // One undo step back to 50.
    act(() => {
      core.undo();
    });
    expect(core.metrics.trackHeight).toBe(50);
  });
});

describe("the lines' height travels with the plan", () => {
  it("saved in the layout, read back, and the next core starts with it", () => {
    const core = makeCore();
    core.setAllTrackHeights(60);
    const layout = trackLayoutOf(core.getState(), () => true);
    expect(layout.rowHeight).toBe(60);
    const parsed = parseTrackLayout(JSON.parse(JSON.stringify(layout)))!;
    expect(parsed.rowHeight).toBe(60);
    const next = createPlaylistCore(createFinancialPlaylistState(DOC, parsed), {
      metrics: FINANCE_PLAYLIST_METRICS,
      stretchEnabled: false,
    });
    expect(next.metrics.trackHeight).toBe(60);
  });
});
