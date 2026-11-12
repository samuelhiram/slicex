// What every form of the finance UI shares — and only that (no framework):
// Mantine Form holds the values and runs the Zod schema; these pieces show
// each error under its field and keep typing smooth. See docs/forms-audit.md.
import * as React from "react";
import type { UseFormReturnType } from "@mantine/form";
import { MoneySchema } from "@slicex/contracts";
import { z } from "zod";
import { parseNumberInput } from "../format";

/**
 * Zod schema of an amount AS TYPED ("$12,000", "1 234.5"): the text is read
 * like every money input (parseNumberInput) and the number checked with
 * `number` — by default the shared MoneySchema (finite, ≥ 0). Empty passes
 * unless `required`. `message` replaces the schema's wording for every
 * failure (the onboarding's questions say what to write).
 */
export function amountTextSchema({
  number = MoneySchema,
  required = false,
  requiredMessage = "Escribe un monto",
  message,
}: {
  number?: z.ZodType<number>;
  required?: boolean;
  requiredMessage?: string;
  message?: string;
} = {}) {
  return z.string().superRefine((text, ctx) => {
    const value = parseNumberInput(text);
    if (value === null) {
      if (required) ctx.addIssue({ code: z.ZodIssueCode.custom, message: message ?? requiredMessage });
      return;
    }
    const result = number.safeParse(value);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: message ?? result.error.issues[0]?.message ?? "Escribe un número",
      });
    }
  });
}

/** The number an amount text that passed `amountTextSchema` stands for (empty → undefined). */
export function amountValue(text: string): number | undefined {
  return parseNumberInput(text) ?? undefined;
}

/**
 * A native input bound to a Mantine form at `path`: its props (value or
 * defaultValue + key, by the form's mode), its error tied to it
 * (aria-invalid + aria-describedby) and the message to render under it.
 */
export function bindField<Values>(
  form: UseFormReturnType<Values>,
  path: string,
  idPrefix: string,
): {
  key: string;
  input: Record<string, unknown>;
  error: React.ReactNode;
} {
  const { error, ...input } = form.getInputProps(path);
  const errorId = `${idPrefix}-${path.replace(/\./g, "-")}-error`;
  return {
    key: form.key(path),
    input: {
      ...input,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? errorId : undefined,
    },
    error: <FieldError id={errorId} message={error} />,
  };
}

/** The summary line's text: the first error, in the form's field order. */
export function firstError(errors: Readonly<Record<string, React.ReactNode>>): React.ReactNode {
  return Object.values(errors).find((message) => message) ?? "";
}

/** The form's errors by path ("amount", "recurrence.endDate", "rows.2.amount"). */
export type FieldErrors = Readonly<Record<string, React.ReactNode>>;

/**
 * Errors of the enclosing form. Any field below reads its own by path, so
 * fields need no error props threaded through (the editor's NumberField /
 * DateField, the onboarding's next-pay date…).
 */
export const FieldErrorsContext = React.createContext<FieldErrors>({});

export interface FieldErrorRef {
  /** id of the message, for the input's aria-describedby. */
  id: string;
  message: React.ReactNode;
}

/** The error at `path` of the enclosing form, with an id to tie it to its input. */
export function useFieldError(path: string | undefined): FieldErrorRef {
  const errors = React.useContext(FieldErrorsContext);
  const id = React.useId();
  return { id, message: path ? errors[path] || undefined : undefined };
}

/** aria-invalid + aria-describedby for an input with this error (nothing when valid). */
export function errorAria(error: FieldErrorRef): {
  "aria-invalid"?: true;
  "aria-describedby"?: string;
} {
  return error.message ? { "aria-invalid": true, "aria-describedby": error.id } : {};
}

/** The message under a field (nothing when valid). */
export function FieldError({ id, message }: FieldErrorRef) {
  return message ? (
    <span id={id} className="fin-editor__field-error">
      {message}
    </span>
  ) : null;
}

/** "Último día" of a day-of-month control: 31 clamps to every month's end. */
export const LAST_DAY_OF_MONTH = 31;

const DAY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  ...Array.from({ length: 30 }, (_, index) => ({ value: index + 1, label: String(index + 1) })),
  { value: LAST_DAY_OF_MONTH, label: "Último día" },
];

/**
 * THE day-of-month control (UX-34): the same "[1–30 | Último día]" select in
 * the editor's monthly "Día de pago", the card's "Día de corte / de pago"
 * and the onboarding's fixed expenses. `value` undefined = not chosen yet
 * (a "—" option, only when `allowEmpty`).
 */
export function DaySelect({
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = "—",
  id,
  ...aria
}: {
  value: number | undefined;
  onChange: (day: number | undefined) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}) {
  const known = value !== undefined && Number.isFinite(value) && value >= 1 && value <= LAST_DAY_OF_MONTH;
  return (
    <select
      id={id}
      className="fin-day-select"
      value={known ? String(Math.round(value)) : ""}
      onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
      {...aria}
    >
      {allowEmpty || !known ? (
        <option value="" disabled={!allowEmpty}>
          {emptyLabel}
        </option>
      ) : null}
      {DAY_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * After a failed submit: the focus goes to the first invalid control of
 * `root` (WCAG 3.3.1, UX-32), so a keyboard user lands on what to fix.
 * Returns whether one was focused.
 */
export function focusFirstInvalid(root: ParentNode | null): boolean {
  const target = root?.querySelector<HTMLElement>(
    'input[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"]',
  );
  if (!target || target.matches(":disabled")) return false;
  target.focus();
  return target.ownerDocument.activeElement === target;
}

/**
 * The text of an input whose PARSED value lives in the form. The text stays
 * local so a parse never clobbers typing ("12.", "15 no", an emptied
 * "cada N"); a change of the value from outside — undo, a preset, the
 * calendar, a kind switch — rewrites it.
 *
 * `emit(next)` records a value the input itself produced and says whether
 * it is new (false: the form already has it — skip onChange).
 */
export function useEditableText<T>(
  value: T,
  toText: (value: T) => string,
  same: (a: T, b: T) => boolean = Object.is,
): {
  text: string;
  setText: (text: string) => void;
  emit: (next: T) => boolean;
} {
  const [text, setText] = React.useState(() => toText(value));
  const emittedRef = React.useRef(value);
  const toTextRef = React.useRef(toText);
  toTextRef.current = toText;
  const sameRef = React.useRef(same);
  sameRef.current = same;
  React.useEffect(() => {
    if (!sameRef.current(value, emittedRef.current)) {
      emittedRef.current = value;
      setText(toTextRef.current(value));
    }
  }, [value]);
  const emit = React.useCallback((next: T) => {
    if (sameRef.current(next, emittedRef.current)) return false;
    emittedRef.current = next;
    return true;
  }, []);
  return { text, setText, emit };
}
