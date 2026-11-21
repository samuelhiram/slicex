// @vitest-environment jsdom
// The item editor's spotlight: the backdrop blurs and dims everything but
// the object being edited — a clear window around it (clip-path hole) with
// an accent ring. Where the window goes (the clip's drawn rect, cut to the
// visible timeline, grown a little, stopped under the sheet), the path that
// cuts it, and the editor mounting it only for an object on screen.
import { afterEach, describe, expect, it } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FinancialDocument } from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import { FinancialBridge } from "../src/finance/financial-bridge";
import { FINANCE_PLAYLIST_METRICS, createFinancialPlaylistState } from "../src/finance/mapping";
import {
  SPOT_PAD,
  SPOT_RADIUS,
  clipScreenRect,
  spotlightClipPath,
  spotlightHole,
} from "../src/finance/components/EditorSpotlight";
import { FinancialEditorModal } from "../src/finance/components/FinancialEditorModal";
import { SlicexMantineProvider } from "../src/mantine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const START = "2026-11-07";

function makeDoc(): FinancialDocument {
  return {
    id: "t",
    name: "test",
    startDate: START,
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
      {
        id: "bono",
        kind: "income",
        name: "Bono",
        amount: 4000,
        recurrence: { frequency: "once", startDate: "2026-12-09", endDate: "2026-12-09" },
      },
    ],
  };
}

function setup() {
  const doc = makeDoc();
  const core = createPlaylistCore(createFinancialPlaylistState(doc), {
    metrics: FINANCE_PLAYLIST_METRICS,
    stretchEnabled: false,
  });
  core.setViewportSize(1200, 700);
  const bridge = new FinancialBridge(core, doc);
  return { core, bridge };
}

// A host element placed at (left, top) on the page.
function hostAt(left: number, top: number, width = 1200, height = 700): HTMLElement {
  const host = document.createElement("div");
  host.getBoundingClientRect = () =>
    ({ left, top, x: left, y: top, width, height, right: left + width, bottom: top + height }) as DOMRect;
  return host;
}

describe("where the window goes", () => {
  it("is the clip's drawn rect on the page, offset by the canvas host", () => {
    const { core } = setup();
    const view = core.getPresentation().visibleClipViews.find((v) => v.clip.id === "bono")!;
    const area = core.getPresentation().layout.timelineRect;
    expect(view).toBeDefined();
    const rect = clipScreenRect(core, hostAt(40, 70), "bono")!;
    expect(rect).not.toBeNull();
    expect(rect.x).toBe(40 + Math.max(view.rect.x, area.x));
    expect(rect.y).toBe(70 + Math.max(view.rect.y, area.y));
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.width).toBeGreaterThan(0);
  });

  it("is cut to the visible timeline: never over the ruler or the line headers", () => {
    const { core } = setup();
    const area = core.getPresentation().layout.timelineRect;
    // "Sueldo" starts before the view once scrolled: its rect is cut at the headers.
    core.updateViewport({ scrollX: core.getState().viewport.pxPerBeat * 20 });
    const rect = clipScreenRect(core, hostAt(0, 0), "sal");
    expect(rect).not.toBeNull();
    expect(rect!.x).toBe(area.x);
    expect(rect!.y).toBeGreaterThanOrEqual(area.y);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(area.x + area.width);
  });

  it("is none for a clip off screen or unknown", () => {
    const { core } = setup();
    // Far to the right of the one-time "Bono": not drawn.
    core.updateViewport({ scrollX: core.getState().viewport.pxPerBeat * 300 });
    expect(clipScreenRect(core, hostAt(0, 0), "bono")).toBeNull();
    expect(clipScreenRect(core, hostAt(0, 0), "nope")).toBeNull();
  });
});

describe("the hole", () => {
  const box = { x: 10, y: 20, width: 1000, height: 600 };

  it("is overlay-local and grown by SPOT_PAD around the object", () => {
    expect(spotlightHole(box, { x: 110, y: 120, width: 200, height: 50 })).toEqual({
      x: 100 - SPOT_PAD,
      y: 100 - SPOT_PAD,
      width: 200 + 2 * SPOT_PAD,
      height: 50 + 2 * SPOT_PAD,
    });
  });

  it("stays inside the overlay; none when nothing of it is left", () => {
    const hole = spotlightHole(box, { x: 0, y: 0, width: 60, height: 40 })!;
    expect(hole.x).toBe(0);
    expect(hole.y).toBe(0);
    expect(spotlightHole(box, { x: 2000, y: 100, width: 50, height: 30 })).toBeNull();
  });

  it("stops a little under the sheet's left edge (the ring's end hidden by it)", () => {
    const sheet = { x: 500, y: 8, width: 492, height: 584 };
    const hole = spotlightHole(box, { x: 310, y: 120, width: 600, height: 50 }, sheet)!;
    expect(hole.x).toBe(300 - SPOT_PAD);
    expect(hole.x + hole.width).toBe(500 + SPOT_RADIUS + SPOT_PAD);
    // Wholly behind the sheet: no window.
    expect(spotlightHole(box, { x: 700, y: 120, width: 100, height: 50 }, sheet)).toBeNull();
    // A sheet that does not cover the hole's height leaves it whole.
    const short = { x: 500, y: 300, width: 492, height: 100 };
    expect(spotlightHole(box, { x: 310, y: 120, width: 600, height: 50 }, short)!.width).toBe(600 + 2 * SPOT_PAD);
  });

  it("is cut with one even-odd path: the whole box, then the rounded hole", () => {
    const path = spotlightClipPath(800, 600, { x: 100, y: 50, width: 200, height: 60 });
    expect(path.startsWith('path(evenodd, "M0 0H800V600H0Z')).toBe(true);
    expect(path).toContain(`M${100 + SPOT_RADIUS} 50`);
    expect(path).toContain(`A${SPOT_RADIUS} ${SPOT_RADIUS} 0 0 1`);
    expect(path.endsWith('Z")')).toBe(true);
    // A small hole: the corner radius never exceeds half its side.
    expect(spotlightClipPath(100, 100, { x: 0, y: 0, width: 10, height: 8 }, 9)).toContain("A4 4 0 0 1");
  });
});

describe("the editor's backdrop", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function mount(node: React.ReactElement) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(React.createElement(SlicexMantineProvider, { theme: "dark", children: node })));
  }

  // jsdom lays nothing out: the overlay is given a box.
  function withOverlayBox<T>(run: () => T): T {
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.classList.contains("fin-sheet-overlay")) {
        return { left: 0, top: 0, x: 0, y: 0, width: 1600, height: 950, right: 1600, bottom: 950 } as DOMRect;
      }
      return original.call(this);
    };
    try {
      return run();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
  }

  it("editing an object on screen: a clear window on it, ringed", () => {
    const { bridge } = setup();
    const host = hostAt(0, 0);
    withOverlayBox(() =>
      mount(
        React.createElement(FinancialEditorModal, {
          bridge,
          itemId: "bono",
          onClose: () => {},
          spotlightHost: () => host,
        }),
      ),
    );
    const scrim = document.querySelector<HTMLElement>(".fin-spotlight__scrim")!;
    expect(scrim).not.toBeNull();
    expect(scrim.getAttribute("aria-hidden")).toBe("true");
    expect(scrim.dataset.hole).toBe("true");
    expect(scrim.style.clipPath).toContain("evenodd");
    const ring = document.querySelector<HTMLElement>(".fin-spotlight__ring")!;
    expect(ring).not.toBeNull();
    const rect = clipScreenRect(bridge.core, host, "bono")!;
    expect(ring.style.left).toBe(`${Math.round(rect.x - SPOT_PAD)}px`);
    expect(ring.style.top).toBe(`${Math.round(rect.y - SPOT_PAD)}px`);
  });

  it("creating (no object yet) or without the canvas: the whole backdrop blurs", () => {
    const { bridge } = setup();
    withOverlayBox(() =>
      mount(React.createElement(FinancialEditorModal, { bridge, itemId: "bono", onClose: () => {} })),
    );
    const scrim = document.querySelector<HTMLElement>(".fin-spotlight__scrim")!;
    expect(scrim.dataset.hole).toBe("false");
    expect(scrim.style.clipPath).toBe("");
    expect(document.querySelector(".fin-spotlight__ring")).toBeNull();
  });
});
