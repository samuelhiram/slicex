// Calendar ruler for the playlist: 1 beat = 1 day, beat 0 = startDate
// ("today"). Plugged into @slicex/canvas through the generic
// PlaylistTimeAxis option, so the canvas package stays finance-agnostic.
//
// Two tiers, like a calendar app: the upper tier names the month (or the
// year when zoomed far out) and sticks to the left edge; the lower tier
// labels days. Granularity adapts to zoom so labels never overlap:
//   ≥ 38 px/day → every day "Lu 16" (weekday + day), centred
//   ≥ 16 px/day → every day "16", centred
//   ≥ 6 px/day  → a tick per day, Mondays labelled "16"
//   ≥ 2.5 px/day→ a tick per Monday, labelled when there is room
//   below       → month starts labelled "Ene", years on the upper tier
// Today is a pill in the "now" colour (its own day label when days are
// labelled, "Hoy" otherwise), centred in its cell. The canvas resolves label
// collisions at draw time (the pill wins), so the axis never blanks labels
// on a guess. Weekends are shaded from 6 px/day. Called once per
// presentation build (canon §3.3), never per clip.
import { toDayNumber, fromDayNumber, type ISODate } from "@slicex/core";
import type {
  PlaylistTimeAxis,
  PlaylistTimeAxisBand,
  PlaylistTimeAxisTick,
} from "@slicex/canvas";

const MONTHS_SHORT = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

const MONTHS_LONG = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;
// Two-letter weekday names, Monday first (as in es-MX date pickers).
const WEEKDAY_INITIALS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"] as const;

interface DayParts {
  year: number;
  month: number; // 1..12
  day: number;
}

function partsOf(dayNumber: number): DayParts {
  const iso = fromDayNumber(dayNumber);
  return {
    year: Number(iso.slice(0, 4)),
    month: Number(iso.slice(5, 7)),
    day: Number(iso.slice(8, 10)),
  };
}

// 1970-01-01 was a Thursday → Monday-based index 3.
function weekdayIndex(dayNumber: number): number {
  return (((dayNumber + 3) % 7) + 7) % 7;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function monthStartDay(year: number, month: number): number {
  return toDayNumber(`${year}-${String(month).padStart(2, "0")}-01`);
}

// Zoom thresholds (px per day).
// "Mi 30" is ~33 px at 11px: room for it plus a gap.
export const DAY_INITIAL_PX = 38;
export const DAY_NUMBER_PX = 16;
export const DAY_TICK_PX = 6;
export const WEEK_TICK_PX = 2.5;
// Upper-tier month names: long ("Noviembre 2026") from this month width.
const LONG_MONTH_PX = 150;

export function formatAxisDate(dayNumber: number): string {
  const parts = partsOf(dayNumber);
  return `${WEEKDAYS[weekdayIndex(dayNumber)]} ${parts.day} ${MONTHS_SHORT[parts.month - 1]} ${parts.year}`;
}

export function createCalendarTimeAxis(startDate: ISODate): PlaylistTimeAxis {
  const origin = toDayNumber(startDate);

  return {
    ticks(fromBeat, toBeat, pxPerBeat): PlaylistTimeAxisTick[] {
      const first = Math.max(0, Math.floor(fromBeat));
      const last = Math.ceil(toBeat);
      const ticks = buildTicks(first, last, pxPerBeat);
      if (first === 0 && last >= 0) markToday(ticks);
      return ticks;
    },

    bands(fromBeat, toBeat, pxPerBeat): PlaylistTimeAxisBand[] {
      const first = Math.max(0, Math.floor(fromBeat));
      const last = Math.ceil(toBeat);
      const bands: PlaylistTimeAxisBand[] = [];
      if (last < first) return bands;
      if (pxPerBeat >= WEEK_TICK_PX) {
        const long = pxPerBeat * 30 >= LONG_MONTH_PX;
        const start = partsOf(origin + first);
        let year = start.year;
        let month = start.month;
        for (;;) {
          const begin = monthStartDay(year, month) - origin;
          if (begin > last) break;
          const nextYear = month === 12 ? year + 1 : year;
          const nextMonth = month === 12 ? 1 : month + 1;
          const end = monthStartDay(nextYear, nextMonth) - origin;
          bands.push({
            kind: "group",
            start: begin,
            end,
            label: long
              ? `${MONTHS_LONG[month - 1]} ${year}`
              : `${capitalize(MONTHS_SHORT[month - 1]!)} ${year}`,
          });
          year = nextYear;
          month = nextMonth;
        }
      } else {
        const startYear = partsOf(origin + first).year;
        for (let year = startYear; ; year += 1) {
          const begin = toDayNumber(`${year}-01-01`) - origin;
          if (begin > last) break;
          bands.push({
            kind: "group",
            start: begin,
            end: toDayNumber(`${year + 1}-01-01`) - origin,
            label: String(year),
          });
        }
      }
      if (pxPerBeat >= DAY_TICK_PX) {
        // Saturday + Sunday, found by arithmetic skip from the first day.
        const back = (weekdayIndex(origin + first) - 5 + 7) % 7;
        for (let sat = first - back; sat <= last; sat += 7) {
          bands.push({ kind: "shade", start: sat, end: sat + 2 });
        }
      }
      return bands;
    },

    formatTime(beat) {
      return formatAxisDate(origin + Math.floor(beat));
    },

    // A right edge sits at the START of the next day (ends are exclusive):
    // the clip covers up to the day before. Name that day, so "hasta 31
    // ago" really includes the 31st and a payment on Sep 1 is clearly out.
    formatEnd(beat) {
      return `hasta ${formatAxisDate(origin + Math.ceil(beat) - 1)}`;
    },

    lastCoveredBeat(endBeat) {
      return Math.ceil(endBeat) - 1;
    },

    // "Quincena" snap: the first day of each pay period (the 1st and the
    // 16th), i.e. the day right after each payday. Steps month by month
    // from the first month in range — never day by day.
    snapTargets(fromBeat, toBeat) {
      const targets: number[] = [];
      const start = partsOf(origin + Math.floor(fromBeat));
      let year = start.year;
      let month = start.month;
      for (;;) {
        const prefix = `${year}-${String(month).padStart(2, "0")}`;
        const first = toDayNumber(`${prefix}-01`) - origin;
        if (first > toBeat) break;
        const sixteenth = toDayNumber(`${prefix}-16`) - origin;
        if (first >= fromBeat - 16) targets.push(first);
        if (sixteenth >= fromBeat - 16 && sixteenth <= toBeat + 16) targets.push(sixteenth);
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
      return targets;
    },
  };

  // Today (beat 0) as an emphasised, centred label: its own day label when
  // every day is labelled, "Hoy" otherwise. Centred so the canvas keeps it
  // while any part of today's cell is on screen.
  function markToday(ticks: PlaylistTimeAxisTick[]): void {
    const head = ticks[0];
    if (head && head.beat === 0) {
      if (!head.centered) head.label = "Hoy";
      head.centered = true;
      head.emphasis = true;
      head.dim = false;
      return;
    }
    ticks.unshift({
      beat: 0,
      major: false,
      label: "Hoy",
      centered: true,
      emphasis: true,
    });
  }

  function buildTicks(
    first: number,
    last: number,
    pxPerBeat: number,
  ): PlaylistTimeAxisTick[] {
    const ticks: PlaylistTimeAxisTick[] = [];
    if (last < first) return ticks;

    if (pxPerBeat >= DAY_NUMBER_PX) {
      const initials = pxPerBeat >= DAY_INITIAL_PX;
      for (let beat = first; beat <= last; beat += 1) {
        const dn = origin + beat;
        const parts = partsOf(dn);
        const weekday = weekdayIndex(dn);
        ticks.push({
          beat,
          major: parts.day === 1 || weekday === 0,
          label: initials
            ? `${WEEKDAY_INITIALS[weekday]} ${parts.day}`
            : String(parts.day),
          centered: true,
          dim: weekday >= 5,
        });
      }
      return ticks;
    }

    if (pxPerBeat >= DAY_TICK_PX) {
      for (let beat = first; beat <= last; beat += 1) {
        const dn = origin + beat;
        const parts = partsOf(dn);
        const monday = weekdayIndex(dn) === 0;
        ticks.push({
          beat,
          major: monday || parts.day === 1,
          label: monday ? String(parts.day) : null,
        });
      }
      return ticks;
    }

    if (pxPerBeat >= WEEK_TICK_PX) {
      // Mondays by arithmetic skip, merged with month starts (majors).
      const roomForDays = pxPerBeat * 7 >= 26;
      const skip = (7 - weekdayIndex(origin + first)) % 7;
      const start = partsOf(origin + first);
      let year = start.year;
      let month = start.month;
      let nextMonthStart = monthStartDay(year, month) - origin;
      const advanceMonth = (): void => {
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
        nextMonthStart = monthStartDay(year, month) - origin;
      };
      if (nextMonthStart < first) advanceMonth();
      for (let beat = first + skip; beat <= last; beat += 7) {
        while (nextMonthStart < beat && nextMonthStart <= last) {
          ticks.push({ beat: nextMonthStart, major: true, label: null });
          advanceMonth();
        }
        if (nextMonthStart === beat) {
          ticks.push({
            beat,
            major: true,
            label: roomForDays ? String(partsOf(origin + beat).day) : null,
          });
          advanceMonth();
        } else {
          ticks.push({
            beat,
            major: false,
            label: roomForDays ? String(partsOf(origin + beat).day) : null,
          });
        }
      }
      while (nextMonthStart <= last) {
        ticks.push({ beat: nextMonthStart, major: true, label: null });
        advanceMonth();
      }
      return ticks;
    }

    // Far out: month starts, labelled with the short month name.
    const roomForMonths = pxPerBeat * 28 >= 30;
    const start = partsOf(origin + first);
    let year = start.year;
    let month = start.month;
    if (start.day !== 1) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    for (;;) {
      const beat = monthStartDay(year, month) - origin;
      if (beat > last) break;
      ticks.push({
        beat,
        major: true,
        label: roomForMonths ? capitalize(MONTHS_SHORT[month - 1]!) : null,
      });
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    return ticks;
  }
}

