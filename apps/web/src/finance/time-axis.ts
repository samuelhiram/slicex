// Calendar ruler for the playlist: 1 beat = 1 day, beat 0 = startDate.
// Plugged into @slicex/canvas through the generic PlaylistTimeAxis option,
// so the canvas package stays finance-agnostic.
//
// Granularity adapts to zoom so labels never overlap:
//   ≥ 9 px/day   → a tick per day, labelled Mondays ("16 NOV") + month starts
//   ≥ 2.5 px/day → a tick per Monday, labelled month starts ("DIC", "ENE 2027")
//   below        → month starts only
// Called once per presentation build (canon §3.3), never per clip.
import { daysInMonth, toDayNumber, fromDayNumber, type ISODate } from "@slicex/core";
import type { PlaylistTimeAxis, PlaylistTimeAxisTick } from "@slicex/canvas";

const MONTHS = [
  "ENE",
  "FEB",
  "MAR",
  "ABR",
  "MAY",
  "JUN",
  "JUL",
  "AGO",
  "SEP",
  "OCT",
  "NOV",
  "DIC",
] as const;

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;

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

// Rough width budget (px) of the widest ruler label ("ENE 2027" at 11px
// bold). Labels closer than this would overlap.
const LABEL_SPACING_PX = 62;
// The playlist draws a "Hoy" marker label at beat 0; ruler labels inside
// this many px after it would sit on top of it.
const TODAY_LABEL_PX = 28;

// January carries the year. When months are packed tightly the label is
// just the year ("2027") so it stays as narrow as a month name.
function monthLabel(parts: DayParts, compact = false): string {
  const name = MONTHS[parts.month - 1] ?? "";
  if (parts.month !== 1) return name;
  return compact ? String(parts.year) : `${name} ${parts.year}`;
}

export function formatAxisDate(dayNumber: number): string {
  const parts = partsOf(dayNumber);
  return `${WEEKDAYS[weekdayIndex(dayNumber)]} ${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

export function createCalendarTimeAxis(startDate: ISODate): PlaylistTimeAxis {
  const origin = toDayNumber(startDate);

  return {
    ticks(fromBeat, toBeat, pxPerBeat): PlaylistTimeAxisTick[] {
      const first = Math.max(0, Math.floor(fromBeat));
      const last = Math.ceil(toBeat);
      const ticks = buildTicks(first, last, pxPerBeat);
      const todayClearance = TODAY_LABEL_PX / pxPerBeat;
      for (const tick of ticks) {
        if (tick.beat >= todayClearance) break;
        if (tick.label !== null) tick.label = null;
      }
      return ticks;
    },

    formatTime(beat) {
      return formatAxisDate(origin + Math.floor(beat));
    },
  };

  function buildTicks(
    first: number,
    last: number,
    pxPerBeat: number,
  ): PlaylistTimeAxisTick[] {
      const ticks: PlaylistTimeAxisTick[] = [];
      if (last < first) return ticks;

      if (pxPerBeat >= 9) {
        // A Monday label too close to a month label would overlap it; the
        // month wins and the Monday keeps its (unlabelled) major tick.
        const clearance = Math.ceil(LABEL_SPACING_PX / pxPerBeat);
        for (let beat = first; beat <= last; beat += 1) {
          const dn = origin + beat;
          const parts = partsOf(dn);
          if (parts.day === 1) {
            ticks.push({ beat, major: true, label: monthLabel(parts) });
          } else if (weekdayIndex(dn) === 0) {
            const sincePrevMonth = parts.day - 1;
            const untilNextMonth = daysInMonth(parts.year, parts.month) - parts.day + 1;
            const crowded = sincePrevMonth < clearance || untilNextMonth < clearance;
            ticks.push({
              beat,
              major: true,
              label: crowded ? null : `${parts.day} ${MONTHS[parts.month - 1]}`,
            });
          } else {
            ticks.push({ beat, major: false, label: null });
          }
        }
        return ticks;
      }

      // Month starts in range, found by stepping month-by-month (≤ ~40 per
      // screen), merged with Mondays found by arithmetic skip.
      const monthStarts: number[] = [];
      const parts = partsOf(origin + first);
      let year = parts.year;
      let month = parts.month;
      if (parts.day !== 1) {
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
      for (;;) {
        const beat =
          toDayNumber(`${year}-${String(month).padStart(2, "0")}-01`) - origin;
        if (beat > last) break;
        monthStarts.push(beat);
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }

      if (pxPerBeat < 2.5) {
        const compact = pxPerBeat * 28 < LABEL_SPACING_PX;
        for (const beat of monthStarts) {
          ticks.push({
            beat,
            major: true,
            label: monthLabel(partsOf(origin + beat), compact),
          });
        }
        return ticks;
      }

      const skip = (7 - weekdayIndex(origin + first)) % 7;
      let monthIndex = 0;
      for (let beat = first + skip; beat <= last; beat += 7) {
        while (monthIndex < monthStarts.length && monthStarts[monthIndex]! < beat) {
          const m = monthStarts[monthIndex]!;
          ticks.push({ beat: m, major: true, label: monthLabel(partsOf(origin + m)) });
          monthIndex += 1;
        }
        if (monthIndex < monthStarts.length && monthStarts[monthIndex] === beat) {
          ticks.push({ beat, major: true, label: monthLabel(partsOf(origin + beat)) });
          monthIndex += 1;
        } else {
          ticks.push({ beat, major: false, label: null });
        }
      }
      while (monthIndex < monthStarts.length) {
        const m = monthStarts[monthIndex]!;
        ticks.push({ beat: m, major: true, label: monthLabel(partsOf(origin + m)) });
        monthIndex += 1;
      }
      return ticks;
  }
}
