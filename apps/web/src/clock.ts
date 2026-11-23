// Local calendar date of the device ("today" for the projection). The only
// place that reads the clock: @slicex/core stays pure and receives dates.
export function localTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
