// Test helpers for the app's Select (ui/select.tsx, Radix): open it like a
// person (keyboard), pick an option by value, read its options. A native
// <select> still works through the same helpers.
import { act } from "react";

export interface ReadOption {
  value: string;
  label: string;
  disabled: boolean;
}

function isNative(el: Element): el is HTMLSelectElement {
  return el instanceof HTMLSelectElement;
}

function open(trigger: HTMLElement): void {
  act(() => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
}

function close(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
}

function listedOptions(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

/** Picks the option with this value (by `data-value`), as a click would. */
export function chooseOption(control: Element, value: string): void {
  if (isNative(control)) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    act(() => {
      setter.call(control, value);
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return;
  }
  open(control as HTMLElement);
  const option = listedOptions().find((candidate) => candidate.getAttribute("data-value") === value);
  if (!option) {
    close();
    throw new Error(`option "${value}" not found`);
  }
  act(() => option.click());
}

/** The options of a select (opens and closes it). */
export function readOptions(control: Element): ReadOption[] {
  if (isNative(control)) {
    return [...control.options].map((option) => ({
      value: option.value,
      label: option.text,
      disabled: option.disabled,
    }));
  }
  open(control as HTMLElement);
  const options = listedOptions().map((option) => ({
    value: option.getAttribute("data-value") ?? "",
    label: option.querySelector(".fin-select__item-text")?.firstChild?.textContent ?? option.textContent ?? "",
    disabled: option.hasAttribute("data-disabled"),
  }));
  close();
  return options;
}

/** What the trigger shows (the chosen option's label, or the placeholder). */
export function shownText(control: Element): string {
  if (isNative(control)) return control.selectedOptions[0]?.text ?? "";
  return control.querySelector(".fin-select__value")?.textContent ?? "";
}
