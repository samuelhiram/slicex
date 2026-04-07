export const DAY_WIDTH_PX = 80;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toUtcMidnightMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function dateToPixel(
  date: Date,
  originDate: Date,
  zoom: number,
): number {
  if (!(zoom > 0)) {
    throw new Error("zoom must be greater than 0");
  }

  const dayDelta =
    (toUtcMidnightMs(date) - toUtcMidnightMs(originDate)) / MS_PER_DAY;
  return dayDelta * DAY_WIDTH_PX * zoom;
}

export function pixelToDate(
  pixel: number,
  originDate: Date,
  zoom: number,
): Date {
  if (!(zoom > 0)) {
    throw new Error("zoom must be greater than 0");
  }

  const dayDelta = pixel / (DAY_WIDTH_PX * zoom);
  const utcMs = toUtcMidnightMs(originDate) + dayDelta * MS_PER_DAY;
  return new Date(utcMs);
}
