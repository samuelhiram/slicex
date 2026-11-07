// @vitest-environment jsdom
// PlaylistShell wiring with the Pixi renderer / interaction controller
// mocked out (no WebGL in jsdom) and an in-memory bridge: the real
// PlaylistCore, the real React tree, the real globals.css. Regression tests
// for SYNC-12, canvas-renderer-no-invalidate-for-providers (shell side),
// react-4 (shell side), react-8 and react-9.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FinancialItem } from "@slicex/core";
import type { PlaylistCore, PlaylistCoreOptions } from "@slicex/canvas";

interface FakeRenderer {
  destroy: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
}

interface ShellBridge {
  core: PlaylistCore;
  emit(): void;
  listenerCount(): number;
  getDocument(): { items: FinancialItem[] };
  addItem: ReturnType<typeof vi.fn>;
}

const hoisted = vi.hoisted(() => ({
  renderers: [] as FakeRenderer[],
  coreOptions: [] as Array<PlaylistCoreOptions | undefined>,
  bridges: [] as ShellBridge[],
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
    createPlaylistInteractionController: () => ({ destroy() {} }),
    createPlaylistRenderer: () => {
      const renderer: FakeRenderer = { destroy: vi.fn(), invalidate: vi.fn() };
      hoisted.renderers.push(renderer);
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
  hoisted.renderers.length = 0;
  hoisted.coreOptions.length = 0;
  hoisted.bridges.length = 0;
});

afterEach(() => {
  if (root) unmountShell();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
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

const stage = () => document.querySelector(".playlist-shell__stage")!;
const summary = () => document.querySelector(".fin-summary")!;
const dialog = () => document.querySelector<HTMLElement>(".fin-editor");

describe("SYNC-12: no time-stretch on the finance playlist", () => {
  it("creates the core with stretchEnabled:false and hides the Str button", async () => {
    const { bridge } = await mountShell();
    expect(hoisted.coreOptions[0]?.stretchEnabled).toBe(false);
    expect(bridge.core.stretchEnabled).toBe(false);
    const toolLabels = [
      ...document.querySelectorAll(".playlist-shell__toolbar .playlist-shell__tool-label"),
    ].map((el) => el.textContent);
    expect(toolLabels).toContain("Sel");
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

describe("react-4 (shell): '+ X' opens a create-mode editor on a draft", () => {
  it("Cancelar adds nothing; Guardar adds once", async () => {
    const { bridge } = await mountShell();
    const before = bridge.getDocument().items.length;
    click(buttonByText("+ Ingreso"));
    expect(dialog()?.dataset.mode).toBe("create");
    expect(dialog()?.getAttribute("aria-label")).toBe("Nuevo Ingreso");
    expect(bridge.addItem).not.toHaveBeenCalled();
    click(buttonByText("Cancelar"));
    expect(dialog()).toBeNull();
    expect(bridge.addItem).not.toHaveBeenCalled();
    expect(bridge.getDocument().items.length).toBe(before);

    click(buttonByText("+ Gasto"));
    click(buttonByText("Guardar"));
    expect(dialog()).toBeNull();
    expect(bridge.addItem).toHaveBeenCalledTimes(1);
    expect(bridge.getDocument().items.length).toBe(before + 1);
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
  it("'+ Ingreso': stage + summary inert while open, focus back on the button", async () => {
    await mountShell();
    const add = buttonByText("+ Ingreso")!;
    add.focus();
    click(add);
    expect(stage().hasAttribute("inert")).toBe(true);
    expect(summary().hasAttribute("inert")).toBe(true);
    pressEscape();
    expect(dialog()).toBeNull();
    expect(stage().hasAttribute("inert")).toBe(false);
    expect(summary().hasAttribute("inert")).toBe(false);
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

describe("react-9: the open analysis rail does not cover the playhead readout", () => {
  it("the readout moves right of the 280px rail while it is open", async () => {
    const css = readFileSync(join(__dirname, "../src/styles/globals.css"), "utf8");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    await mountShell();
    const readout = document.querySelector<HTMLElement>(".fin-readout")!;
    const left = () => Number.parseFloat(getComputedStyle(readout).left);
    expect(left()).toBe(156);
    click(document.querySelector('[aria-label="Abrir análisis financiero"]'));
    const rail = document.querySelector<HTMLElement>(".fin-side")!;
    expect(rail.classList.contains("fin-side--collapsed")).toBe(false);
    expect(left()).toBeGreaterThanOrEqual(280);
    click(document.querySelector('[aria-label="Cerrar análisis financiero"]'));
    expect(left()).toBe(156);
  });
});
