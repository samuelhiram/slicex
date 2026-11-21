// @vitest-environment jsdom
// Phase-0 primitives of the UX audit 2026-11-11 (UX-23, UX-26, UX-27):
// focus return + the Escape stack + useOverlay (ui/use-overlay.ts), the
// announcer with "Deshacer" (ui/announcer.tsx) and the live effect line
// (finance/components/EffectLine.tsx), plus the "/" bar on top of it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDemoFinancialDocument, type FinancialItem } from "@slicex/core";
import type { FinancialBridgeApi, FinancialPreview, PreviewEffect } from "../src/finance/bridge-api";
import {
  focusIfPossible,
  useEscapeLayer,
  useOverlay,
  useRestoreFocus,
  type OverlayKind,
} from "../src/ui/use-overlay";
import { AnnouncerProvider, useAnnounce, type AnnounceFn } from "../src/ui/announcer";
import {
  EffectLine,
  describePreviewEffect,
  useLivePreviewEffect,
} from "../src/finance/components/EffectLine";
import { CommandBar } from "../src/finance/components/CommandBar";
import { DateField } from "../src/finance/components/DateField";
import { SlicexMantineProvider } from "../src/mantine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function render(element: React.ReactElement) {
  act(() => root.render(element));
}

function outsideButton(id: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = id;
  button.textContent = id;
  document.body.appendChild(button);
  return button;
}

function escapeOn(target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function press(target: Element) {
  act(() => {
    target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

// --- useRestoreFocus -----------------------------------------------------------

describe("useRestoreFocus", () => {
  function Surface({
    open,
    fallback,
    keepMounted = false,
  }: {
    open: boolean;
    fallback?: () => HTMLElement | null;
    keepMounted?: boolean;
  }) {
    const ref = React.useRef<HTMLDivElement | null>(null);
    useRestoreFocus(open, fallback, { containerRef: ref });
    return open || keepMounted
      ? h("div", { ref, id: "surface" }, h("input", { id: "inside" }))
      : null;
  }

  it("gives the focus back to the element focused at opening", () => {
    const opener = outsideButton("opener");
    opener.focus();
    render(h(Surface, { open: true }));
    act(() => byId("inside").focus());
    render(h(Surface, { open: false }));
    expect(document.activeElement).toBe(opener);
  });

  it("also on unmount (a dialog mounted only while open)", () => {
    const opener = outsideButton("opener");
    opener.focus();
    render(h(Surface, { open: true }));
    act(() => byId("inside").focus());
    render(h("span"));
    expect(document.activeElement).toBe(opener);
  });

  it("falls back when the opener is gone or was <body>", () => {
    const fallback = outsideButton("fallback");
    const opener = outsideButton("opener");
    opener.focus();
    render(h(Surface, { open: true, fallback: () => fallback }));
    act(() => byId("inside").focus());
    opener.remove();
    render(h(Surface, { open: false, fallback: () => fallback }));
    expect(document.activeElement).toBe(fallback);

    act(() => fallback.blur());
    expect(document.activeElement).toBe(document.body);
    render(h(Surface, { open: true, fallback: () => fallback }));
    act(() => byId("inside").focus());
    render(h(Surface, { open: false, fallback: () => fallback }));
    expect(document.activeElement).toBe(fallback);
  });

  it("skips a disabled opener for the fallback", () => {
    const fallback = outsideButton("fallback");
    const opener = outsideButton("opener");
    opener.focus();
    render(h(Surface, { open: true, fallback: () => fallback }));
    act(() => byId("inside").focus());
    opener.disabled = true;
    render(h(Surface, { open: false, fallback: () => fallback }));
    expect(document.activeElement).toBe(fallback);
  });

  it("never takes the focus back from where the person moved it", () => {
    const opener = outsideButton("opener");
    const other = outsideButton("other");
    opener.focus();
    render(h(Surface, { open: true }));
    act(() => other.focus());
    render(h(Surface, { open: false }));
    expect(document.activeElement).toBe(other);
  });

  it("a surface that stays mounted: a focus left inside it comes back", () => {
    const opener = outsideButton("opener");
    opener.focus();
    render(h(Surface, { open: true, keepMounted: true }));
    act(() => byId("inside").focus());
    render(h(Surface, { open: false, keepMounted: true }));
    expect(document.activeElement).toBe(opener);
  });

  it("focusIfPossible refuses <body>, detached, disabled and inert targets", () => {
    const button = outsideButton("b");
    expect(focusIfPossible(document.body)).toBe(false);
    expect(focusIfPossible(document.createElement("button"))).toBe(false);
    button.disabled = true;
    expect(focusIfPossible(button)).toBe(false);
    button.disabled = false;
    const inert = document.createElement("div");
    inert.setAttribute("inert", "");
    document.body.appendChild(inert);
    inert.appendChild(button);
    expect(focusIfPossible(button)).toBe(false);
    document.body.appendChild(button);
    expect(focusIfPossible(button)).toBe(true);
  });
});

// --- the Escape stack ------------------------------------------------------------

describe("useEscapeLayer: one Escape, for the layer on top", () => {
  function Layer({
    active,
    onEscape,
    within,
    children,
  }: {
    active: boolean;
    onEscape: () => void;
    within?: boolean;
    children?: React.ReactNode;
  }) {
    const ref = React.useRef<HTMLDivElement | null>(null);
    useEscapeLayer(active, onEscape, within ? { within: [ref] } : {});
    return h("div", { ref, className: "layer" }, children);
  }

  const a = vi.fn();
  const b = vi.fn();
  beforeEach(() => {
    a.mockClear();
    b.mockClear();
  });

  function two(activeA: boolean, activeB: boolean, scopedB = false) {
    render(
      h(
        "div",
        null,
        h(Layer, { key: "a", active: activeA, onEscape: a }),
        h(Layer, { key: "b", active: activeB, onEscape: b, within: scopedB }, h("button", { id: "in-b" })),
      ),
    );
  }

  it("with two layers open, Escape closes only the top one; then the one below", () => {
    const heard = vi.fn();
    window.addEventListener("keydown", heard);
    two(true, false);
    two(true, true);
    const event = escapeOn(document.body);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(heard).not.toHaveBeenCalled();
    two(true, false);
    escapeOn(document.body);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", heard);
  });

  it("with no layer open the event is left alone", () => {
    const heard = vi.fn();
    window.addEventListener("keydown", heard);
    two(false, false);
    const event = escapeOn(document.body);
    expect(event.defaultPrevented).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", heard);
  });

  it("re-opening a layer puts it back on top", () => {
    two(true, true);
    two(false, true);
    two(true, true);
    escapeOn(document.body);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("opened together, the inner surface sits above its parent", () => {
    render(h(Layer, { active: true, onEscape: a }, h(Layer, { active: true, onEscape: b })));
    escapeOn(document.body);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it("a scoped layer only takes Escape from inside; elsewhere it is transparent", () => {
    two(true, true, true);
    escapeOn(document.body);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    escapeOn(byId("in-b"));
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("other keys and IME composition are ignored", () => {
    two(true, false);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true }));
    });
    expect(a).not.toHaveBeenCalled();
  });
});

// --- useOverlay ------------------------------------------------------------------

describe("useOverlay", () => {
  function Overlay({
    kind,
    open,
    onClose,
    withInitialFocus = false,
  }: {
    kind: OverlayKind;
    open: boolean;
    onClose: () => void;
    withInitialFocus?: boolean;
  }) {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const firstRef = React.useRef<HTMLButtonElement | null>(null);
    useOverlay({
      open,
      onClose,
      kind,
      containerRef,
      triggerRef,
      initialFocusRef: withInitialFocus ? firstRef : undefined,
    });
    return h(
      "div",
      null,
      h("button", { ref: triggerRef, id: "trigger" }, "Abrir"),
      open
        ? h(
            "div",
            { ref: containerRef, id: "surface" },
            h("p", { id: "text" }, "Texto"),
            h("button", { ref: firstRef, id: "first" }, "Primero"),
          )
        : null,
    );
  }

  const onClose = vi.fn();
  beforeEach(() => onClose.mockClear());

  it("modal: focus moves in, a press outside does NOT close it, Escape does, focus goes back", () => {
    const outside = outsideButton("outside");
    render(h(Overlay, { kind: "modal", open: false, onClose }));
    act(() => byId("trigger").focus());
    render(h(Overlay, { kind: "modal", open: true, onClose }));
    expect(document.activeElement).toBe(byId("surface"));
    expect(byId("surface").tabIndex).toBe(-1);
    press(outside);
    expect(onClose).not.toHaveBeenCalled();
    escapeOn(byId("surface"));
    expect(onClose).toHaveBeenCalledTimes(1);
    render(h(Overlay, { kind: "modal", open: false, onClose }));
    expect(document.activeElement).toBe(byId("trigger"));
  });

  it("menu: a press outside closes it, inside or on its trigger does not; the first item gets the focus", () => {
    const outside = outsideButton("outside");
    render(h(Overlay, { kind: "menu", open: true, onClose, withInitialFocus: true }));
    expect(document.activeElement).toBe(byId("first"));
    press(byId("text"));
    press(byId("trigger"));
    expect(onClose).not.toHaveBeenCalled();
    press(outside);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("menu: closing after the opener vanished returns the focus to the trigger", () => {
    const opener = outsideButton("opener");
    opener.focus();
    render(h(Overlay, { kind: "menu", open: true, onClose, withInitialFocus: true }));
    opener.remove();
    render(h(Overlay, { kind: "menu", open: false, onClose, withInitialFocus: true }));
    expect(document.activeElement).toBe(byId("trigger"));
  });

  it("panel: Escape only from inside it; presses outside never close it", () => {
    const outside = outsideButton("outside");
    render(h(Overlay, { kind: "panel", open: true, onClose }));
    expect(document.activeElement).toBe(document.body);
    press(outside);
    escapeOn(outside);
    expect(onClose).not.toHaveBeenCalled();
    escapeOn(byId("first"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the DateField calendar is a layer above a dialog: Escape closes the month first", () => {
    function Dialog({ onClose: close }: { onClose: () => void }) {
      const ref = React.useRef<HTMLDivElement | null>(null);
      const [value, setValue] = React.useState("2026-11-20");
      useOverlay({ open: true, onClose: close, kind: "modal", containerRef: ref });
      return h(
        "div",
        { ref, role: "dialog" },
        h(DateField, { label: "Empieza", value, reference: "2026-11-11", onChange: setValue }),
      );
    }
    render(h(SlicexMantineProvider, { theme: "light", children: h(Dialog, { onClose }) }));
    const toggle = document.querySelector<HTMLButtonElement>('[aria-label="Abrir calendario: Empieza"]')!;
    act(() => toggle.click());
    const calendar = () => document.querySelector<HTMLElement>(".fin-cal");
    expect(calendar()).not.toBeNull();
    escapeOn(calendar()!);
    expect(calendar()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    escapeOn(toggle);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// --- the announcer -----------------------------------------------------------------

describe("AnnouncerProvider + useAnnounce", () => {
  let announce: AnnounceFn = () => {};
  let childRenders = 0;
  function Child() {
    childRenders += 1;
    announce = useAnnounce();
    return h("button", { id: "child" }, "Guardar");
  }
  function mountProvider(props: { fallbackFocus?: () => HTMLElement | null } = {}) {
    childRenders = 0;
    render(h(AnnouncerProvider, { ...props, children: h(Child) }));
  }
  const region = () => document.querySelector<HTMLElement>('[role="status"][aria-live="polite"]');
  const notice = () => document.querySelector<HTMLElement>(".fin-toast");
  const buttonNamed = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>(".fin-toast button")].find(
      (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
    ) ?? null;

  it("the status region is there before anything is said, and says each message", () => {
    mountProvider();
    expect(region()).not.toBeNull();
    expect(region()!.textContent).toBe("");
    expect(region()!.classList.contains("fin-sr-only")).toBe(true);
    expect(notice()).toBeNull();
    act(() => announce({ message: "Guardado. Tu punto más bajo: −$1,292 el 27 nov" }));
    expect(region()!.textContent).toBe("Guardado. Tu punto más bajo: −$1,292 el 27 nov");
    expect(notice()!.textContent).toContain("Guardado. Tu punto más bajo");
    expect(buttonNamed("Deshacer")).toBeNull();
    expect(buttonNamed("Cerrar aviso")).not.toBeNull();
  });

  it("'Deshacer' runs undo, closes the notice and announces 'Deshecho'", () => {
    mountProvider();
    const undo = vi.fn();
    act(() => announce({ message: "Arreglo aplicado", undo }));
    act(() => buttonNamed("Deshacer")!.click());
    expect(undo).toHaveBeenCalledTimes(1);
    expect(notice()).toBeNull();
    expect(region()!.textContent).toBe("Deshecho");
  });

  it("an undo that announces its own result keeps it", () => {
    mountProvider();
    act(() =>
      announce({ message: "Arreglo aplicado", undo: () => announce({ message: "Arreglo quitado" }) }),
    );
    act(() => buttonNamed("Deshacer")!.click());
    expect(region()!.textContent).toBe("Arreglo quitado");
    expect(notice()!.textContent).toContain("Arreglo quitado");
  });

  it("× closes the notice; the region stays mounted; nothing closes it by itself", () => {
    vi.useFakeTimers();
    mountProvider();
    act(() => announce({ message: "Guardado", undo: () => {}, undoLabel: "Deshacer cambio" }));
    expect(buttonNamed("Deshacer cambio")).not.toBeNull();
    act(() => vi.advanceTimersByTime(60_000));
    expect(notice()).not.toBeNull();
    act(() => buttonNamed("Cerrar aviso")!.click());
    expect(notice()).toBeNull();
    expect(region()).not.toBeNull();
    expect(region()!.textContent).toBe("Guardado");
  });

  it("the same message twice is announced twice (a fresh node each time)", () => {
    mountProvider();
    act(() => announce({ message: "Guardado" }));
    const first = region()!.firstElementChild;
    act(() => announce({ message: "Guardado" }));
    const second = region()!.firstElementChild;
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second!.textContent).toBe("Guardado");
  });

  it("the next announce replaces the notice", () => {
    mountProvider();
    act(() => announce({ message: "Uno", undo: () => {} }));
    act(() => announce({ message: "Dos" }));
    expect(document.querySelectorAll(".fin-toast")).toHaveLength(1);
    expect(notice()!.textContent).toContain("Dos");
    expect(buttonNamed("Deshacer")).toBeNull();
  });

  it("Escape closes it from inside only, and the focus goes back where it came from", () => {
    mountProvider();
    const child = byId<HTMLButtonElement>("child");
    act(() => child.focus());
    act(() => announce({ message: "Guardado", undo: () => {} }));
    escapeOn(child);
    expect(notice()).not.toBeNull();
    const undoButton = buttonNamed("Deshacer")!;
    act(() => {
      undoButton.dispatchEvent(new FocusEvent("focusin", { bubbles: true, relatedTarget: child }));
      undoButton.focus();
    });
    escapeOn(undoButton);
    expect(notice()).toBeNull();
    expect(document.activeElement).toBe(child);
  });

  it("closing with the focus inside and nowhere to go back uses the fallback", () => {
    const fallback = outsideButton("fallback");
    mountProvider({ fallbackFocus: () => fallback });
    act(() => announce({ message: "Guardado" }));
    const close = buttonNamed("Cerrar aviso")!;
    act(() => close.focus());
    act(() => close.click());
    expect(notice()).toBeNull();
    expect(document.activeElement).toBe(fallback);
  });

  it("announcing never re-renders the children (stable context, state only on announce)", () => {
    mountProvider();
    const before = childRenders;
    act(() => announce({ message: "Uno" }));
    act(() => announce({ message: "Dos", undo: () => {} }));
    act(() => buttonNamed("Cerrar aviso")!.click());
    expect(childRenders).toBe(before);
  });

  it("announceRef hands announce to code above the provider; empty messages are ignored", () => {
    const ref = React.createRef<AnnounceFn | null>() as React.RefObject<AnnounceFn | null>;
    render(h(AnnouncerProvider, { announceRef: ref, children: h("span") }));
    act(() => ref.current?.({ message: "  " }));
    expect(notice()).toBeNull();
    act(() => ref.current?.({ message: "Registrado" }));
    expect(region()!.textContent).toBe("Registrado");
  });

  it("outside a provider useAnnounce is a no-op", () => {
    let outsideAnnounce: AnnounceFn | null = null;
    function Lone() {
      outsideAnnounce = useAnnounce();
      return null;
    }
    render(h(Lone));
    expect(() => outsideAnnounce!({ message: "Nada" })).not.toThrow();
    expect(region()).toBeNull();
  });
});

// --- the effect line -----------------------------------------------------------------

const WORSE: PreviewEffect = {
  text: "Mín -$1,292 → -$58,792 · horizonte −$114,000",
  tone: "negative",
  minBefore: -1292,
  minAfter: -58792,
  minAfterDate: "2026-11-27",
  finalBefore: 50000,
  finalAfter: -64000,
};

describe("describePreviewEffect / <EffectLine>", () => {
  it("says minimum before → after (date) and the horizon delta", () => {
    expect(describePreviewEffect(WORSE)).toBe(
      "Tu caja: mínimo −$1,292 → −$58,792 (27 nov) · al horizonte −$114,000",
    );
  });

  it("names the crossings (red, reserve) and what does not move", () => {
    const base = { ...WORSE, tone: "positive" as const };
    expect(describePreviewEffect({ ...base, minBefore: 500, minAfter: -100 })).toContain("entras en rojo");
    expect(describePreviewEffect({ ...base, minBefore: -100, minAfter: 500 })).toContain("sales del rojo");
    expect(
      describePreviewEffect({ ...base, minBefore: 6000, minAfter: 4000 }, { reserve: 5000 }),
    ).toContain("rompes tu reserva");
    expect(
      describePreviewEffect({ ...base, minBefore: 4000, minAfter: 6000 }, { reserve: 5000 }),
    ).toContain("recuperas tu reserva");
    expect(
      describePreviewEffect({ ...base, minBefore: 100, minAfter: 100, finalBefore: 0, finalAfter: 9000 }),
    ).toBe("Tu caja: mínimo sin cambio · al horizonte +$9,000");
    expect(
      describePreviewEffect(
        { ...base, minBefore: 100, minAfter: 100, finalBefore: 5, finalAfter: 5 },
        { label: "Con este arreglo" },
      ),
    ).toBe("Con este arreglo: sin cambios");
  });

  it("renders one toned line, nothing without an effect, and is not a live region", () => {
    render(h("div", null, h(EffectLine, { effect: WORSE }), h(EffectLine, { effect: null })));
    const lines = document.querySelectorAll<HTMLElement>(".fin-effect");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.dataset.tone).toBe("negative");
    expect(lines[0]!.textContent).toBe(describePreviewEffect(WORSE));
    expect(lines[0]!.getAttribute("role")).toBeNull();
  });
});

/** Just what useLivePreviewEffect touches: revision, preview, effect. */
function createPreviewBridge() {
  let revision = 0;
  let preview: FinancialPreview | null = null;
  const listeners = new Set<() => void>();
  const bridge = {
    getRevision: () => revision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setPreview: vi.fn((next: FinancialPreview | null) => {
      preview = next;
    }),
    getPreview: () => preview,
    getPreviewEffect: vi.fn((): PreviewEffect | null =>
      preview ? { ...WORSE, minAfter: -1000 * (revision + 1), text: `rev ${revision}` } : null,
    ),
  };
  return {
    bridge,
    api: bridge as unknown as FinancialBridgeApi,
    bump() {
      revision += 1;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe("useLivePreviewEffect", () => {
  const P1: FinancialPreview = { kind: "exclude", itemId: "a" };
  const P2: FinancialPreview = { kind: "exclude", itemId: "b" };
  let seen: PreviewEffect | null = null;
  function Probe(props: { bridge: FinancialBridgeApi; preview: FinancialPreview | null; delayMs?: number }) {
    seen = useLivePreviewEffect(
      props.bridge,
      props.preview,
      props.delayMs === undefined ? undefined : { delayMs: props.delayMs },
    );
    return null;
  }

  beforeEach(() => {
    seen = null;
    vi.useFakeTimers();
  });

  it("waits ~150 ms after the last change, then shows the what-if and returns its effect", () => {
    const { bridge, api } = createPreviewBridge();
    render(h(Probe, { bridge: api, preview: P1 }));
    act(() => vi.advanceTimersByTime(100));
    render(h(Probe, { bridge: api, preview: P2 }));
    act(() => vi.advanceTimersByTime(149));
    expect(bridge.setPreview).not.toHaveBeenCalled();
    expect(seen).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(bridge.setPreview).toHaveBeenCalledTimes(1);
    expect(bridge.setPreview).toHaveBeenLastCalledWith(P2);
    expect(seen?.text).toBe("rev 0");
  });

  it("a plan change refreshes the effect at once (same what-if)", () => {
    const { bridge, api, bump } = createPreviewBridge();
    render(h(Probe, { bridge: api, preview: P1 }));
    act(() => vi.advanceTimersByTime(150));
    act(() => bump());
    expect(seen?.text).toBe("rev 1");
    expect(bridge.getPreview()).toBe(P1);
  });

  it("null takes the what-if off the lane at once; unmounting too", () => {
    const { bridge, api } = createPreviewBridge();
    render(h(Probe, { bridge: api, preview: P1, delayMs: 0 }));
    expect(bridge.getPreview()).toBe(P1);
    expect(seen).not.toBeNull();
    render(h(Probe, { bridge: api, preview: null, delayMs: 0 }));
    expect(bridge.getPreview()).toBeNull();
    expect(seen).toBeNull();

    render(h(Probe, { bridge: api, preview: P2, delayMs: 0 }));
    expect(bridge.getPreview()).toBe(P2);
    render(h("span"));
    expect(bridge.getPreview()).toBeNull();
  });

  it("leaves alone a what-if someone else set meanwhile", () => {
    const { bridge, api } = createPreviewBridge();
    render(h(Probe, { bridge: api, preview: P1, delayMs: 0 }));
    act(() => bridge.setPreview(P2));
    render(h("span"));
    expect(bridge.getPreview()).toBe(P2);
  });

  it("an equal effect is not new state: even an unmemoized preview settles", () => {
    const { bridge, api, bump } = createPreviewBridge();
    let renders = 0;
    function Careless() {
      renders += 1;
      // A new object every render (what the docs say not to do).
      useLivePreviewEffect(api, { kind: "exclude", itemId: "a" }, { delayMs: 0 });
      return null;
    }
    render(h(Careless));
    // First render + the one that stores the effect (+ at most React's
    // render-then-bail-out for the equal one); then it is stable.
    const settled = renders;
    expect(settled).toBeLessThanOrEqual(3);
    act(() => vi.advanceTimersByTime(1000));
    expect(renders).toBe(settled);
    // A plan change: a bounded number of renders, then stable again.
    act(() => bump());
    const afterBump = renders;
    expect(afterBump - settled).toBeLessThanOrEqual(3);
    act(() => vi.advanceTimersByTime(1000));
    expect(renders).toBe(afterBump);
    expect(bridge.getPreviewEffect).toHaveBeenCalled();
  });
});

// --- the "/" bar on top of the hook ---------------------------------------------------

describe("CommandBar keeps its live effect (now via useLivePreviewEffect)", () => {
  function createCommandBridge() {
    const doc = createDemoFinancialDocument("2026-11-07");
    const { bridge, api } = createPreviewBridge();
    const full = Object.assign(api, {
      getDocument: () => doc,
      addItem: vi.fn((item: FinancialItem) => item.id),
    });
    return { bridge, api: full };
  }

  function typeInto(input: HTMLInputElement, text: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("typing previews at once on the lane and shows the effect; closing clears it", () => {
    const { bridge, api } = createCommandBridge();
    const onClose = vi.fn();
    render(h(CommandBar, { bridge: api, today: "2026-11-07", onClose }));
    const input = document.querySelector<HTMLInputElement>(".fin-command__input")!;
    expect(document.activeElement).toBe(input);
    typeInto(input, "renta 8000 el 1");
    const preview = bridge.getPreview();
    expect(preview?.kind).toBe("add");
    expect(preview && preview.kind === "add" ? preview.item.name.toLowerCase() : "").toContain("renta");
    expect(document.querySelector(".fin-command__effect")!.textContent).toBe("rev 0");
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      input.dispatchEvent(event);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    render(h("span"));
    expect(bridge.getPreview()).toBeNull();
  });
});
