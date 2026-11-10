// What every form of the finance UI shares — and only that (no framework):
// Mantine Form holds the values and runs the Zod schema; these pieces show
// each error under its field and keep typing smooth. See docs/forms-audit.md.
import * as React from "react";

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
