// @vitest-environment jsdom
// "Ajustes del gráfico" (2026-11-20): the balance chart shows only the cash
// curve and its $0 line until the person turns its extras on — the lowest
// points, the debt, the reserve, the compared future, the scale — each with
// its colour. A preference of the browser (localStorage), fed to the bridge.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createDemoFinancialDocument,
  findLiquidityWarnings,
  projectFinancialDocument,
} from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import {
  CHART_GEAR_CORNER,
  CHART_SETTINGS_KEY,
  DEFAULT_CHART_SETTINGS,
  getChartSettings,
  overviewViewOf,
  parseChartSettings,
  resetChartSettingsForTests,
  setChartColor,
  setChartLayer,
} from "../src/finance/chart-settings";
import { ChartSettingsDialog } from "../src/finance/components/ChartSettings";
import { FinancialBridge } from "../src/finance/financial-bridge";
import { FINANCE_PLAYLIST_METRICS, createFinancialPlaylistState } from "../src/finance/mapping";
import { buildOverview, FULL_OVERVIEW_VIEW } from "../src/finance/visuals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const START = "2026-11-07";

let root: Root | null = null;
let container: HTMLElement | null = null;

function mount(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error("element not found");
  act(() => (el as HTMLElement).click());
}

beforeEach(() => {
  localStorage.clear();
  resetChartSettingsForTests();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  localStorage.clear();
  resetChartSettingsForTests();
});

describe("the chart's settings: all off by default, remembered by the browser", () => {
  it("a first visit: every extra off, theme colours", () => {
    expect(getChartSettings()).toEqual(DEFAULT_CHART_SETTINGS);
    expect(Object.values(getChartSettings().layers).every((on) => on === false)).toBe(true);
  });

  it("a switch and a colour are saved; a reload reads them back", () => {
    setChartLayer("debt", true);
    setChartColor("cash", "blue");
    resetChartSettingsForTests();
    const again = getChartSettings();
    expect(again.layers.debt).toBe(true);
    expect(again.layers.reserve).toBe(false);
    expect(again.colors.cash).toBe("blue");
    // Back to the theme's.
    setChartColor("cash", null);
    expect(getChartSettings().colors.cash).toBeUndefined();
  });

  it("whatever is unreadable or unknown falls back to the defaults", () => {
    localStorage.setItem(CHART_SETTINGS_KEY, "{not json");
    expect(getChartSettings()).toEqual(DEFAULT_CHART_SETTINGS);
    expect(
      parseChartSettings({ layers: { debt: "yes", scale: true }, colors: { cash: "#ff0000", debt: "teal" } }),
    ).toEqual({ layers: { ...DEFAULT_CHART_SETTINGS.layers, scale: true }, colors: { debt: "teal" } });
  });

  it("the bridge's view: the switches, the canvas colours, the gear's corner kept clear", () => {
    const view = overviewViewOf({
      layers: { ...DEFAULT_CHART_SETTINGS.layers, reserve: true },
      colors: { cash: "blue", reserve: "amber", alternate: "gray" },
    });
    expect(view).toMatchObject({ minimums: false, debt: false, reserve: true, alternate: false, scale: false });
    expect(view.colors).toEqual({ positive: 0x3e7bfa, warning: 0xd98b10, baseline: 0x8b8d98 });
    expect(view.corner).toEqual({ width: CHART_GEAR_CORNER, height: CHART_GEAR_CORNER });
    // No colour chosen: the theme's (no `colors` at all).
    expect(overviewViewOf(DEFAULT_CHART_SETTINGS).colors).toBeUndefined();
  });
});

describe("the lane with its extras off: the cash curve and $0 only", () => {
  const doc = createDemoFinancialDocument(START);
  const projection = projectFinancialDocument(doc);
  const warnings = findLiquidityWarnings(projection, doc.minimumCashReserve);

  it("everything on (the bridge's default): pins, debt, reserve, guides, scale labels", () => {
    const data = buildOverview(doc, projection, warnings, null, null, FULL_OVERVIEW_VIEW);
    expect(data.annotations.length).toBeGreaterThan(0);
    expect(data.secondary).not.toBeNull();
    expect(data.thresholds.map((threshold) => threshold.tone)).toEqual(["warning", "danger"]);
    expect(data.guides).toBeDefined();
    expect(data.scaleLabels).toBeUndefined();
  });

  it("all off: no pins, no debt, no reserve (line, label, tone), no scale — the same scale shape", () => {
    const off = overviewViewOf(DEFAULT_CHART_SETTINGS);
    const full = buildOverview(doc, projection, warnings, null, null, FULL_OVERVIEW_VIEW);
    const data = buildOverview(doc, projection, warnings, null, null, off);
    expect(data.annotations).toEqual([]);
    expect(data.secondary).toBeNull();
    expect(data.thresholds).toEqual([{ value: 0, tone: "danger" }]);
    expect(data.guides).toBeUndefined();
    expect(data.scaleLabels).toBe(false);
    expect(data.corner).toEqual({ width: CHART_GEAR_CORNER, height: CHART_GEAR_CORNER });
    expect(data.scale).toEqual(full.scale);
    expect(data.domain).toEqual(full.domain);
  });
});

describe("the bridge: the compared future's ghost only with 'Plan alterno'", () => {
  it("setOverviewView redraws the lane; the ghost follows the switch", () => {
    const doc = createDemoFinancialDocument(START);
    const core = createPlaylistCore(createFinancialPlaylistState(doc), {
      metrics: FINANCE_PLAYLIST_METRICS,
      stretchEnabled: false,
    });
    const bridge = new FinancialBridge(core, doc);
    bridge.setComparison({ ...doc, initialCash: doc.initialCash - 5000 });
    // The bridge alone: everything (tests and other hosts).
    expect(bridge.getOverviewData().baseline).not.toBeNull();
    let notified = 0;
    bridge.subscribe(() => {
      notified += 1;
    });
    bridge.setOverviewView(overviewViewOf(DEFAULT_CHART_SETTINGS));
    expect(notified).toBeGreaterThan(0);
    const clean = bridge.getOverviewData();
    expect(clean.baseline).toBeNull();
    expect(clean.secondary).toBeNull();
    expect(clean.annotations).toEqual([]);
    bridge.setOverviewView(
      overviewViewOf({ layers: { ...DEFAULT_CHART_SETTINGS.layers, alternate: true }, colors: {} }),
    );
    expect(bridge.getOverviewData().baseline).not.toBeNull();
    bridge.destroy();
  });
});

describe("the dialog: a switch per extra, a colour per element, live", () => {
  function open() {
    let closed = 0;
    mount(
      React.createElement(ChartSettingsDialog, {
        anchor: { left: 240, bottom: 120 },
        onClose: () => {
          closed += 1;
        },
      }),
    );
    return { closed: () => closed };
  }
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
  const switchOf = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(
      (el) => document.getElementById(el.getAttribute("aria-labelledby")!)!.textContent === name,
    )!;

  it("titled, under the gear; five switches, all off; the first one focused", () => {
    open();
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(dialog().textContent).toContain("Ajustes del gráfico");
    expect(dialog().style.top).toBe("128px");
    expect(dialog().style.left).toBe("240px");
    const switches = [...document.querySelectorAll('[role="switch"]')];
    expect(switches.map((el) => document.getElementById(el.getAttribute("aria-labelledby")!)!.textContent)).toEqual([
      "Mínimos",
      "Deuda",
      "Reserva",
      "Plan alterno",
      "Escala",
    ]);
    expect(switches.every((el) => el.getAttribute("aria-checked") === "false")).toBe(true);
    expect(document.activeElement).toBe(switches[0]);
  });

  it("a switch turns its extra on at once; its colours wake up; 'Apagar todo' turns all off", () => {
    open();
    const debtColors = () => document.querySelector('[role="radiogroup"][aria-label="Color de Deuda"]')!;
    expect(debtColors().getAttribute("aria-disabled")).toBe("true");
    click(switchOf("Deuda"));
    expect(getChartSettings().layers.debt).toBe(true);
    expect(switchOf("Deuda").getAttribute("aria-checked")).toBe("true");
    expect(debtColors().getAttribute("aria-disabled")).toBeNull();
    // A colour: the radio of "Morado".
    click(debtColors().querySelector('input[aria-label="Morado"]'));
    expect(getChartSettings().colors.debt).toBe("violet");
    // The cash curve's colour, always available.
    click(document.querySelector('[role="radiogroup"][aria-label="Color de Caja"] input[aria-label="Azul"]'));
    expect(getChartSettings().colors.cash).toBe("blue");
    click([...dialog().querySelectorAll("button")].find((el) => el.textContent === "Apagar todo"));
    expect(Object.values(getChartSettings().layers).every((on) => on === false)).toBe(true);
    // The colours stay chosen.
    expect(getChartSettings().colors.debt).toBe("violet");
  });

  it("Escape, × and 'Listo' close it", () => {
    const { closed } = open();
    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(closed()).toBe(1);
    click(dialog().querySelector('button[aria-label="Cerrar"]'));
    click([...dialog().querySelectorAll("button")].find((el) => el.textContent === "Listo"));
    expect(closed()).toBe(3);
  });
});
