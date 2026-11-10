// THE date field of the app — the item editor's "Cuándo" and the
// onboarding's next pay are this one component:
//
//   Empieza
//   [ 15/11/2026        ▦ ]   ← type es-MX, or pick it in the calendar
//   dom 15 nov 2026           ← live readback / "No reconocida · …"
//
// Typing: free es-MX text parsed by `parseDateInput` ("15/11/2026",
// "15 nov", "2026-11-15"…); ↑/↓ move a day (Shift: a week), never below
// `min`. Picking: the calendar of @mantine/dates (Popover + DatePicker)
// in Spanish, weeks from Sunday, days before `min` disabled. It opens with
// a click in the field, its ▦ button or Alt+↓, and follows what is typed.
// Never the browser's <input type="date"> (mm/dd/yyyy in en-US browsers).
//
// Emits the ISO date, or "" while the text is not a date (the form's
// schema then blocks saving); with `optional`, an empty field emits
// undefined. Errors of `path` (form-kit) show under the field.
import * as React from "react";
import { Popover } from "@mantine/core";
import { DatePicker, type CalendarAriaLabels } from "@mantine/dates";
import dayjs from "dayjs";
import { compareISODate, isISODate } from "@slicex/core";
import {
  formatDateInput,
  formatDateWeekday,
  parseDateInput,
  shiftISODate,
  type DateYearPreference,
} from "../format";
import { FieldError, useEditableText, useFieldError } from "./form-kit";

interface DateFieldBaseProps {
  label: string;
  /** ISO date, "" (invalid entry) or undefined (no date, e.g. Indefinido). */
  value: string | undefined;
  /** Where a date typed without a year ("15 nov") takes its year from. */
  reference: string;
  prefer?: DateYearPreference;
  /** First valid day: ↓ stops there and the calendar disables the days before. */
  min?: string;
  disabled?: boolean;
  /**
   * What to show under a recognised (or disabled) date instead of its
   * weekday echo — e.g. "12 pagos · el último, vie 1 oct 2027".
   */
  preview?: string;
  /**
   * Just the input (no field label / preview), named by `label`: for a date
   * inside a sentence ("Termina ○ El [fecha]").
   */
  inline?: boolean;
  /** Spans the whole row of the form grid. */
  wide?: boolean;
  /** Form path of the date (its schema error shows under the field). */
  path?: string;
  /** Extra controls on the input row. */
  children?: React.ReactNode;
}

export type DateFieldProps = DateFieldBaseProps &
  (
    | { optional?: false; onChange: (iso: string) => void }
    | { optional: true; onChange: (iso: string | undefined) => void }
  );

const CALENDAR_LABELS: CalendarAriaLabels = {
  previousMonth: "Mes anterior",
  nextMonth: "Mes siguiente",
  previousYear: "Año anterior",
  nextYear: "Año siguiente",
  previousDecade: "Década anterior",
  nextDecade: "Década siguiente",
  monthLevelControl: "Elegir mes",
  yearLevelControl: "Elegir año",
};

// Our classes on Mantine's parts: colours / sizes from the tokens (globals.css).
const CALENDAR_CLASSES = {
  calendarHeader: "fin-cal__header",
  calendarHeaderControl: "fin-cal__nav",
  calendarHeaderLevel: "fin-cal__level",
  weekday: "fin-cal__weekday",
  day: "fin-cal__day",
  monthsListControl: "fin-cal__cell",
  yearsListControl: "fin-cal__cell",
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** "Noviembre 2026". */
const monthTitle = (date: string) => capitalize(dayjs(date).locale("es").format("MMMM YYYY"));
/** "domingo 15 de noviembre de 2026" (what a screen reader says for a day). */
const dayLabel = (date: string) => dayjs(date).locale("es").format("dddd D [de] MMMM [de] YYYY");

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function DateField(props: DateFieldProps) {
  const {
    label,
    value,
    reference,
    prefer = "nearest",
    min,
    disabled = false,
    preview,
    inline = false,
    optional = false,
    wide = false,
    path,
    children,
  } = props;
  const onChange = props.onChange as (iso: string | undefined) => void;
  const id = React.useId();
  const fieldError = useFieldError(path);
  const { text, setText, emit } = useEditableText(value, formatDateInput);
  const wrapperRef = React.useRef<HTMLSpanElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const calendarRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  // The month the calendar shows: follows the typed date, or its own arrows.
  const [month, setMonth] = React.useState<string>(reference);
  const focusDayOnOpenRef = React.useRef(false);

  const minDate = min !== undefined && isISODate(min) ? min : undefined;
  const parsed = parseDateInput(text, reference, prefer);
  const empty = text.trim() === "";
  const status = disabled ? "off" : parsed ? "ok" : empty ? "empty" : "invalid";
  const message =
    (status === "off" || status === "ok") && preview !== undefined
      ? preview
      : status === "off"
        ? ""
        : parsed
          ? formatDateWeekday(parsed)
          : empty
            ? "ej. 15/11/2026 o 15 nov"
            : "No reconocida · ej. 15/11/2026";

  const emitText = (raw: string) => {
    const iso = parseDateInput(raw, reference, prefer) ?? (optional && raw.trim() === "" ? undefined : "");
    if (emit(iso)) onChange(iso);
  };

  // Typing moves the calendar to the typed month.
  React.useEffect(() => {
    if (open && parsed) setMonth(parsed);
  }, [open, parsed]);

  // Opened from the keyboard: focus lands on the selected day (or today),
  // where the arrows move through the month.
  React.useEffect(() => {
    if (!open || !focusDayOnOpenRef.current) return;
    focusDayOnOpenRef.current = false;
    calendarRef.current
      ?.querySelector<HTMLElement>("button[data-selected], .fin-cal__day[tabindex='0']")
      ?.focus();
  }, [open]);

  const openCalendar = (focusDay: boolean) => {
    if (disabled) return;
    const shown = parsed ?? (value && isISODate(value) ? value : (minDate ?? reference));
    setMonth(minDate && compareISODate(shown, minDate) < 0 ? minDate : shown);
    focusDayOnOpenRef.current = focusDay;
    setOpen(true);
  };

  const pick = (iso: string) => {
    setText(formatDateInput(iso));
    if (emit(iso)) onChange(iso);
    setOpen(false);
    inputRef.current?.focus();
  };

  // Escape closes the calendar — and only the calendar: the dialog's own
  // Escape (a window listener) must not close the whole form.
  const escapeCloses = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return false;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    return true;
  };

  // Text that is not a date: the preview line already says so ("No
  // reconocida · ej. …") and the schema could only repeat it ("Fecha
  // inválida") — one message under the field, not two.
  const shownError = status === "invalid" && !inline ? { ...fieldError, message: undefined } : fieldError;
  const errorId = shownError.message ? shownError.id : null;
  const input = (
    <input
      ref={inputRef}
      id={id}
      type="text"
      autoComplete="off"
      spellCheck={false}
      className="fin-date__input"
      placeholder="dd/mm/aaaa"
      value={text}
      disabled={disabled}
      aria-label={inline ? label : undefined}
      aria-invalid={
        status === "invalid" ||
        (status === "empty" && !inline && !optional) ||
        fieldError.message !== undefined
      }
      aria-describedby={[inline ? null : `${id}-preview`, errorId].filter(Boolean).join(" ") || undefined}
      onClick={() => {
        if (!open) openCalendar(false);
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        emitText(raw);
      }}
      onBlur={() => {
        if (parsed) setText(formatDateInput(parsed));
      }}
      onKeyDown={(event) => {
        if (escapeCloses(event)) return;
        if (event.key === "Enter" && open) {
          event.preventDefault();
          setOpen(false);
          return;
        }
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        if (event.altKey && event.key === "ArrowDown") {
          event.preventDefault();
          openCalendar(true);
          return;
        }
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        const base = parsed ?? (value || reference);
        const step = (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 7 : 1);
        let next = shiftISODate(base, step);
        if (next === null) return;
        if (minDate !== undefined && compareISODate(next, minDate) < 0) next = minDate;
        setText(formatDateInput(next));
        if (emit(next)) onChange(next);
      }}
    />
  );

  const picker = (
    <span
      ref={wrapperRef}
      className="fin-date__picker"
      onBlur={(event) => {
        // Focus left the field (input, button and calendar): close.
        const next = event.relatedTarget as Node | null;
        if (!next || !wrapperRef.current?.contains(next)) setOpen(false);
      }}
    >
      <Popover
        opened={open}
        onChange={setOpen}
        position="bottom-start"
        offset={6}
        withinPortal={false}
        floatingStrategy="fixed"
        withRoles={false}
        trapFocus={false}
        returnFocus={false}
        closeOnEscape={false}
        middlewares={{ flip: true, shift: true }}
        transitionProps={{ duration: 0 }}
      >
        <Popover.Target>
          <span className="fin-date__box">
            {input}
            <button
              type="button"
              className="fin-date__toggle"
              aria-label={`Abrir calendario: ${label}`}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={open ? `${id}-calendar` : undefined}
              disabled={disabled}
              // Opened with the mouse, focus stays here: Escape still closes
              // only the calendar.
              onKeyDown={escapeCloses}
              onClick={(event) => {
                if (open) setOpen(false);
                // detail 0: Enter / Space (keyboard) → focus goes into the month.
                else openCalendar(event.detail === 0);
              }}
            >
              <CalendarIcon />
            </button>
          </span>
        </Popover.Target>
        <Popover.Dropdown
          ref={calendarRef}
          id={`${id}-calendar`}
          className="fin-cal"
          role="dialog"
          aria-label={`Calendario: ${label}`}
          onKeyDown={escapeCloses}
          onMouseDown={(event) => {
            // A press on the calendar's background keeps the focus where it is
            // (else the field would lose it and close).
            if (!(event.target as HTMLElement).closest("button")) event.preventDefault();
          }}
        >
          <DatePicker
            value={parsed}
            onChange={(iso) => {
              if (iso) pick(iso);
            }}
            date={month}
            onDateChange={setMonth}
            minDate={minDate}
            highlightToday
            size="sm"
            monthLabelFormat={monthTitle}
            getDayAriaLabel={dayLabel}
            ariaLabels={CALENDAR_LABELS}
            classNames={CALENDAR_CLASSES}
          />
        </Popover.Dropdown>
      </Popover>
    </span>
  );

  if (inline) {
    return (
      <>
        {picker}
        <FieldError {...fieldError} />
      </>
    );
  }

  return (
    <div className={wide ? "fin-editor__field fin-editor__field--wide fin-date" : "fin-editor__field fin-date"}>
      <label className="fin-editor__label" htmlFor={id}>
        {label}
      </label>
      <span className="fin-editor__control">
        {picker}
        {children}
      </span>
      <span id={`${id}-preview`} className="fin-date__preview" data-state={status}>
        {message}
      </span>
      <FieldError {...shownError} />
    </div>
  );
}
