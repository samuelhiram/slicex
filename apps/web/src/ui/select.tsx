// THE select of the app (forms, filters, toolbars): a Radix Select (the
// primitive shadcn/ui builds on — accessible listbox, full keyboard, type to
// jump, collision-aware positioning) dressed in the SliceX tokens. Never a
// native <select>: its OS dropdown ignores the theme.
//
// - The trigger looks like every field (--field-bg, fine border, 8 px) and
//   carries the field's aria (label / invalid / describedby).
// - The list floats in a portal over everything (dialogs included), with a
//   check on the chosen option and an optional muted hint per option.
// - Escape closes the list only (it is a layer of the app's Escape stack),
//   never the dialog under it.
// - "" is a valid value (e.g. "Todas"): Radix reserves it, so it is mapped
//   to an internal sentinel and back.
import * as React from "react";
import * as RadixSelect from "@radix-ui/react-select";
import { useEscapeLayer } from "./use-overlay";

export interface SelectOption {
  value: string;
  /** What the option and (when chosen) the trigger show. */
  label: string;
  /** A muted second part, only in the list ("sale de tu liquidez"). */
  hint?: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  /** Shown while `value` matches no option. */
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  /** "md" (forms, 36 px) or "sm" (filters, toolbars, tables: 30 px). */
  size?: "md" | "sm";
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

const EMPTY = "__fin-empty__";
const toRadix = (value: string): string => (value === "" ? EMPTY : value);
const fromRadix = (value: string): string => (value === EMPTY ? "" : value);

function Chevron() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M3 4.5 6 7.5 9 4.5" />
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M2.5 6.2 4.9 8.5 9.5 3.5" />
    </svg>
  );
}

export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    value,
    onValueChange,
    options,
    placeholder,
    id,
    disabled = false,
    size = "md",
    className,
    ...aria
  },
  ref,
) {
  const [open, setOpen] = React.useState(false);
  // Escape closes the list, not the dialog under it (window capture runs
  // before Radix's document listener: this layer owns the key while open).
  useEscapeLayer(open, () => setOpen(false));
  const known = options.some((option) => option.value === value);
  return (
    <RadixSelect.Root
      // "" (Radix): nothing chosen, the placeholder shows; always controlled.
      value={known ? toRadix(value) : ""}
      onValueChange={(next) => onValueChange(fromRadix(next))}
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
    >
      <RadixSelect.Trigger
        ref={ref}
        id={id}
        className={["fin-select", className].filter(Boolean).join(" ")}
        data-size={size}
        data-value={value}
        // Like a native select's `.value` (a type="button" never submits it).
        value={value}
        aria-label={aria["aria-label"]}
        aria-labelledby={aria["aria-labelledby"]}
        aria-describedby={aria["aria-describedby"]}
        aria-invalid={aria["aria-invalid"]}
      >
        <span className="fin-select__value">
          <RadixSelect.Value placeholder={placeholder ?? "Elige…"} />
        </span>
        <RadixSelect.Icon className="fin-select__chevron">
          <Chevron />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          className="fin-select__content"
          data-size={size}
          position="popper"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
        >
          <RadixSelect.ScrollUpButton className="fin-select__scroll">
            <Chevron />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="fin-select__viewport">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={toRadix(option.value)}
                disabled={option.disabled}
                textValue={option.label}
                className="fin-select__item"
                data-value={option.value}
              >
                <span className="fin-select__item-text">
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  {option.hint ? <span className="fin-select__hint">{option.hint}</span> : null}
                </span>
                <RadixSelect.ItemIndicator className="fin-select__check">
                  <Check />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="fin-select__scroll fin-select__scroll--down">
            <Chevron />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
});
