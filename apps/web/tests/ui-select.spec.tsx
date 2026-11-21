// @vitest-environment jsdom
// THE select (ui/select.tsx): a Radix Select in the tokens, never a native
// <select>. "" is a real value ("Todas"); Escape closes the list only, not
// the dialog under it.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Select } from "../src/ui/select";
import { useEscapeLayer } from "../src/ui/use-overlay";
import { chooseOption, readOptions, shownText } from "./select-helpers";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function Harness({ onDialogEscape }: { onDialogEscape: () => void }) {
  const [value, setValue] = React.useState("");
  // The dialog under the select owns Escape too.
  useEscapeLayer(true, onDialogEscape);
  return (
    <Select
      aria-label="Categoría"
      value={value}
      onValueChange={setValue}
      options={[
        { value: "", label: "Todas las categorías" },
        { value: "Mandado", label: "Mandado", hint: "súper, mercado" },
        { value: "Gasolina", label: "Gasolina" },
        { value: "Viejo", label: "Viejo", disabled: true },
      ]}
    />
  );
}

function mount(onDialogEscape = vi.fn()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Harness onDialogEscape={onDialogEscape} />));
  return document.querySelector<HTMLButtonElement>('[aria-label="Categoría"]')!;
}

describe("Select", () => {
  it("is a button (combobox), not a native select; '' is a real choice", () => {
    const trigger = mount();
    expect(document.querySelector("select:not([aria-hidden])")).toBeNull();
    expect(trigger.getAttribute("role")).toBe("combobox");
    expect(shownText(trigger)).toBe("Todas las categorías");
    chooseOption(trigger, "Gasolina");
    expect(trigger.value).toBe("Gasolina");
    expect(shownText(trigger)).toBe("Gasolina");
    chooseOption(trigger, "");
    expect(trigger.value).toBe("");
    expect(shownText(trigger)).toBe("Todas las categorías");
  });

  it("lists every option with its hint; disabled ones say so", () => {
    const trigger = mount();
    expect(readOptions(trigger)).toEqual([
      { value: "", label: "Todas las categorías", disabled: false },
      { value: "Mandado", label: "Mandado", disabled: false },
      { value: "Gasolina", label: "Gasolina", disabled: false },
      { value: "Viejo", label: "Viejo", disabled: true },
    ]);
  });

  it("Escape closes the list, not the dialog under it", () => {
    const onDialogEscape = vi.fn();
    const trigger = mount(onDialogEscape);
    act(() => {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(document.querySelectorAll('[role="option"]').length).toBe(4);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelectorAll('[role="option"]').length).toBe(0);
    expect(onDialogEscape).not.toHaveBeenCalled();
    // The next Escape is the dialog's.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onDialogEscape).toHaveBeenCalledTimes(1);
  });
});
