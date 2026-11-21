// The records panel's dates, under its filters:
//
//   Día a día   [‹] [▦ Hoy · mié 18 nov ] [›]  Hoy
//   Elegir…     [‹] [▦ 1 – 18 nov       ] [›]
//
// ‹ / › walk a day (or the whole range, keeping its length); never past
// today (nothing has happened there yet). The middle button opens the
// calendar of @mantine/dates — one day, or a range (two clicks: first and
// last day) — in Spanish, weeks from Sunday, styled like every date of the
// app (DateField's classes). Escape closes only the calendar (it is a layer
// of the Escape stack). Pure view of SearchView: every change goes through
// `onChange`.
import * as React from "react";
import { Popover } from "@mantine/core";
import { DatePicker, type DatesRangeValue } from "@mantine/dates";
import { addDays, diffDays, type ISODate } from "@slicex/core";
import { formatDateWeekday } from "../format";
import { dayLabel, rangeLabel, viewDay, viewRange, type SearchView } from "../movements-ui";
import { useEscapeLayer } from "../../ui/use-overlay";
import {
  CALENDAR_CLASSES,
  CALENDAR_LABELS,
  CalendarIcon,
  calendarDayLabel,
  monthTitle,
} from "./DateField";

export interface RecordsDateBarProps {
  view: SearchView;
  today: ISODate;
  /** The new period ("day": `from` = the day, absent = today; "range": from..to). */
  onChange: (period: "day" | "range", from?: ISODate, to?: ISODate) => void;
  /** Open the range calendar right away (the person just chose "Elegir fechas…"). */
  openRangeOnMount?: boolean;
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={direction === "left" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} />
    </svg>
  );
}

/** "Hoy · mié 18 nov" / "Ayer · mar 17 nov" / "lun 16 nov" / "sáb 15 nov 2025". */
function dayButtonText(day: ISODate, today: ISODate): string {
  const label = dayLabel(day, today);
  if (label !== "Hoy" && label !== "Ayer") return label;
  const weekday = formatDateWeekday(day);
  return `${label} · ${day.slice(0, 4) === today.slice(0, 4) ? weekday.replace(/ \d{4}$/, "") : weekday}`;
}

/** The calendar behind the middle button (one day or a range). */
function CalendarButton({
  text,
  label,
  open,
  onOpenChange,
  children,
}: {
  text: string;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const calendarRef = React.useRef<HTMLDivElement | null>(null);
  const id = React.useId();
  useEscapeLayer(open, () => {
    const inside = calendarRef.current?.contains(document.activeElement) ?? false;
    onOpenChange(false);
    if (inside) buttonRef.current?.focus();
  });
  return (
    <Popover
      opened={open}
      onChange={onOpenChange}
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
        <button
          ref={buttonRef}
          type="button"
          className="fin-records__date"
          aria-label={`${label}: ${text}. Abrir calendario`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? `${id}-calendar` : undefined}
          onClick={() => onOpenChange(!open)}
        >
          <CalendarIcon />
          <span className="fin-records__date-text">{text}</span>
        </button>
      </Popover.Target>
      <Popover.Dropdown
        ref={calendarRef}
        id={`${id}-calendar`}
        className="fin-cal"
        role="dialog"
        aria-label={`Calendario: ${label}`}
      >
        {children}
      </Popover.Dropdown>
    </Popover>
  );
}

function DayBar({ view, today, onChange }: Omit<RecordsDateBarProps, "openRangeOnMount">) {
  const day = viewDay(view, today);
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState<string>(day);
  const go = (next: ISODate) => onChange("day", next >= today ? undefined : next);
  return (
    <div className="fin-records__datebar" role="group" aria-label="Día a día">
      <button type="button" className="fin-records__step" aria-label="Día anterior" onClick={() => go(addDays(day, -1))}>
        <Chevron direction="left" />
      </button>
      <CalendarButton
        text={dayButtonText(day, today)}
        label="Día"
        open={open}
        onOpenChange={(next) => {
          if (next) setMonth(day);
          setOpen(next);
        }}
      >
        <DatePicker
          value={day}
          onChange={(iso) => {
            if (!iso) return;
            go(iso);
            setOpen(false);
          }}
          date={month}
          onDateChange={setMonth}
          maxDate={today}
          highlightToday
          size="sm"
          monthLabelFormat={monthTitle}
          getDayAriaLabel={calendarDayLabel}
          ariaLabels={CALENDAR_LABELS}
          classNames={CALENDAR_CLASSES}
        />
      </CalendarButton>
      <button
        type="button"
        className="fin-records__step"
        aria-label="Día siguiente"
        disabled={day >= today}
        onClick={() => go(addDays(day, 1))}
      >
        <Chevron direction="right" />
      </button>
      {day < today ? (
        <button type="button" className="fin-records__today" onClick={() => go(today)}>
          Hoy
        </button>
      ) : null}
    </div>
  );
}

function RangeBar({ view, today, onChange, openRangeOnMount = false }: RecordsDateBarProps) {
  const range = viewRange(view, today);
  const from = range.from!;
  const to = range.to!;
  const [open, setOpen] = React.useState(openRangeOnMount);
  // The two clicks of a pick (first day, then last), kept until both are in.
  const [pending, setPending] = React.useState<DatesRangeValue<string>>([from, to]);
  const [month, setMonth] = React.useState<string>(from);
  const length = diffDays(from, to) + 1;
  const shift = (days: number) => {
    let nextTo = addDays(to, days);
    if (nextTo > today) nextTo = today;
    const nextFrom = addDays(nextTo, -(length - 1));
    onChange("range", nextFrom, nextTo);
  };
  return (
    <div className="fin-records__datebar" role="group" aria-label="Fechas">
      <button
        type="button"
        className="fin-records__step"
        aria-label={`${length} ${length === 1 ? "día" : "días"} antes`}
        onClick={() => shift(-length)}
      >
        <Chevron direction="left" />
      </button>
      <CalendarButton
        text={rangeLabel(from, to, today)}
        label="Fechas"
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setPending([from, to]);
            setMonth(from);
          }
          setOpen(next);
        }}
      >
        <p className="fin-cal__hint">
          {pending[0] && !pending[1] ? "Ahora el último día" : "Elige el primer día y luego el último"}
        </p>
        <DatePicker
          type="range"
          allowSingleDateInRange
          value={pending}
          onChange={(next) => {
            setPending(next);
            if (next[0] && next[1]) {
              onChange("range", next[0], next[1]);
              setOpen(false);
            }
          }}
          date={month}
          onDateChange={setMonth}
          maxDate={today}
          highlightToday
          size="sm"
          monthLabelFormat={monthTitle}
          getDayAriaLabel={calendarDayLabel}
          ariaLabels={CALENDAR_LABELS}
          classNames={CALENDAR_CLASSES}
        />
      </CalendarButton>
      <button
        type="button"
        className="fin-records__step"
        aria-label={`${length} ${length === 1 ? "día" : "días"} después`}
        disabled={to >= today}
        onClick={() => shift(length)}
      >
        <Chevron direction="right" />
      </button>
    </div>
  );
}

/** Nothing for the presets; the day walker or the range for "Día a día" / "Elegir fechas…". */
export function RecordsDateBar(props: RecordsDateBarProps) {
  const { view } = props;
  if (view.period === "day" || view.period === "today") return <DayBar {...props} />;
  if (view.period === "range") return <RangeBar {...props} />;
  return null;
}
