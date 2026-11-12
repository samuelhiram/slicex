// @vitest-environment jsdom
// UX audit 2026-11-11 — group V (canvas, tools, visual language), web side:
// the bridge's words and colours, and the shell driven by keyboard only
// (real PlaylistCore, real interaction controller, real FinancialBridge;
// only the Pixi renderer is mocked — no WebGL in jsdom).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createDemoFinancialDocument,
  estimateDebtPayoffs,
  projectFinancialDocument,
  type CreditCardItem,
  type FinancialDocument,
  type FinancialItem,
} from "@slicex/core";
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  createPlaylistCore,
  mixColor,
  type PlaylistCore,
  type PlaylistRendererCallbacks,
} from "@slicex/canvas";
import { FinancialBridge, levelText } from "../src/finance/financial-bridge";
import { createFinancialPlaylistState, beatOf } from "../src/finance/mapping";
import { KIND_ACCENT, KIND_COLORS, derivedRowTitle } from "../src/finance/labels";
import {
  buildClipContents,
  describeItemAt,
  dragAnnotation,
  overviewDomain,
  overviewGuides,
} from "../src/finance/visuals";

const TODAY = "2026-11-11";

// --- contrast helpers (WCAG relative luminance) -----------------------------
const channel = (c: number, shift: number) => {
  const v = ((c >> shift) & 255) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (c: number) =>
  0.2126 * channel(c, 16) + 0.7152 * channel(c, 8) + 0.0722 * channel(c, 0);
const ratio = (a: number, b: number) => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const hex = (value: string) => Number.parseInt(value.slice(1), 16);

describe("UX-10 — kinds tell apart, and their marks read", () => {
  it("every accent / payment mark is ≥ 3:1 on its card and on the canvas, both themes", () => {
    for (const palette of [LIGHT_PALETTE, DARK_PALETTE]) {
      for (const [kind, color] of Object.entries(KIND_COLORS)) {
        const c = hex(color);
        const fill = mixColor(palette.background, c, palette.clipTint);
        expect(ratio(c, fill), `${kind} on its card`).toBeGreaterThanOrEqual(3);
        expect(ratio(c, palette.background), `${kind} on the canvas`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("MSI no longer wears the income's green, and has its own accent shape", () => {
    expect(KIND_COLORS["installment-plan"]).not.toBe(KIND_COLORS.income);
    const hue = (value: string) => {
      const c = hex(value);
      const r = (c >> 16) & 255;
      const g = (c >> 8) & 255;
      const b = c & 255;
      return Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * (180 / Math.PI);
    };
    expect(Math.abs(hue(KIND_COLORS["installment-plan"]) - hue(KIND_COLORS.income))).toBeGreaterThan(60);
    // Without colour (grayscale): a dashed / dotted accent, plus the sign.
    expect(KIND_ACCENT["installment-plan"]).toBe("dashed");
    expect(KIND_ACCENT["card-purchase"]).toBe("dotted");
    expect(KIND_ACCENT.income).toBe("solid");
  });

  it("every outflow starts with '−' (MSI, card purchase), and numbers carry units", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const projection = projectFinancialDocument(doc);
    const msi = doc.items.find((item) => item.kind === "installment-plan")!;
    const card = doc.items.find((item) => item.kind === "credit-card") as CreditCardItem;
    const text = describeItemAt(msi, doc, projection, doc.startDate, new Map());
    expect(text).toMatch(/^−\$[\d,.]+\/mes · \d+ de \d+ pagos$/);
    const purchase: FinancialItem = {
      id: "p",
      kind: "card-purchase",
      name: "Audífonos",
      amount: 800,
      cardId: card.id,
      recurrence: { frequency: "once", startDate: doc.startDate },
    } as FinancialItem;
    expect(describeItemAt(purchase, doc, projection, doc.startDate, new Map())).toBe(
      `−$800 con ${card.name}`,
    );
    expect(levelText(purchase, 900, doc, 800)).toBe(`−$900 con ${card.name} (antes $800)`);
    const cardText = describeItemAt(card, doc, projection, doc.startDate, new Map([[card.id, 30069]]));
    expect(cardText).toMatch(/· tasa [\d.]+%$/);
  });
});

describe("UX-40 — away from today a clip says which day it describes", () => {
  it("'Al 2 mar: debes $X' for debts; today without the date", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const projection = projectFinancialDocument(doc);
    const card = doc.items.find((item) => item.kind === "credit-card")!;
    const debt = new Map([[card.id, 25_513]]);
    expect(describeItemAt(card, doc, projection, doc.startDate, debt)).toMatch(/^Debes \$25,513/);
    expect(describeItemAt(card, doc, projection, "2027-03-02", debt)).toMatch(/^Al 2 mar: debes \$25,513/);
  });
});

describe("UX-41 — a one-day event marks its real day", () => {
  it("point items carry extent 1 (the rest of the block is a tag)", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const contents = buildClipContents(doc, projectFinancialDocument(doc), new Map());
    const gasto = contents.get("fin-gasto");
    expect(gasto?.kind).toBe("events");
    if (gasto?.kind !== "events") throw new Error("events");
    expect(gasto.extent).toBe(1);
    expect(contents.get("fin-sueldo")?.kind === "events" && (contents.get("fin-sueldo") as { extent?: number }).extent).toBeFalsy();
    expect(contents.get("fin-laptop-msi")?.accent).toBe("dashed");
  });
});

describe("UX-11 — the lane: round steps with hysteresis, guides, debt named", () => {
  it("the bound only moves when the data leaves its step", () => {
    const first = overviewDomain(-1292, 96_000, null);
    expect(first).toEqual({ min: -2000, max: 100_000 });
    // A far edit lowers the year's top to $47k: same step, nothing moves.
    expect(overviewDomain(-1292, 47_000, first)).toEqual(first);
    // Below 40% of the bound: a change of step (announced by the guides).
    expect(overviewDomain(-1292, 35_000, first).max).toBe(50_000);
    // Growing past the bound always rescales.
    expect(overviewDomain(-1292, 120_000, first).max).toBe(200_000);
  });

  it("3–4 round guides, away from zero and the reserve", () => {
    const guides = overviewGuides({ min: -2000, max: 100_000 }, 5000, 5000);
    expect(guides.length).toBeGreaterThanOrEqual(2);
    expect(guides.length).toBeLessThanOrEqual(4);
    for (const value of guides) {
      expect(value).not.toBe(0);
      expect(value).not.toBe(5000);
      expect(String(value)).toMatch(/^[125]0*$/);
    }
  });

  it("the time tooltip names the debt; the lane data has a domain and guides", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const core = createPlaylistCore(createFinancialPlaylistState(doc));
    const bridge = new FinancialBridge(core, doc);
    expect(bridge.getDayDetail(0)).toMatch(/^Caja .+\nDeuda \$[\d,]+/);
    const data = bridge.getOverviewData();
    expect(data.domain).toBeDefined();
    expect(data.guides!.length).toBeGreaterThan(0);
    bridge.destroy();
  });
});

describe("UX-13 — the gesture pill on a debt speaks in debt, interest and net", () => {
  it("paying a debt sooner is not 'negative' when the net improves", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const card = doc.items.find((item) => item.id === "fin-nu") as CreditCardItem;
    const faster: FinancialDocument = {
      ...doc,
      items: doc.items.map((item) =>
        item.id === card.id ? { ...card, paymentAmount: (card.paymentAmount ?? card.minimumPayment) * 2 } : item,
      ),
    };
    const base = projectFinancialDocument(doc);
    const after = projectFinancialDocument(faster);
    const cashOnly = dragAnnotation(doc, base, after);
    const debtAware = dragAnnotation(faster, base, after, { debt: true, interestDelta: -1234 });
    expect(debtAware.text).toContain("deuda al horizonte −$");
    expect(debtAware.text).toContain("intereses −$1,234");
    // The cash-only pill would have judged it by the cash minimum.
    expect(cashOnly.text).not.toContain("deuda");
    expect(debtAware.tone).not.toBe("negative");
  });

  it("goal-seek: the goal, the result and the payoff before", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const core = createPlaylistCore(createFinancialPlaylistState(doc));
    const bridge = new FinancialBridge(core, doc);
    const clip = () => core.getState().clips.find((c) => c.id === "fin-nu")!;
    const before = estimateDebtPayoffs(bridge.getDocument()).get("fin-nu")!.payoffDate!;
    core.beginGesture();
    const end = Math.min(clip().start + clip().duration, beatOf(doc, before)) - 60;
    core.resizeClip("fin-nu", "right", end);
    const pill = bridge.getDragAnnotation()!;
    expect(pill.text).toMatch(/^Meta: \d{1,2} [a-z]{3} → Libre en [a-z]{3} \d{4} \(antes [a-z]{3} \d{4}\)/);
    expect(pill.text).toContain("intereses −$");
    expect(pill.tone).toBe("positive");
    core.endGesture();
    bridge.destroy();
  });

  it("shortening a recurring item counts its payments: 'N pagos (antes M)'", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const core = createPlaylistCore(createFinancialPlaylistState(doc));
    const bridge = new FinancialBridge(core, doc);
    const sueldo = core.getState().clips.find((c) => c.id === "fin-sueldo")!;
    core.beginGesture();
    core.resizeClip("fin-sueldo", "right", sueldo.start + 120);
    expect(bridge.getDragAnnotation()!.text).toMatch(/^\d+ pagos \(antes \d+\) · /);
    core.endGesture();
    bridge.destroy();
  });
});

describe("UX-25 — the info card's lines (cached per revision and day)", () => {
  it("kind and amount with cadence, next payment, how it ends", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const core = createPlaylistCore(createFinancialPlaylistState(doc));
    const bridge = new FinancialBridge(core, doc);
    const info = bridge.getClipInfo("fin-sueldo")!;
    expect(info.split("\n")[0]).toMatch(/^Ingreso · \+\$[\d,]+ cada/);
    expect(info).toMatch(/Próximo: \d{1,2} [a-z]{3} · \+\$/);
    expect(info).toMatch(/Sin fecha de fin|Hasta el /);
    expect(bridge.getClipInfo("fin-sueldo")).toBe(info); // same string
    const nu = bridge.getClipInfo("fin-nu")!;
    expect(nu).toMatch(/Debes \$[\d,]+/);
    expect(nu).toMatch(/Libre en|No se liquida/);
    bridge.destroy();
  });
});

describe("UX-44 — rows are titled after what they hold (live, never stored)", () => {
  it("the main item, '+N' for the rest; their own name wins", () => {
    expect(derivedRowTitle(["Pago Tarjeta Plata", "Gasto"])).toBe("Pago Tarjeta Plata +1");
    expect(derivedRowTitle(["Sueldo"])).toBe("Sueldo");
    expect(derivedRowTitle([])).toBeNull();
    const doc = createDemoFinancialDocument(TODAY);
    const core = createPlaylistCore(createFinancialPlaylistState(doc));
    const bridge = new FinancialBridge(core, doc);
    const state = core.getState();
    for (const track of state.tracks) {
      const count = state.clips.filter((clip) => clip.trackId === track.id).length;
      if (count === 0) continue;
      const meta = bridge.getTrackMeta(track.id)!;
      expect(meta.title).toBeTruthy();
      expect(meta.meter).toBeUndefined();
      // Never written into the row's label (the plan stores none).
      expect(track.label).not.toBe(meta.title);
    }
    bridge.destroy();
  });
});

describe("UX-64 — the lane morph respects reduced motion", () => {
  it("with prefers-reduced-motion the switch is instant", () => {
    const doc = createDemoFinancialDocument(TODAY);
    const core = createPlaylistCore(createFinancialPlaylistState(doc));
    const bridge = new FinancialBridge(core, doc);
    const series = bridge.getOverviewData().primary;
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    try {
      bridge.animateFrom(series);
      expect(bridge.isAnimating()).toBe(false);
    } finally {
      window.matchMedia = original;
    }
    bridge.animateFrom(series);
    expect(bridge.isAnimating()).toBe(true);
    bridge.destroy();
  });
});

// --- the shell, keyboard only ------------------------------------------------

const hoisted = vi.hoisted(() => ({
  cores: [] as PlaylistCore[],
  rendererCallbacks: [] as Array<PlaylistRendererCallbacks | undefined>,
}));

vi.mock("@slicex/canvas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@slicex/canvas")>();
  return {
    ...actual,
    createPlaylistCore: (...args: Parameters<typeof actual.createPlaylistCore>) => {
      const core = actual.createPlaylistCore(...args);
      hoisted.cores.push(core);
      return core;
    },
    createPlaylistRenderer: (
      _host: HTMLElement,
      _core: PlaylistCore,
      callbacks?: PlaylistRendererCallbacks,
    ) => {
      hoisted.rendererCallbacks.push(callbacks);
      return { destroy() {}, invalidate() {}, setTheme() {}, refreshFonts() {} };
    },
  };
});

import { PlaylistShell } from "../src/components/PlaylistShell";

let root: Root | null = null;

async function mountShell() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(React.createElement(PlaylistShell)));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  const core = hoisted.cores.at(-1);
  if (!core) throw new Error("shell did not build");
  act(() => core.setViewportSize(1200, 700));
  const host = document.querySelector<HTMLElement>(".playlist-shell__surface")!;
  return { core, host };
}

function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, ...init }));
  });
}

function selected(core: PlaylistCore): string | undefined {
  return core.getState().selection.clipIds[0];
}

function liveText(): string {
  return [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent ?? "").join(" | ");
}

beforeEach(() => {
  localStorage.clear();
  // No onboarding banner / hints in the way.
  localStorage.setItem("slicex.navHint", "1");
  hoisted.cores.length = 0;
  hoisted.rendererCallbacks.length = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("UX-04 — keyboard only: open Sueldo, change it, save; delete Gasto", () => {
  it("Alt+→ walks to Sueldo (announced), Enter opens it, Supr deletes Gasto (announced + Deshacer)", async () => {
    const { core, host } = await mountShell();
    act(() => host.focus());
    // Walk until Sueldo; the polite region names each object.
    for (let i = 0; i < 20 && selected(core) !== "fin-sueldo"; i += 1) {
      press(host, "ArrowRight", { altKey: true });
    }
    expect(selected(core)).toBe("fin-sueldo");
    expect(document.getElementById("fin-canvas-focus")!.textContent).toMatch(
      /^Sueldo · \+\$[\d,]+ .+ · \d{1,2} [a-z]{3} · línea \d+$/,
    );
    // Enter opens the editor on it (same path as a double-click).
    press(host, "Enter");
    const editor = document.querySelector<HTMLElement>(".fin-editor");
    expect(editor?.dataset.mode).toBe("edit");
    // Change the amount and save, keyboard style (type + Guardar).
    const amountLabel = [...editor!.querySelectorAll("label")].find((label) =>
      label.textContent?.trim().startsWith("Monto"),
    );
    const amount =
      (amountLabel?.control as HTMLInputElement | null) ??
      amountLabel?.querySelector("input") ??
      null;
    expect(amount).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      amount!.focus();
      setter.call(amount, "21000");
      amount!.dispatchEvent(new Event("input", { bubbles: true }));
      amount!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = [...editor!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Guardar")!;
    act(() => save.click());
    expect(document.querySelector(".fin-editor")).toBeNull();
    // Saved: the clip's info card (the bridge, through the renderer) says so.
    const info = hoisted.rendererCallbacks.at(-1)!.getClipInfo!("fin-sueldo")!;
    expect(info.split("\n")[0]).toMatch(/^Ingreso · \+\$21,000/);
    // Back on the canvas: walk to Gasto and delete it with Supr.
    act(() => host.focus());
    press(host, "d", { ctrlKey: true }); // deselect (Ctrl+D)
    for (let i = 0; i < 20 && selected(core) !== "fin-gasto"; i += 1) {
      press(host, "ArrowRight", { altKey: true });
    }
    expect(selected(core)).toBe("fin-gasto");
    press(host, "Delete");
    expect(core.getState().clips.some((clip) => clip.id === "fin-gasto")).toBe(false);
    expect(liveText()).toContain("Borrado: Gasto");
    const undo = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Deshacer");
    expect(undo).toBeDefined();
    act(() => undo!.click());
    expect(core.getState().clips.some((clip) => clip.id === "fin-gasto")).toBe(true);
  });

  it("→ with nothing selected moves the day, and its reading is spoken once it settles", async () => {
    const { core, host } = await mountShell();
    act(() => host.focus());
    press(host, "ArrowRight");
    expect(core.getState().playPosition.time).toBe(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    const reading = document.querySelector('.fin-readout [role="status"]')!;
    expect(reading.textContent).toMatch(/^\d{1,2} [a-z]{3} \d{4}: caja -?\$[\d,]+, deuda \$[\d,]+$/);
    expect(document.querySelector(".fin-readout")!.getAttribute("aria-label")).toBe("Lectura del día");
  });

  it("hovering the timeline: the lane's reading shows that day, silently; leaving brings the playhead's back", async () => {
    const { core } = await mountShell();
    const readout = document.querySelector<HTMLElement>(".fin-readout--lane")!;
    const playheadDate = readout.querySelector(".fin-readout__date")!.textContent;
    act(() => core.setHoverTime(9));
    expect(readout.dataset.source).toBe("hover");
    const hoverDate = readout.querySelector(".fin-readout__date")!.textContent;
    expect(hoverDate).not.toBe(playheadDate);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    // Hovering is never announced (only a keyboard move of the day is).
    expect(readout.querySelector('[role="status"]')!.textContent).toBe("");
    act(() => core.setHoverTime(null));
    expect(readout.dataset.source).toBe("playhead");
    expect(readout.querySelector(".fin-readout__date")!.textContent).toBe(playheadDate);
  });

  it("Shift+F10 opens the object's menu with the focus on its first item; Esc returns to the canvas", async () => {
    const { core, host } = await mountShell();
    act(() => host.focus());
    press(host, "ArrowRight", { altKey: true });
    press(host, "F10", { shiftKey: true });
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu).not.toBeNull();
    const items = [...menu.querySelectorAll('[role^="menuitem"]')];
    expect(items.length).toBeGreaterThan(3);
    // Only menuitems and separators inside the menu (UX-57).
    for (const child of menu.children) {
      expect(["menuitem", "menuitemradio", "separator"]).toContain(child.getAttribute("role"));
    }
    expect(document.activeElement).toBe(items[0]);
    press(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    expect(items.map((item) => item.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Ver mi año sin esto")]),
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(core.getState().contextMenu).toBeNull();
    expect(document.activeElement).toBe(host);
  });
});

describe("UX-16 / UX-57 / UX-60 — tools, their mode and the single-key shortcuts", () => {
  it("the toolbar is one tab stop; arrows move between the tools", async () => {
    await mountShell();
    const tools = [...document.querySelectorAll<HTMLButtonElement>(".playlist-shell__tool")];
    expect(tools.filter((tool) => tool.tabIndex === 0)).toHaveLength(1);
    expect(document.querySelector('[role="toolbar"]')!.contains(tools[0]!)).toBe(true);
    act(() => tools[0]!.focus());
    press(tools[0]!, "ArrowRight");
    expect(document.activeElement).toBe(tools[1]);
    press(tools[1]!, "End");
    expect(document.activeElement).toBe(tools.at(-1));
    // Each title says what it does to the money and its key.
    expect(tools.find((t) => t.dataset.tool === "mute")!.title).toBe(
      "Excluir (T): ¿y si no pasara? Lo saca de tus cifras sin borrarlo",
    );
  });

  it("a tool other than Select shows its mode on the canvas; Esc goes back", async () => {
    const { core, host } = await mountShell();
    act(() => core.setTool("delete"));
    const pill = document.querySelector<HTMLElement>(".fin-mode")!;
    expect(pill.textContent).toContain("Borrar");
    expect(pill.textContent).toContain("Esc para salir");
    act(() => host.focus());
    press(host, "Escape");
    expect(core.getState().tool).toBe("select");
    expect(document.querySelector(".fin-mode")).toBeNull();
  });

  it("'/' and Q do nothing from a header button; '/' works on the canvas", async () => {
    const { host } = await mountShell();
    const headerButton = document.querySelector<HTMLButtonElement>(".fin-summary button")!;
    act(() => headerButton.focus());
    press(headerButton, "/");
    press(headerButton, "q");
    expect(document.querySelector(".fin-command")).toBeNull();
    expect(document.querySelector(".fin-peek")).toBeNull();
    act(() => host.focus());
    press(host, "/");
    expect(document.querySelector(".fin-command")).not.toBeNull();
  });

  it("'Ver mi año sin esto' from the menu stays until Listo, the plan untouched", async () => {
    const { core, host } = await mountShell();
    act(() => host.focus());
    press(host, "ArrowRight", { altKey: true });
    const id = selected(core)!;
    press(host, "ContextMenu");
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) =>
      b.textContent?.includes("Ver mi año sin esto"),
    )!;
    const clipsBefore = core.getState().clips;
    act(() => item.click());
    const peek = document.querySelector<HTMLElement>(".fin-peek")!;
    expect(peek.textContent).toContain("Sin ");
    expect(core.getState().clips).toBe(clipsBefore);
    expect(core.getState().clips.find((clip) => clip.id === id)!.muted).not.toBe(true);
    const done = [...peek.querySelectorAll("button")].find((b) => b.textContent === "Listo")!;
    act(() => done.click());
    expect(document.querySelector(".fin-peek")).toBeNull();
  });
});
