// @vitest-environment jsdom
// Floating UI dismissal: a menu never closes on its own content (press or
// wheel-scroll inside); outside press / outside scroll / resize / Escape do.
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isInsideAny, useDismiss } from "../src/ui/use-dismiss";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const onDismiss = vi.fn();

function Harness({ escape = false }: { escape?: boolean }) {
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  const popover = React.useRef<HTMLDivElement | null>(null);
  useDismiss(true, [trigger, popover], onDismiss, { escape });
  return (
    <div>
      <button ref={trigger} id="trigger" type="button">
        Abrir
      </button>
      <div ref={popover} id="popover" style={{ overflow: "auto" }}>
        <p id="text">Texto</p>
        <hr id="sep" />
        <button id="disabled" type="button" disabled>
          No
        </button>
      </div>
      <div id="outside" style={{ overflow: "auto" }} />
    </div>
  );
}

function fire(id: string, type: string) {
  const el = document.getElementById(id)!;
  el.dispatchEvent(new Event(type, { bubbles: type !== "scroll" }));
}

beforeEach(() => {
  onDismiss.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useDismiss", () => {
  it("pressing anything inside (text, separator, disabled item, trigger) keeps it open", () => {
    act(() => root.render(<Harness />));
    for (const id of ["text", "sep", "disabled", "popover", "trigger"]) fire(id, "pointerdown");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("the wheel scrolling the menu itself keeps it open", () => {
    act(() => root.render(<Harness />));
    fire("popover", "scroll");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("an outside press, an outside scroll or a resize close it", () => {
    act(() => root.render(<Harness />));
    fire("outside", "pointerdown");
    fire("outside", "scroll");
    window.dispatchEvent(new Event("resize"));
    expect(onDismiss).toHaveBeenCalledTimes(3);
  });

  it("Escape closes only when asked", () => {
    act(() => root.render(<Harness />));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => root.render(<Harness escape />));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("isInsideAny ignores non-nodes and empty refs", () => {
    expect(isInsideAny(window, [{ current: document.body }])).toBe(false);
    expect(isInsideAny(document.body, [{ current: null }])).toBe(false);
  });
});
