// @vitest-environment jsdom
// UX audit 2026-11-11, group H (header, shell, structural accessibility and
// design tokens): UX-03, UX-14, UX-15, UX-18, UX-19, UX-26, UX-27, UX-29,
// UX-46, UX-48, UX-56, UX-57, UX-58, UX-59, UX-63.
//
// The header runs against a REAL bridge (createPlaylistCore + FinancialBridge
// on the demo year): muting / solo / undo go through the playlist history.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createDemoFinancialDocument,
  findLiquidityWarnings,
  projectFinancialDocument,
  type FinancialDocument,
} from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import { FinancialBridge } from "../src/finance/financial-bridge";
import { FINANCE_PLAYLIST_METRICS, createFinancialPlaylistState } from "../src/finance/mapping";
import {
  computeVerdict,
  excludedItems,
  exclusionLabel,
  firstNegativeDate,
  realInitialDebt,
} from "../src/finance/summary";
import { formatDateShort, formatMoneyWhole } from "../src/finance/format";
import { Futures } from "../src/finance/futures";
import {
  FinancialSummaryBar,
  FutureStrip,
  type PlanMenuActions,
} from "../src/finance/components/FinancialSummaryBar";
import { HIDE_GRACE_MS } from "../src/finance/components/MetricHelp";
import { describeSpanDays, matchSpan } from "../src/finance/components/NavControls";
import { PlaylistInspector } from "../src/components/PlaylistInspector";
import { AnnouncerProvider } from "../src/ui/announcer";
import {
  SHORT_MAX_HEIGHT,
  financeShellMetrics,
  shellDensityFor,
} from "../src/finance/shell-metrics";

const h = React.createElement;
const START = "2026-11-07";

let root: Root | null = null;
let container: HTMLElement | null = null;

function mount(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

// Every test starts from the same world: real timers, no mounted tree (so no
// Escape-stack layer or announcer left behind), no portals, empty storage.
afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.restoreAllMocks();
});

function click(el: Element | null) {
  if (!el) throw new Error("element not found");
  act(() => (el as HTMLElement).click());
}

function key(el: Element, k: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });
}

function typeInto(input: HTMLInputElement, text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function realBridge(doc: FinancialDocument = createDemoFinancialDocument(START)) {
  const core = createPlaylistCore(createFinancialPlaylistState(doc), {
    metrics: FINANCE_PLAYLIST_METRICS,
    stretchEnabled: false,
  });
  return new FinancialBridge(core, doc);
}

function mountBar(
  bridge: FinancialBridge,
  extra: { futures?: Futures | null; plan?: PlanMenuActions; theme?: "light" | "dark"; onToggleTheme?: () => void } = {},
) {
  mount(
    h(
      AnnouncerProvider,
      null,
      h(FinancialSummaryBar, { bridge, onCreateDraft: vi.fn(), ...extra }),
    ),
  );
}

const header = () => document.querySelector<HTMLElement>("header.fin-summary")!;
const verdictButton = () => document.querySelector<HTMLButtonElement>(".fin-verdict__main")!;
const metric = (key: string) => document.querySelector<HTMLElement>(`[data-metric="${key}"]`)!;
const toast = () => document.querySelector(".fin-toast")?.textContent ?? null;
const shortDate = (iso: string) => formatDateShort(iso);

// --- pure: the verdict and the exclusions -------------------------------------

describe("UX-14: the verdict says whether it is enough and the first day it is not", () => {
  it("demo year: goes red on 27 nov → 'Te alcanza hasta el 26 nov' · 'El 27 nov te faltan $1,292'", () => {
    const doc = createDemoFinancialDocument(START);
    const projection = projectFinancialDocument(doc);
    const warnings = findLiquidityWarnings(projection, doc.minimumCashReserve);
    const red = firstNegativeDate(projection)!;
    expect(red).not.toBeNull();
    const verdict = computeVerdict(projection, warnings, doc.horizonMonths, shortDate);
    expect(verdict.tone).toBe("negative");
    expect(verdict.date).toBe(red);
    expect(verdict.title).toMatch(/^Te alcanza hasta el \d{1,2} [a-z]{3}$/);
    if (projection.minimumCash.date === red) {
      expect(verdict.detail).toBe(
        `El ${shortDate(red)} te faltan ${formatMoneyWhole(-projection.minimumCash.cash)}`,
      );
    }
  });

  it("never red but under the reserve → 'Te alcanza, justo' + the day it dips", () => {
    const doc = { ...createDemoFinancialDocument(START), initialCash: 15000 };
    const projection = projectFinancialDocument(doc);
    const warnings = findLiquidityWarnings(projection, doc.minimumCashReserve);
    expect(firstNegativeDate(projection)).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
    const verdict = computeVerdict(projection, warnings, 12, shortDate);
    expect(verdict.tone).toBe("low");
    expect(verdict.title).toBe("Te alcanza, justo");
    expect(verdict.detail).toBe(`El ${shortDate(warnings[0]!.startDate)} bajas de tu reserva`);
  });

  it("plenty → 'Te alcanza todo el año' · 'Lo más bajo: …'", () => {
    const doc = { ...createDemoFinancialDocument(START), initialCash: 200000 };
    const projection = projectFinancialDocument(doc);
    const verdict = computeVerdict(projection, [], 12, shortDate);
    expect(verdict.tone).toBe("ok");
    expect(verdict.title).toBe("Te alcanza todo el año");
    expect(verdict.detail).toContain("Lo más bajo:");
  });

  it("a negative starting cash: 'Hoy no te alcanza'", () => {
    const doc = { ...createDemoFinancialDocument(START), initialCash: -100 };
    const projection = projectFinancialDocument(doc);
    const verdict = computeVerdict(projection, [], 12, shortDate);
    expect(verdict.title).toBe("Hoy no te alcanza");
    expect(verdict.date).toBe(projection.startDate);
  });
});

describe("UX-03: 'Deuda hoy' is the real debt; what is excluded is said", () => {
  it("with nothing excluded the real debt is the projection's", () => {
    const doc = createDemoFinancialDocument(START);
    expect(realInitialDebt(doc)).toBe(projectFinancialDocument(doc).initialDebt);
    expect(excludedItems(doc)).toEqual([]);
  });

  it("an excluded card still counts in the real debt, not in the simulated one", () => {
    const base = createDemoFinancialDocument(START);
    const doc = {
      ...base,
      items: base.items.map((item) => (item.id === "fin-nu" ? { ...item, enabled: false } : item)),
    };
    const simulated = projectFinancialDocument(doc).initialDebt;
    expect(realInitialDebt(doc)).toBe(projectFinancialDocument(base).initialDebt);
    expect(realInitialDebt(doc)).toBeGreaterThan(simulated);
    expect(exclusionLabel(excludedItems(doc))).toBe("Nu");
    expect(exclusionLabel([...excludedItems(doc), ...excludedItems(doc)])).toBe("2 objetos");
  });
});

// --- the header ----------------------------------------------------------------

describe("UX-14/56/58: the header answers first and reads in order", () => {
  it("is the 'Resumen de tu plan' region; the plan menu, then the verdict, come first", () => {
    mountBar(realBridge());
    expect(header().getAttribute("role")).toBe("region");
    expect(header().getAttribute("aria-label")).toBe("Resumen de tu plan");
    const focusables = [
      ...header().querySelectorAll<HTMLElement>("button, input, select, [tabindex]"),
    ].filter((el) => el.tabIndex >= 0 && !el.closest("[inert]"));
    expect(focusables[0]!.textContent).toContain("Mi plan");
    expect(focusables[1]).toBe(verdictButton());
    expect(verdictButton().textContent).toMatch(/^Te alcanza hasta el/);
  });

  it("'Tu punto más bajo' (not 'Mínimo proyectado'); informative numbers are disclosure buttons", () => {
    mountBar(realBridge());
    expect(header().textContent).not.toContain("Mínimo proyectado");
    expect(metric("lowest").textContent).toContain("Tu punto más bajo");
    for (const k of ["horizon", "debt"]) {
      expect(metric(k).tagName).toBe("BUTTON");
      expect(metric(k).getAttribute("aria-expanded")).toBe("false");
    }
    // No empty Tab stops (UX-56): every number is a button or holds fields.
    expect(header().querySelectorAll('div[tabindex="0"]').length).toBe(0);
  });

  it("closed descriptions are hidden (described-by, never read in the flow)", () => {
    mountBar(realBridge());
    for (const k of ["lowest", "horizon", "debt", "next"]) {
      const id = metric(k).getAttribute("aria-describedby")!;
      expect(document.getElementById(id)!.hidden).toBe(true);
    }
    expect(header().querySelectorAll(".fin-sr-only").length).toBeLessThanOrEqual(6);
  });

  it("the help card can be hovered: leaving the number keeps it during the grace period", () => {
    vi.useFakeTimers();
    mountBar(realBridge());
    const lowest = metric("lowest");
    act(() => lowest.focus());
    const tip = () => document.querySelector<HTMLElement>('[role="tooltip"].fin-help');
    expect(tip()).not.toBeNull();
    // The pointer goes from the number onto the card (React reads enter /
    // leave from the mouseout's relatedTarget).
    act(() => lowest.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: tip() })));
    act(() => vi.advanceTimersByTime(HIDE_GRACE_MS + 50));
    expect(tip()).not.toBeNull();
    act(() => tip()!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
    act(() => vi.advanceTimersByTime(HIDE_GRACE_MS + 50));
    expect(tip()).toBeNull();
  });
});

describe("UX-26/57: alerts — one stable button, full names, the note outside the menu", () => {
  it("the chip is the same <button> with and without alerts", () => {
    const bridge = realBridge();
    mountBar(bridge);
    const chip = document.querySelector("button.fin-summary__chip")!;
    expect(chip.closest(".fin-verdict")).not.toBeNull();
    act(() => bridge.setInitialCash(500000));
    const after = document.querySelector("button.fin-summary__chip")!;
    expect(after).toBe(chip);
    expect(after.textContent).toContain("Sin alertas");
    expect(after.getAttribute("aria-disabled")).toBe("true");
  });

  it("each alert says date, amount and cause; the menu holds only menuitems", () => {
    const bridge = realBridge();
    mountBar(bridge);
    click(document.querySelector("button.fin-summary__chip"));
    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="Alertas de liquidez"]')!;
    for (const child of Array.from(menu.children)) {
      expect(child.getAttribute("role")).toBe("menuitem");
    }
    const note = document.getElementById(menu.getAttribute("aria-describedby")!)!;
    expect(note.textContent).toMatch(/^Cuando tu caja/);
    const first = menu.querySelector('[role="menuitem"]')!;
    const warning = bridge.getWarnings()[0]!;
    expect(first.textContent).toContain(`lo causa ${warning.name}`);
    expect(first.textContent).toContain("Ver arreglos");
    expect(first.hasAttribute("title")).toBe(false);
  });
});

describe("UX-03: excluded items — chip, real debt, (simulación), one-step reactivate", () => {
  it("muting Nu shows 'Sin Nu', keeps 'Deuda hoy' real and marks the simulation", () => {
    const bridge = realBridge();
    mountBar(bridge);
    const realDebt = bridge.getProjection().initialDebt;
    expect(document.querySelector(".fin-exclusion")).toBeNull();
    act(() => bridge.core.toggleClipMute("fin-nu"));
    const chip = document.querySelector<HTMLElement>(".fin-exclusion")!;
    expect(chip.textContent).toContain("Sin Nu");
    expect(chip.getAttribute("aria-label")).toBe("Fuera del cálculo: Nu");
    expect(metric("debt").querySelector(".fin-summary__value")!.textContent).toBe(
      formatMoneyWhole(realDebt),
    );
    expect(metric("debt").textContent).toContain(
      `sin Nu: ${formatMoneyWhole(bridge.getProjection().initialDebt)}`,
    );
    expect(metric("lowest").textContent).toContain("(simulación)");
    expect(verdictButton().textContent).toContain("(simulación)");
  });

  it("a soloed row excludes the rest; 'Reactivar todo' is one undo step", () => {
    const bridge = realBridge();
    mountBar(bridge);
    const before = bridge.getProjection().finalCash;
    const state = bridge.core.getState();
    const nuRow = state.tracks.findIndex((t) => t.id === state.clips.find((c) => c.id === "fin-nu")!.trackId);
    act(() => bridge.core.toggleClipMute("fin-sueldo"));
    act(() => bridge.core.toggleTrackSolo(nuRow));
    expect(excludedItems(bridge.getDocument()).length).toBeGreaterThan(1);
    expect(document.querySelector(".fin-exclusion")!.textContent).toMatch(/Sin \d+ objetos/);
    click([...document.querySelectorAll(".fin-exclusion__button")].find((b) => b.textContent === "Reactivar todo")!);
    expect(excludedItems(bridge.getDocument())).toEqual([]);
    expect(bridge.core.getState().tracks.some((t) => t.soloed)).toBe(false);
    expect(bridge.getProjection().finalCash).toBe(before);
    expect(document.querySelector(".fin-exclusion")).toBeNull();
    expect(toast()).toMatch(/^Reactivados: \d+ objetos\./);
    // One undo brings every exclusion back.
    act(() => bridge.core.undo());
    expect(excludedItems(bridge.getDocument()).length).toBeGreaterThan(1);
    expect(bridge.core.getState().tracks[nuRow]!.soloed).toBe(true);
  });

  it("'Ver' selects the excluded items", () => {
    const bridge = realBridge();
    mountBar(bridge);
    act(() => bridge.core.toggleClipMute("fin-nu"));
    click([...document.querySelectorAll(".fin-exclusion__button")].find((b) => b.textContent === "Ver")!);
    expect(bridge.core.getState().selection.clipIds).toEqual(["fin-nu"]);
    expect(toast()).toContain("Seleccionado: Nu");
  });
});

describe("UX-18: the starting point looks editable, errors are visible, changes echo", () => {
  const cash = () => document.querySelector<HTMLInputElement>('input[aria-label="Liquidez hoy"]')!;

  it("both fields sit in the 'Punto de partida' group with a pencil", () => {
    mountBar(realBridge());
    const group = metric("start");
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("Punto de partida");
    expect(group.querySelectorAll("input").length).toBe(2);
    expect(group.querySelectorAll(".fin-summary__pencil").length).toBe(2);
  });

  it("'12 mil' is a valid amount; the change is announced with Deshacer", () => {
    const bridge = realBridge();
    mountBar(bridge);
    act(() => cash().focus());
    typeInto(cash(), "15 mil");
    key(cash(), "Enter");
    expect(bridge.getDocument().initialCash).toBe(15000);
    expect(toast()).toMatch(/^Liquidez hoy: \$12,000 → \$15,000\. /);
    click(document.querySelector(".fin-toast__undo"));
    expect(bridge.getDocument().initialCash).toBe(12000);
  });

  it("an invalid amount shows a visible note under the field (not only for screen readers)", () => {
    const bridge = realBridge();
    mountBar(bridge);
    act(() => cash().focus());
    typeInto(cash(), "doce");
    key(cash(), "Enter");
    const note = document.querySelector<HTMLElement>(".fin-inline-error")!;
    expect(note).not.toBeNull();
    expect(note.closest(".fin-sr-only")).toBeNull();
    expect(note.querySelector('[role="alert"]')!.id).toBe(cash().getAttribute("aria-describedby"));
    expect(note.textContent).toContain("Liquidez hoy:");
    expect(note.textContent).toContain("12 mil");
    expect(cash().value).toBe("doce");
    // Escape (a layer of the Escape stack while editing) brings $12,000 back.
    act(() => {
      cash().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(document.querySelector(".fin-inline-error")).toBeNull();
    expect(bridge.getDocument().initialCash).toBe(12000);
  });
});

describe("UX-48: 'Mi plan ▾' holds the plan's global actions", () => {
  it("Armar mi año · Revisar lo que pasó · Tema · Reiniciar con el ejemplo…", () => {
    const plan = { onBuildYear: vi.fn(), onReviewRec: null, onReset: vi.fn() };
    const onToggleTheme = vi.fn();
    mountBar(realBridge(), { plan, theme: "light", onToggleTheme });
    const trigger = document.querySelector<HTMLButtonElement>(".fin-plan__trigger")!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    click(trigger);
    const items = [...document.querySelectorAll<HTMLElement>('[aria-label="Mi plan"] [role="menuitem"]')];
    expect(items.map((i) => i.querySelector(".fin-new__label")!.textContent)).toEqual([
      "Armar mi año",
      "Revisar lo que pasó",
      "Tema oscuro",
      "Reiniciar con el ejemplo…",
    ]);
    expect(document.activeElement).toBe(items[0]);
    // Nothing pending: disabled, does nothing.
    expect(items[1]!.getAttribute("aria-disabled")).toBe("true");
    click(items[1]!);
    click(items[2]!);
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
    click(trigger);
    click(document.querySelectorAll('[aria-label="Mi plan"] [role="menuitem"]')[3]!);
    expect(plan.onReset).toHaveBeenCalledTimes(1);
  });

  it("'Revisar lo que pasó' opens Rec when one is pending", () => {
    const onReviewRec = vi.fn();
    mountBar(realBridge(), { plan: { onReviewRec } });
    click(document.querySelector(".fin-plan__trigger"));
    const review = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) =>
      i.textContent!.includes("Revisar lo que pasó"),
    )!;
    expect(review.getAttribute("aria-disabled")).toBeNull();
    click(review);
    expect(onReviewRec).toHaveBeenCalledTimes(1);
  });
});

describe("UX-19: outside the main plan it shows, and going back is one click", () => {
  it("strip + 'en esta rama' in the verdict; 'Volver al plan principal'", () => {
    const bridge = realBridge();
    const futures = new Futures(bridge);
    mount(
      h(
        AnnouncerProvider,
        null,
        h(FinancialSummaryBar, { bridge, onCreateDraft: vi.fn(), futures }),
        h(FutureStrip, { futures }),
      ),
    );
    expect(document.querySelector(".fin-branch-strip")).toBeNull();
    expect(verdictButton().textContent).not.toContain("en esta rama");
    act(() => {
      futures.fork(START, "Comprar la laptop");
    });
    const strip = document.querySelector<HTMLElement>(".fin-branch-strip")!;
    expect(strip.textContent).toContain("Estás en Comprar la laptop (hipótesis)");
    expect(verdictButton().textContent).toContain("en esta rama");
    click([...strip.querySelectorAll("button")].find((b) => b.textContent === "Volver al plan principal")!);
    expect(futures.activeBranch().id).toBe("main");
    expect(document.querySelector(".fin-branch-strip")).toBeNull();
  });
});

// --- the inspector -----------------------------------------------------------------

describe("UX-27/58: the inspector — one toggle, focus in and back, in Spanish", () => {
  it("the same toggle opens and closes it; Escape inside closes it and returns the focus", () => {
    const bridge = realBridge();
    mount(h(PlaylistInspector, { core: bridge.core }));
    const toggle = document.querySelector<HTMLButtonElement>(".playlist-inspector__toggle")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle.focus());
    click(toggle);
    expect(document.querySelector(".playlist-inspector__toggle")).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panel = document.querySelector<HTMLElement>(".playlist-inspector__panel")!;
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(panel.textContent).toContain("Ningún objeto seleccionado");
    expect(panel.querySelector("h2")!.textContent).toBe("Inspector");
    key(panel, "Escape");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("no English left in its texts", () => {
    const bridge = realBridge();
    act(() => bridge.core.setClipSelection(["fin-nu"]));
    mount(h(PlaylistInspector, { core: bridge.core }));
    click(document.querySelector(".playlist-inspector__toggle"));
    const text = document.querySelector(".playlist-inspector")!.textContent!;
    for (const word of ["Label", "Muted", "Content offset", "Stretch ratio", "clip", "Mute", "Group"]) {
      expect(text).not.toContain(word);
    }
  });
});

// --- navigation: the range in words (UX-46) ---------------------------------------

describe("UX-46: the visible range has a name, never '118 d'", () => {
  it("words for any span", () => {
    expect(describeSpanDays(1)).toBe("1 día");
    expect(describeSpanDays(9)).toBe("9 días");
    expect(describeSpanDays(21)).toBe("≈ 3 semanas");
    expect(describeSpanDays(66)).toBe("≈ 2 meses");
    expect(describeSpanDays(118)).toBe("≈ 4 meses");
    expect(describeSpanDays(365)).toBe("≈ 1 año");
    expect(describeSpanDays(548)).toBe("≈ 1.5 años");
    for (const days of [11, 51, 66, 118, 162]) expect(describeSpanDays(days)).not.toMatch(/\bd$/);
  });

  it("'0' / Todo (the whole plan from its first day) is 'all', not 'Año'", () => {
    expect(matchSpan(0, 370, 365)).toBe("all");
    expect(matchSpan(10, 376, 365)).toBe("year");
    expect(matchSpan(0, 31, 365)).toBe("month");
    expect(matchSpan(0, 50, 365)).toBe("");
  });
});

// --- layout at 200 % / 400 % (UX-29) ---------------------------------------------------

describe("UX-29: very short windows fold the money lane", () => {
  it("≤ 500 px is 'short': a ~title-row lane and slim rows; taller keep theirs", () => {
    expect(shellDensityFor(SHORT_MAX_HEIGHT)).toBe("short");
    expect(shellDensityFor(360)).toBe("short");
    expect(shellDensityFor(SHORT_MAX_HEIGHT + 1)).toBe("tight");
    const metrics = financeShellMetrics("short");
    expect(metrics.overviewLaneHeight).toBeLessThanOrEqual(48);
    // 640×360 (1280×720 at 200 %): 360 − header 44 − gaps 12 − banner 40 −
    // ruler − lane − scrollbar leaves at least three whole rows.
    const rowsArea = 360 - 44 - 12 - 40 - metrics.rulerHeight - metrics.overviewLaneHeight - metrics.scrollbarSize;
    expect(rowsArea / metrics.trackHeight).toBeGreaterThanOrEqual(3);
  });
});

// --- design tokens (UX-59 / UX-63) --------------------------------------------------------

describe("UX-59/63: tokens meet their contrast in both themes", () => {
  const css = readFileSync(join(__dirname, "../src/styles/globals.css"), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("\n}", start));
  };
  const light = block(':root[data-theme="light"]');
  const dark = block(':root[data-theme="dark"]');
  const token = (src: string, name: string, fallback?: string): string => {
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(src);
    const value = match ? match[1]!.trim() : fallback!;
    const ref = /^var\((--[\w-]+)\)$/.exec(value);
    return ref ? token(src, ref[1]!, token(light, ref[1]!)) : value;
  };
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  for (const [name, src] of [["claro", light], ["oscuro", dark]] as const) {
    it(`${name}: placeholder ≥ 4.5:1 on every field surface; negative figures and the ring`, () => {
      const t = (n: string) => token(src, n, token(light, n));
      for (const surface of ["--surface", "--surface-2", "--surface-3", "--raised"]) {
        expect(ratio(t("--placeholder"), t(surface))).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(t("--fin-negative-text"), t("--surface"))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t("--muted"), t("--raised"))).toBeGreaterThanOrEqual(4.5); // calendar's outside days
      expect(ratio(t("--focus-ring-color"), t("--surface"))).toBeGreaterThanOrEqual(3);
      expect(ratio(t("--focus-ring-color"), t("--surface-2"))).toBeGreaterThanOrEqual(3);
    });
  }

  it("placeholders, outside days and the '/' bar use them", () => {
    expect(css).toMatch(/::placeholder\s*{\s*color: var\(--placeholder\);\s*opacity: 1;/);
    expect(css).toMatch(/\.fin-cal__day\[data-outside\]\s*{\s*opacity: 1;/);
    expect(css).toMatch(/\.fin-command:focus-within\s*{[^}]*--focus-ring-color/);
  });
});
