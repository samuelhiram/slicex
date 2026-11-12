// @vitest-environment jsdom
// PlaylistShell wiring with the Pixi renderer / interaction controller
// mocked out (no WebGL in jsdom) and an in-memory bridge: the real
// PlaylistCore, the real React tree, the real globals.css. Regression tests
// for SYNC-12, canvas-renderer-no-invalidate-for-providers (shell side),
// react-4 (shell side), react-8 and react-9, plus the Ola 1 wiring: the
// four render-loop providers, the money lane metrics and the finance-native
// tool row.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FinancialItem } from "@slicex/core";
import type {
  PlaylistCore,
  PlaylistCoreOptions,
  PlaylistInteractionOptions,
  PlaylistRendererCallbacks,
} from "@slicex/canvas";
import { FINANCE_PLAYLIST_METRICS } from "../src/finance/mapping";

interface FakeRenderer {
  destroy: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
  setTheme: ReturnType<typeof vi.fn>;
  refreshFonts: ReturnType<typeof vi.fn>;
}

interface ShellBridge {
  core: PlaylistCore;
  emit(): void;
  listenerCount(): number;
  getDocument(): { items: FinancialItem[] };
  addItem: ReturnType<typeof vi.fn>;
  getClipContent: ReturnType<typeof vi.fn>;
  getOverviewData: ReturnType<typeof vi.fn>;
  getDragAnnotation: ReturnType<typeof vi.fn>;
  getTrackMeta: ReturnType<typeof vi.fn>;
}

const hoisted = vi.hoisted(() => ({
  renderers: [] as FakeRenderer[],
  rendererCallbacks: [] as Array<PlaylistRendererCallbacks | undefined>,
  coreOptions: [] as Array<PlaylistCoreOptions | undefined>,
  bridges: [] as ShellBridge[],
  interactionOptions: [] as Array<PlaylistInteractionOptions | undefined>,
}));

vi.mock("@slicex/canvas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@slicex/canvas")>();
  return {
    ...actual,
    createPlaylistCore: (
      ...args: Parameters<typeof actual.createPlaylistCore>
    ) => {
      hoisted.coreOptions.push(args[1]);
      return actual.createPlaylistCore(...args);
    },
    createPlaylistInteractionController: (
      _host: HTMLElement,
      _core: PlaylistCore,
      options?: PlaylistInteractionOptions,
    ) => {
      hoisted.interactionOptions.push(options);
      return { destroy() {} };
    },
    createPlaylistRenderer: (
      _host: HTMLElement,
      _core: PlaylistCore,
      callbacks?: PlaylistRendererCallbacks,
    ) => {
      const renderer: FakeRenderer = {
        destroy: vi.fn(),
        invalidate: vi.fn(),
        setTheme: vi.fn(),
        refreshFonts: vi.fn(),
      };
      hoisted.renderers.push(renderer);
      hoisted.rendererCallbacks.push(callbacks);
      return renderer;
    },
  };
});

// In-memory stand-in for FinancialBridge (the real one is covered by
// financial-bridge.spec.ts): same API, document kept in memory.
vi.mock("../src/finance/financial-bridge", async () => {
  const fin = await import("@slicex/core");
  type Doc = import("@slicex/core").FinancialDocument;
  type Item = import("@slicex/core").FinancialItem;
  class FinancialBridge {
    readonly core: PlaylistCore;
    private doc: Doc;
    private projection: import("@slicex/core").FinancialProjection;
    private revision = 0;
    private readonly listeners = new Set<() => void>();
    readonly addItem = vi.fn((item: Item) => {
      this.commit({ ...this.doc, items: [...this.doc.items, item] });
      return item.id;
    });
    constructor(core: PlaylistCore, doc: Doc) {
      this.core = core;
      this.doc = doc;
      this.projection = fin.projectFinancialDocument(doc);
      hoisted.bridges.push(this as unknown as ShellBridge);
    }
    private commit(doc: Doc) {
      this.doc = doc;
      this.projection = fin.projectFinancialDocument(doc);
      this.emit();
    }
    emit() {
      this.revision += 1;
      for (const l of [...this.listeners]) l();
    }
    listenerCount() {
      return this.listeners.size;
    }
    getRevision = () => this.revision;
    subscribe = (listener: () => void) => {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    };
    getDocument() {
      return this.doc;
    }
    getProjection() {
      return this.projection;
    }
    getItem(id: string) {
      return this.doc.items.find((item) => item.id === id) ?? null;
    }
    replaceItem() {
      return true;
    }
    deleteItem() {
      return true;
    }
    isItemLocked() {
      return false;
    }
    createDraftItem(kind: import("@slicex/core").FinancialItemKind) {
      return fin.createDefaultFinancialItem(kind, `draft-${kind}`, this.doc.startDate, this.doc);
    }
    setInitialCash() {}
    setMinimumCashReserve() {}
    dateAtBeat(beat: number) {
      return fin.addDays(this.doc.startDate, Math.floor(beat));
    }
    beatAtDate(date: string) {
      return fin.diffDays(this.doc.startDate, date);
    }
    snapshotAt(date: string) {
      return fin.snapshotAt(this.projection, date);
    }
    nextPaymentAfter(date: string) {
      return fin.nextPayment(this.projection, date);
    }
    getWarnings() {
      return fin.findLiquidityWarnings(this.projection, this.doc.minimumCashReserve);
    }
    getClipDetail() {
      return null;
    }
    getClipSparkline() {
      return null;
    }
    // One stable object each, like the real cached providers.
    private readonly overview: import("@slicex/canvas").PlaylistOverviewData = {
      title: "Cash",
      primary: { initial: 0, beats: [], values: [] },
      thresholds: [],
      annotations: [],
    };
    private readonly content: import("@slicex/canvas").PlaylistClipContent = {
      kind: "events",
      beats: [3],
      values: [1],
    };
    private readonly annotation: import("@slicex/canvas").PlaylistDragAnnotation = {
      text: "Mín +$1",
      tone: "positive",
    };
    private readonly meta: import("@slicex/canvas").PlaylistTrackMeta = {
      subtitle: "+$1/año",
      meter: 0.5,
    };
    readonly getClipContent = vi.fn((_clipId: string) => this.content);
    readonly getOverviewData = vi.fn(() => this.overview);
    readonly getDragAnnotation = vi.fn(() => this.annotation);
    readonly getTrackMeta = vi.fn((_trackId: string) => this.meta);
    // Waves 2–4 (covered for real in finance-waves.spec.ts).
    isHighlighted() {
      return false;
    }
    canExtend() {
      return true;
    }
    getDayDetail() {
      return null;
    }
    getTrackLayout() {
      return { tracks: [], placement: {} };
    }
    levelDrag() {
      return null;
    }
    valleyAt() {
      return null;
    }
    applyValleyFix() {
      return false;
    }
    setHighlight() {}
    private preview: unknown = null;
    setPreview(preview: unknown) {
      this.preview = preview;
    }
    getPreview() {
      return this.preview;
    }
    getPreviewEffect() {
      return null;
    }
    private comparison: Doc | null = null;
    setComparison(doc: Doc | null) {
      this.comparison = doc;
    }
    getComparison() {
      return this.comparison;
    }
    animateFrom() {}
    isAnimating() {
      return false;
    }
    exportSession() {
      return { session: this.core.saveSession(), doc: this.doc };
    }
    importSession(session: { doc: Doc }) {
      this.commit(session.doc);
    }
    readonly loadDocument = vi.fn((doc: Doc) => this.commit(doc));
    destroy() {
      this.listeners.clear();
    }
  }
  return { FinancialBridge };
});

import { PlaylistShell } from "../src/components/PlaylistShell";

let root: Root | null = null;
let container: HTMLElement | null = null;

async function mountShell() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(React.createElement(PlaylistShell)));
  // The shell builds the core / bridge one animation frame after mount.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  const bridge = hoisted.bridges.at(-1);
  if (!bridge || !document.querySelector(".fin-summary")) {
    throw new Error("PlaylistShell did not initialise");
  }
  return { bridge, renderer: hoisted.renderers.at(-1)! };
}

function unmountShell() {
  act(() => root?.unmount());
  root = null;
}

beforeEach(() => {
  // The shell loads / autosaves the plan in localStorage: start clean.
  localStorage.clear();
  hoisted.renderers.length = 0;
  hoisted.rendererCallbacks.length = 0;
  hoisted.coreOptions.length = 0;
  hoisted.bridges.length = 0;
  hoisted.interactionOptions.length = 0;
});

function loadGlobalsCss() {
  const css = readFileSync(join(__dirname, "../src/styles/globals.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

// The shell picks its canvas density from the window height at mount.
const JSDOM_INNER_HEIGHT = window.innerHeight;

function withWindowHeight(height: number) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

afterEach(() => {
  if (root) unmountShell();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  withWindowHeight(JSDOM_INNER_HEIGHT);
});

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === text,
    ) ?? null
  );
}

function click(element: Element | null) {
  if (!element) throw new Error("element not found");
  act(() => (element as HTMLElement).click());
}

function pressEscape() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
}

// "Nuevo" menu → kind (the header's create flow).
function newTrigger(): HTMLButtonElement {
  const trigger = document.querySelector<HTMLButtonElement>(".fin-new__trigger");
  if (!trigger) throw new Error("Nuevo trigger not found");
  return trigger;
}

function pickNew(kind: string) {
  click(newTrigger());
  click(document.querySelector(`.fin-new__item[data-kind="${kind}"]`));
}

const stage = () => document.querySelector(".playlist-shell__stage")!;
const toolRow = () => document.querySelector(".playlist-shell__bar")!;
const summary = () => document.querySelector(".fin-summary")!;
const dialog = () => document.querySelector<HTMLElement>(".fin-editor");
/** The editor's name: its title heading (aria-labelledby, UX-58). */
const dialogName = () => {
  const id = dialog()?.getAttribute("aria-labelledby");
  return id ? (document.getElementById(id)?.textContent ?? null) : null;
};
/** UX-30: a new item's amount is asked, never assumed — typed like a user. */
function typeAmount(text: string) {
  const input = document.querySelector<HTMLInputElement>('.fin-editor [data-field-path="amount"] input')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("SYNC-12: no time-stretch on the finance playlist", () => {
  it("creates the core with stretchEnabled:false and hides the Str button", async () => {
    const { bridge } = await mountShell();
    expect(hoisted.coreOptions[0]?.stretchEnabled).toBe(false);
    expect(bridge.core.stretchEnabled).toBe(false);
    const toolLabels = [
      ...document.querySelectorAll(".playlist-shell__toolbar .playlist-shell__tool-label"),
    ].map((el) => el.textContent);
    expect(toolLabels).toContain("Seleccionar");
    expect(toolLabels).not.toContain("Str");
    expect(document.querySelector('[data-tool="stretch"]')).toBeNull();
  });
});

describe("canvas-renderer-no-invalidate-for-providers: bridge changes repaint", () => {
  it("a bridge notify invalidates the renderer; unmount unsubscribes", async () => {
    const { bridge, renderer } = await mountShell();
    renderer.invalidate.mockClear();
    act(() => bridge.emit());
    expect(renderer.invalidate).toHaveBeenCalledTimes(1);
    const listenersWhileMounted = bridge.listenerCount();
    unmountShell();
    expect(bridge.listenerCount()).toBeLessThan(listenersWhileMounted);
    bridge.emit();
    expect(renderer.invalidate).toHaveBeenCalledTimes(1);
  });
});

describe("react-4 (shell): 'Nuevo → X' opens a create-mode editor on a draft", () => {
  it("Cancelar adds nothing; Guardar adds once", async () => {
    const { bridge } = await mountShell();
    const before = bridge.getDocument().items.length;
    pickNew("income");
    expect(dialog()?.dataset.mode).toBe("create");
    expect(dialogName()).toBe("Nuevo Ingreso");
    expect(bridge.addItem).not.toHaveBeenCalled();
    click(buttonByText("Cancelar"));
    expect(dialog()).toBeNull();
    expect(bridge.addItem).not.toHaveBeenCalled();
    expect(bridge.getDocument().items.length).toBe(before);

    pickNew("expense");
    typeAmount("500");
    click(buttonByText("Guardar"));
    expect(dialog()).toBeNull();
    expect(bridge.addItem).toHaveBeenCalledTimes(1);
    expect(bridge.getDocument().items.length).toBe(before + 1);
  });

  it("the pencil on empty space opens a draft for that row; nothing is added until Guardar", async () => {
    const { bridge } = await mountShell();
    const before = bridge.getDocument().items.length;
    const options = hoisted.interactionOptions.at(-1)!;
    expect(options.onCreateRequest).toBeTypeOf("function");
    // The mouse wheel scrolls the rows (Shift + wheel: time).
    expect(options.mouseWheel).toBe("rows");
    // An endless empty row far below: no neighbour, no selection → expense.
    act(() =>
      options.onCreateRequest!({ trackIndex: 40, start: 12, duration: null, templateClipId: null }),
    );
    expect(dialog()?.dataset.mode).toBe("create");
    expect(dialogName()).toBe("Nuevo Gasto");
    expect(bridge.addItem).not.toHaveBeenCalled();
    click(buttonByText("Cancelar"));
    expect(bridge.getDocument().items.length).toBe(before);
    expect(bridge.addItem).not.toHaveBeenCalled();
    // Selected item as template (what FL's pencil would stamp): same kind.
    act(() =>
      options.onCreateRequest!({ trackIndex: 40, start: 12, duration: null, templateClipId: "fin-sueldo" }),
    );
    expect(dialogName()).toBe("Nuevo Ingreso");
    typeAmount("1000");
    click(buttonByText("Guardar"));
    expect(bridge.addItem).toHaveBeenCalledTimes(1);
    expect(bridge.addItem.mock.calls[0]![1]).toEqual({ trackIndex: 40 });
  });

  it("a double-clicked clip opens the editor in edit mode", async () => {
    await mountShell();
    const host = document.querySelector(".playlist-shell__surface")!;
    act(() => {
      host.dispatchEvent(
        new CustomEvent("playlist-clip-open", { detail: { clipId: "fin-gasto" } }),
      );
    });
    expect(dialog()?.dataset.mode).toBe("edit");
    expect(buttonByText("Eliminar")).not.toBeNull();
  });
});

describe("react-8: the shell behind the editor is inert; focus comes back", () => {
  it("'Nuevo → Ingreso': stage + summary inert while open, focus back on 'Nuevo'", async () => {
    await mountShell();
    const add = newTrigger();
    add.focus();
    pickNew("income");
    expect(stage().hasAttribute("inert")).toBe(true);
    expect(summary().hasAttribute("inert")).toBe(true);
    expect(toolRow().hasAttribute("inert")).toBe(true);
    pressEscape();
    expect(dialog()).toBeNull();
    expect(stage().hasAttribute("inert")).toBe(false);
    expect(summary().hasAttribute("inert")).toBe(false);
    expect(toolRow().hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(add);
  });

  it("double-click: focus returns to the canvas host (playlist shortcuts)", async () => {
    await mountShell();
    const host = document.querySelector<HTMLElement>(".playlist-shell__surface")!;
    host.focus();
    act(() => {
      host.dispatchEvent(
        new CustomEvent("playlist-clip-open", { detail: { clipId: "fin-gasto" } }),
      );
    });
    expect(stage().hasAttribute("inert")).toBe(true);
    expect(document.activeElement).not.toBe(host);
    click(buttonByText("Cancelar"));
    expect(document.activeElement).toBe(host);
  });
});

describe("react-9: nothing covers the playhead readout", () => {
  it("sits in the money lane's header cell; the rails open below the lane", async () => {
    loadGlobalsCss();
    await mountShell();
    const readout = document.querySelector<HTMLElement>(".fin-readout")!;
    expect(readout.classList.contains("fin-readout--lane")).toBe(true);
    expect(readout.closest(".playlist-shell__stage")).not.toBeNull();
    expect(readout.closest(".playlist-shell__bar")).toBeNull();
    // Inside the lane band (ruler + lane), which no rail covers.
    const style = getComputedStyle(readout);
    expect(style.position).toBe("absolute");
    expect(style.top).toContain("--pl-ruler-h");
    // UX-47: the open rail is a column BESIDE the stage (it pushes the
    // canvas), so it can never cover the readout or the row headers.
    click(document.querySelector(".fin-side__tab"));
    const rail = document.querySelector<HTMLElement>(".fin-side:not(.fin-side--collapsed)")!;
    expect(rail).not.toBeNull();
    expect(rail.closest(".playlist-shell__stage")).toBeNull();
    expect(rail.closest(".playlist-shell__side-slot")).not.toBeNull();
  });

  it("is compact: weekday date, cash and debt on one line", async () => {
    await mountShell();
    const readout = document.querySelector<HTMLElement>(".fin-readout")!;
    const date = readout.querySelector(".fin-readout__date")!.textContent!;
    expect(date).toMatch(/^(dom|lun|mar|mié|jue|vie|sáb) \d{1,2} [a-z]{3} \d{4}$/);
    expect(readout.querySelectorAll(".fin-readout__cell").length).toBe(2);
  });
});

describe("Ola 1 wiring: providers, money lane, endless tracks", () => {
  it("passes the four new providers to the renderer, delegating to the bridge", async () => {
    const { bridge } = await mountShell();
    const callbacks = hoisted.rendererCallbacks.at(-1)!;
    expect(typeof callbacks.getClipDetail).toBe("function");
    expect(typeof callbacks.getClipSparkline).toBe("function");

    const content = callbacks.getClipContent!("fin-gasto");
    expect(bridge.getClipContent).toHaveBeenLastCalledWith("fin-gasto");
    expect(content).toBe(bridge.getClipContent.mock.results.at(-1)!.value);

    const overview = callbacks.getOverviewData!();
    expect(bridge.getOverviewData).toHaveBeenCalledTimes(1);
    expect(overview).toBe(bridge.getOverviewData.mock.results.at(-1)!.value);
    // Identity passes through: no wrapper object allocated per call.
    expect(callbacks.getOverviewData!()).toBe(overview);

    const annotation = callbacks.getDragAnnotation!();
    expect(bridge.getDragAnnotation).toHaveBeenCalledTimes(1);
    expect(annotation).toBe(bridge.getDragAnnotation.mock.results.at(-1)!.value);

    const meta = callbacks.getTrackMeta!("track-1");
    expect(bridge.getTrackMeta).toHaveBeenLastCalledWith("track-1");
    expect(meta).toBe(bridge.getTrackMeta.mock.results.at(-1)!.value);
  });

  it("creates the core with the 112px money lane and endless tracks (tall window)", async () => {
    withWindowHeight(1000);
    const { bridge } = await mountShell();
    const options = hoisted.coreOptions[0]!;
    // Tracks are endless (FL): empty rows always wait below the items.
    expect(options.virtualTracks).not.toBe(false);
    // Everything else is the finance metrics (weeks as bars, year zoom).
    expect(options.metrics).toEqual({
      ...FINANCE_PLAYLIST_METRICS,
      overviewLaneHeight: 112,
    });
    expect(bridge.core.metrics.overviewLaneHeight).toBe(112);
    // DOM overlays align below ruler + lane through these two variables.
    const shell = document.querySelector<HTMLElement>(".playlist-shell")!;
    expect(shell.dataset.density).toBe("comfortable");
    expect(shell.style.getPropertyValue("--pl-lane-h")).toBe("112px");
    expect(shell.style.getPropertyValue("--pl-ruler-h")).toBe(
      `${FINANCE_PLAYLIST_METRICS.rulerHeight}px`,
    );
  });

  it("a short (laptop) window gets a shorter lane and tighter rows, overlays aligned", async () => {
    withWindowHeight(738);
    const { bridge } = await mountShell();
    const options = hoisted.coreOptions[0]!;
    expect(options.metrics).toEqual({
      ...FINANCE_PLAYLIST_METRICS,
      trackHeight: 60,
      overviewLaneHeight: 96,
    });
    expect(bridge.core.metrics.trackHeight).toBe(60);
    const shell = document.querySelector<HTMLElement>(".playlist-shell")!;
    expect(shell.dataset.density).toBe("compact");
    expect(shell.style.getPropertyValue("--pl-lane-h")).toBe("96px");
  });
});

describe("finance-native toolbar", () => {
  const tools = () => [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".playlist-shell__toolbar .playlist-shell__tool",
    ),
  ];

  it("six Spanish tools with icons and hotkeys; no Paint / Slip / Sng / Rec", async () => {
    await mountShell();
    expect(
      tools().map((b) => [
        b.querySelector(".playlist-shell__tool-label")!.textContent,
        b.querySelector(".playlist-shell__tool-hotkey")!.textContent,
      ]),
    ).toEqual([
      ["Seleccionar", "E"],
      ["Dibujar", "P"],
      // UX-43: words that say what happens to the money (same keys).
      ["Dividir", "C"],
      ["Excluir", "T"],
      ["Borrar", "D"],
      ["Zoom", "Z"],
    ]);
    for (const b of tools()) {
      expect(b.querySelector("svg.playlist-shell__tool-icon")).not.toBeNull();
      expect(b.getAttribute("aria-label")).toBeTruthy();
    }
    const text = document.querySelector(".playlist-shell__toolbar")!.textContent!;
    for (const gone of ["Pnt", "Slp", "Sng", "Pat", "Rec", "Snap", "item"]) {
      expect(text).not.toContain(gone);
    }
    expect(document.querySelector('[data-tool="paint"]')).toBeNull();
    expect(document.querySelector('[data-tool="slip"]')).toBeNull();
  });

  it("a tool button sets the core tool and reflects it (aria-pressed)", async () => {
    const { bridge } = await mountShell();
    const slice = document.querySelector<HTMLButtonElement>('[data-tool="slice"]')!;
    click(slice);
    expect(bridge.core.getState().tool).toBe("slice");
    expect(slice.getAttribute("aria-pressed")).toBe("true");
    expect(slice.dataset.active).toBe("true");
    // Hidden tools still work through the core (hotkeys), just not offered.
    act(() => bridge.core.setTool("paint"));
    expect(tools().every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("'Imán' (UX-17): Cada día / Cada 7 días / Quincenas / Sin imán = beat / bar / axis / none", async () => {
    const { bridge } = await mountShell();
    const select = document.querySelector<HTMLSelectElement>(
      ".playlist-shell__snap-select",
    )!;
    expect(document.querySelector(".playlist-shell__snap-label")!.textContent).toBe("Imán");
    expect([...select.options].map((o) => [o.textContent, o.value])).toEqual([
      ["Cada día", "beat"],
      ["Cada 7 días", "bar"],
      ["Quincenas (1 y 16)", "axis"],
      ["Sin imán", "none"],
    ]);
    expect(select.value).toBe("beat");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.set!;
    for (const mode of ["bar", "axis", "none", "beat"] as const) {
      act(() => {
        setter.call(select, mode);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(bridge.core.getState().snap.mode).toBe(mode);
      expect(select.value).toBe(mode);
    }
    // A mode the toolbar does not offer is shown as "Otro", not misreported.
    act(() => bridge.core.setSnapMode("half-beat"));
    expect(select.value).toBe("half-beat");
    expect(select.selectedOptions[0]?.textContent).toBe("Otro");
  });

  it("a selection chip only for a multi-selection (no permanent counter)", async () => {
    const { bridge } = await mountShell();
    const counter = () => document.querySelector<HTMLElement>(".playlist-shell__counter");
    const n = bridge.core.getState().clips.length;
    expect(n).toBeGreaterThan(1);
    expect(counter()).toBeNull();
    act(() => bridge.core.setClipSelection([bridge.core.getState().clips[0]!.id]));
    expect(counter()).toBeNull();
    act(() => bridge.core.selectAllClips());
    expect(counter()!.querySelector(".playlist-shell__counter-selected")!.textContent).toBe(
      `${n} seleccionados`,
    );
  });

  it("lives in the header card, above the canvas: never over the ruler or the lane", async () => {
    loadGlobalsCss();
    await mountShell();
    const toolbar = document.querySelector<HTMLElement>(".playlist-shell__toolbar")!;
    expect(toolbar.closest(".playlist-shell__stage")).toBeNull();
    expect(toolbar.parentElement).toBe(toolRow());
    expect(getComputedStyle(toolbar).position).not.toBe("absolute");
    expect(getComputedStyle(toolRow()).position).not.toBe("absolute");
    // The tool row is part of the header card; the stage comes right after.
    expect(toolRow().parentElement).toBe(summary());
    const rows = [...document.querySelector(".playlist-shell")!.children].map(
      (el) => el.className,
    );
    // UX-47: the stage sits in the workspace row (beside the analysis rail).
    expect(rows.indexOf("playlist-shell__workspace")).toBe(rows.indexOf("fin-summary") + 1);
    expect(document.querySelector(".playlist-shell__workspace > .playlist-shell__stage")).not.toBeNull();
  });
});

describe("theme: one toggle drives the DOM tokens and the canvas palette", () => {
  it("starts on a theme, passes it to the renderer, toggles both", async () => {
    localStorage.removeItem("slicex.theme");
    await mountShell();
    const callbacks = hoisted.rendererCallbacks.at(-1)!;
    const renderer = hoisted.renderers.at(-1)!;
    const initial = callbacks.theme;
    expect(initial === "light" || initial === "dark").toBe(true);
    expect(document.documentElement.dataset.theme).toBe(initial);
    // UX-48: the theme lives in "Mi plan ▾".
    click(document.querySelector(".fin-plan__trigger"));
    const toggle = document.querySelector<HTMLButtonElement>("[data-theme-toggle]")!;
    click(toggle);
    const next = initial === "dark" ? "light" : "dark";
    expect(document.documentElement.dataset.theme).toBe(next);
    expect(renderer.setTheme).toHaveBeenLastCalledWith(next);
    expect(localStorage.getItem("slicex.theme")).toBe(next);
    click(document.querySelector(".fin-plan__trigger"));
    click(document.querySelector("[data-theme-toggle]"));
    expect(document.documentElement.dataset.theme).toBe(initial);
    expect(renderer.setTheme).toHaveBeenLastCalledWith(initial);
    localStorage.removeItem("slicex.theme");
  });
});
