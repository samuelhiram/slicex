// Shared building blocks for the financial panels: bridge subscriptions,
// playhead navigation and a couple of dense DAW-style primitives.
//
// Performance canon §1.7 / §2.6: React never sees per-frame state. The
// financial data is read through `useSyncExternalStore` on the bridge
// revision (bumped only when the document / projection changes) and the
// playhead is reduced to an integer day before it reaches `setState`, so
// hover / viewport / play-tick notifications bail out in React.
import * as React from "react";
import { DEFAULT_PLAYLIST_METRICS } from "@slicex/canvas";
import type { ISODate } from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";

/** Re-renders only when the bridge revision changes. */
export function useFinancialRevision(bridge: FinancialBridgeApi): number {
  // Wrapped so a class-based bridge (unbound methods) also works.
  const subscribe = React.useCallback(
    (listener: () => void) => bridge.subscribe(listener),
    [bridge],
  );
  const getSnapshot = React.useCallback(() => bridge.getRevision(), [bridge]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function dayOf(time: number): number {
  return Math.floor(time);
}

/**
 * Integer playhead day (1 beat = 1 day). The core notifies on every state
 * change (hover, play tick…); `setDay` receives a primitive, so React bails
 * out unless the day actually changed.
 */
export function usePlayheadDay(bridge: FinancialBridgeApi): number {
  const core = bridge.core;
  const [day, setDay] = React.useState(() =>
    dayOf(core.getState().playPosition.time),
  );
  React.useEffect(() => {
    setDay(dayOf(core.getState().playPosition.time));
    const sub = core.subscribe((state) => {
      setDay(dayOf(state.playPosition.time));
    });
    return () => sub.unsubscribe();
  }, [core]);
  return day;
}

/**
 * Moves the playhead to `date` and, when that day is off-screen, scrolls
 * the timeline so it lands at ~25% of the lane width. Click handler only —
 * never called per frame.
 */
export function jumpPlayheadToDate(
  bridge: FinancialBridgeApi,
  date: ISODate,
): void {
  const core = bridge.core;
  const beat = Math.max(0, bridge.beatAtDate(date));
  core.setPlayPosition(beat);
  const { viewport } = core.getState();
  // The core's own metrics (the finance shell widens the header column).
  const metrics = core.metrics ?? DEFAULT_PLAYLIST_METRICS;
  const laneWidth =
    viewport.width - metrics.trackHeaderWidth - metrics.scrollbarSize;
  if (laneWidth <= 0 || viewport.pxPerBeat <= 0) return;
  const x = beat * viewport.pxPerBeat;
  if (x < viewport.scrollX || x > viewport.scrollX + laneWidth) {
    core.updateViewport({ scrollX: Math.max(0, x - laneWidth * 0.25) });
  }
}

/**
 * Lenient money/number parser for text inputs: accepts "12,000", "$12000",
 * " 1 234.5 ". Empty → `null`; garbage → NaN.
 */
export function parseNumberInput(raw: string): number | null {
  const cleaned = raw.replace(/[\s$,]/g, "").replace(/−/g, "-");
  if (cleaned === "") return null;
  return Number(cleaned);
}

/** Collapsible section with a 1px divider header (no cards). */
export function FinSection({
  title,
  aside,
  defaultOpen = true,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="fin-section" data-open={open ? "true" : "false"}>
      <header className="fin-section__header">
        <button
          type="button"
          className="fin-section__toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="fin-section__caret" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="fin-section__title">{title}</span>
        </button>
        {aside ? <div className="fin-section__aside">{aside}</div> : null}
      </header>
      {open ? <div className="fin-section__body">{children}</div> : null}
    </section>
  );
}

/**
 * Inline editable amount. Shows the formatted value at rest; on focus
 * switches to the raw number. Commits on blur / Enter, cancels on Escape.
 * Invalid input (NaN, below `min`) reverts silently.
 */
export function InlineNumberInput({
  value,
  format,
  onCommit,
  min,
  ariaLabel,
  className,
}: {
  value: number;
  format: (n: number) => string;
  onCommit: (n: number) => void;
  min?: number;
  ariaLabel: string;
  className?: string;
}) {
  // `null` = not editing (show the formatted value).
  const [draft, setDraft] = React.useState<string | null>(null);
  const cancelledRef = React.useRef(false);

  const commit = () => {
    if (draft === null) return;
    const parsed = parseNumberInput(draft);
    setDraft(null);
    if (parsed === null || !Number.isFinite(parsed)) return;
    if (min !== undefined && parsed < min) return;
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      spellCheck={false}
      aria-label={ariaLabel}
      className={className}
      value={draft ?? format(value)}
      onFocus={(event) => {
        cancelledRef.current = false;
        setDraft(String(value));
        const target = event.currentTarget;
        // Select after React swaps the value in.
        requestAnimationFrame(() => target.select());
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          setDraft(null);
          return;
        }
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelledRef.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}
