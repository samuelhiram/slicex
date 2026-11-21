// The records panel (right of the timeline) remembers two things:
//
// - Open or folded: a preference of this browser (localStorage). Never
//   chosen yet: open when it fits beside the timeline, folded on a narrow
//   screen (there it would cover the timeline).
// - What it shows (section, filters): survives a reload of the tab
//   (sessionStorage, like the open forms); a new visit opens on the
//   default view, "Gastos del mes".
//
// Never throws: blocked / full / corrupted storage just means the defaults.
import { parseSearchView, type SearchView } from "./movements-ui";

export const RECORDS_OPEN_KEY = "slicex.records-panel.v1";
export const RECORDS_VIEW_KEY = "slicex.records-view.v1";

/** From this viewport width the panel sits beside the timeline (globals.css: below it, it covers it). */
export const RECORDS_DOCK_MIN_WIDTH = 900;

function local(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Open or folded, as last chosen; never chosen: open when it fits beside the timeline. */
export function loadRecordsOpen(viewportWidth: number): boolean {
  try {
    const stored = local()?.getItem(RECORDS_OPEN_KEY);
    if (stored === "open") return true;
    if (stored === "folded") return false;
  } catch {
    // unreadable: the default
  }
  return viewportWidth >= RECORDS_DOCK_MIN_WIDTH;
}

export function saveRecordsOpen(open: boolean): void {
  try {
    local()?.setItem(RECORDS_OPEN_KEY, open ? "open" : "folded");
  } catch {
    // blocked: the choice just isn't remembered
  }
}

export function loadRecordsView(): SearchView | null {
  try {
    const raw = session()?.getItem(RECORDS_VIEW_KEY);
    return raw ? parseSearchView(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveRecordsView(view: SearchView): void {
  try {
    session()?.setItem(RECORDS_VIEW_KEY, JSON.stringify(view));
  } catch {
    // full / blocked: the filters just won't survive a reload
  }
}
