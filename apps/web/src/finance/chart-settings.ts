// The balance chart's settings (the money lane above the event lines):
// which of its extras show and in which colour. A preference of this
// browser (localStorage), not of the plan.
//
// By default every extra is OFF — the chart is the cash curve and its $0
// line, nothing else (2026-11-20: "por defecto todos apagados para más
// limpieza visual"). Each one is a switch in "Ajustes del gráfico" (the gear
// at the chart's top-left corner):
//   minimums   the lowest points: a pin and a pill with the amount and day;
//   debt       what you owe, a line on its own scale;
//   reserve    your cushion: its dashed line, its label and the warning
//              colour under it;
//   alternate  the future you compare with (Futuros), as a ghost line;
//   scale      round amounts as faint guides, and the scale's labels.
// And a colour per element (the cash curve too): the theme's ("Auto") or
// one of a few presets that read on both themes. Under $0 the curve stays
// red whatever is chosen.
//
// One store for the app (the shell feeds the bridge from it; the futures
// menu turns "alternate" on when you pick a future to compare). Never
// throws: blocked / corrupted storage just means the defaults.
import * as React from "react";
import type { PlaylistOverviewColors } from "@slicex/canvas";
import type { OverviewView } from "./visuals";

export const CHART_SETTINGS_KEY = "slicex.chart.v1";

export type ChartLayer = "minimums" | "debt" | "reserve" | "alternate" | "scale";
export type ChartColorKey = "cash" | "minimums" | "debt" | "reserve" | "alternate";

export const CHART_LAYERS: readonly ChartLayer[] = ["minimums", "debt", "reserve", "alternate", "scale"];

export interface ChartSettings {
  layers: Readonly<Record<ChartLayer, boolean>>;
  /** A preset's id per element; absent = the theme's colour. */
  colors: Readonly<Partial<Record<ChartColorKey, ChartColorId>>>;
}

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  layers: { minimums: false, debt: false, reserve: false, alternate: false, scale: false },
  colors: {},
};

/** Presets: mid tones that read on the dark and the light canvas. No red (it means "under $0"). */
export const CHART_COLORS = [
  { id: "green", label: "Verde", hex: "#22a06b" },
  { id: "teal", label: "Turquesa", hex: "#14a3b8" },
  { id: "blue", label: "Azul", hex: "#3e7bfa" },
  { id: "violet", label: "Morado", hex: "#8e5cf7" },
  { id: "pink", label: "Rosa", hex: "#e2559a" },
  { id: "amber", label: "Ámbar", hex: "#d98b10" },
  { id: "gray", label: "Gris", hex: "#8b8d98" },
] as const;

export type ChartColorId = (typeof CHART_COLORS)[number]["id"];

const COLOR_BY_ID = new Map<string, (typeof CHART_COLORS)[number]>(CHART_COLORS.map((color) => [color.id, color]));

/** Which canvas colour each element sets (PlaylistOverviewColors). */
const CANVAS_COLOR_OF: Record<ChartColorKey, keyof PlaylistOverviewColors> = {
  cash: "positive",
  minimums: "annotation",
  debt: "secondary",
  reserve: "warning",
  alternate: "baseline",
};

/** The settings in `raw` (storage), the defaults for whatever is missing or wrong. */
export function parseChartSettings(raw: unknown): ChartSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_CHART_SETTINGS;
  const value = raw as { layers?: unknown; colors?: unknown };
  const layers = { ...DEFAULT_CHART_SETTINGS.layers };
  if (value.layers && typeof value.layers === "object") {
    for (const layer of CHART_LAYERS) {
      if ((value.layers as Record<string, unknown>)[layer] === true) layers[layer] = true;
    }
  }
  const colors: Partial<Record<ChartColorKey, ChartColorId>> = {};
  if (value.colors && typeof value.colors === "object") {
    for (const key of Object.keys(CANVAS_COLOR_OF) as ChartColorKey[]) {
      const id = (value.colors as Record<string, unknown>)[key];
      if (typeof id === "string" && COLOR_BY_ID.has(id)) colors[key] = id as ChartColorId;
    }
  }
  return { layers, colors };
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadChartSettings(): ChartSettings {
  try {
    const raw = storage()?.getItem(CHART_SETTINGS_KEY);
    return raw ? parseChartSettings(JSON.parse(raw)) : DEFAULT_CHART_SETTINGS;
  } catch {
    return DEFAULT_CHART_SETTINGS;
  }
}

function saveChartSettings(settings: ChartSettings): void {
  try {
    storage()?.setItem(CHART_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // blocked / full: the choice just isn't remembered
  }
}

/** "#22a06b" → 0x22a06b. */
function hexToNumber(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

/** The hex of a preset (null: the theme's). */
export function chartColorHex(id: ChartColorId | undefined): string | null {
  return id ? (COLOR_BY_ID.get(id)?.hex ?? null) : null;
}

/** The lane's view for the bridge (buildOverview), with the settings button's corner kept clear. */
export function overviewViewOf(settings: ChartSettings): OverviewView {
  const colors: PlaylistOverviewColors = {};
  let any = false;
  for (const key of Object.keys(CANVAS_COLOR_OF) as ChartColorKey[]) {
    const hex = chartColorHex(settings.colors[key]);
    if (hex === null) continue;
    colors[CANVAS_COLOR_OF[key]] = hexToNumber(hex);
    any = true;
  }
  const view: OverviewView = {
    ...settings.layers,
    corner: { width: CHART_GEAR_CORNER, height: CHART_GEAR_CORNER },
  };
  if (any) view.colors = colors;
  return view;
}

/** Px the gear takes at the chart's top-left (its 26 px button, 6 px in, a gap): no label goes there. */
export const CHART_GEAR_CORNER = 38;

// --- the store ---------------------------------------------------------------

let current: ChartSettings | null = null;
const listeners = new Set<() => void>();

export function getChartSettings(): ChartSettings {
  if (current === null) current = loadChartSettings();
  return current;
}

export function setChartSettings(next: ChartSettings): void {
  if (next === current) return;
  current = next;
  saveChartSettings(next);
  for (const listener of listeners) listener();
}

export function setChartLayer(layer: ChartLayer, on: boolean): void {
  const settings = getChartSettings();
  if (settings.layers[layer] === on) return;
  setChartSettings({ ...settings, layers: { ...settings.layers, [layer]: on } });
}

export function setChartColor(key: ChartColorKey, id: ChartColorId | null): void {
  const settings = getChartSettings();
  if ((settings.colors[key] ?? null) === id) return;
  const colors = { ...settings.colors };
  if (id === null) delete colors[key];
  else colors[key] = id;
  setChartSettings({ ...settings, colors });
}

export function subscribeChartSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For tests: forget the loaded settings (the next read loads them again). */
export function resetChartSettingsForTests(): void {
  current = null;
}

export function useChartSettings(): ChartSettings {
  return React.useSyncExternalStore(subscribeChartSettings, getChartSettings, getChartSettings);
}
