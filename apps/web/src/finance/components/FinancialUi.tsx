// Shared building blocks for the financial panels: bridge subscriptions,
// playhead navigation and a couple of dense DAW-style primitives.
//
// Performance canon §1.7 / §2.6: React never sees per-frame state. The
// financial data is read through `useSyncExternalStore` on the bridge
// revision (bumped only when the document / projection changes) and the
// playhead is reduced to an integer day before it reaches `setState`, so
// hover / viewport / play-tick notifications bail out in React.
import * as React from "react";
import { createPortal } from "react-dom";
import { useField } from "@mantine/form";
import { DEFAULT_PLAYLIST_METRICS } from "@slicex/canvas";
import type { ISODate } from "@slicex/core";
import type { z } from "zod";
import type { FinancialBridgeApi } from "../bridge-api";
import { useEscapeLayer } from "../../ui/use-overlay";
import { amountTextSchema, amountValue } from "./form-kit";

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
 * The day under the pointer over the timeline (the canvas's hover-time
 * indicator), or null. A primitive per day: re-renders only when the
 * pointer crosses into another day.
 */
export function useHoverDay(bridge: FinancialBridgeApi): number | null {
  const core = bridge.core;
  const [day, setDay] = React.useState<number | null>(() => core.getState().hoverTime ?? null);
  React.useEffect(() => {
    setDay(core.getState().hoverTime ?? null);
    const sub = core.subscribe((state) => setDay(state.hoverTime ?? null));
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

/** Id of the valley card's title (ValleyCard renders it with tabIndex=-1). */
export const VALLEY_TITLE_ID = "fin-valley-title";

/**
 * After a jump into a valley (from the header's verdict or an alert), the
 * valley card's title takes the focus once the card has rendered (UX-26), so
 * its fixes are a couple of Tabs away. Tolerant: if no card shows up within
 * a few frames, the focus stays where it is. Click handler only.
 */
export function focusValleyTitleSoon(frames = 8): void {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") return;
  let left = frames;
  const tick = () => {
    const title = document.getElementById(VALLEY_TITLE_ID);
    if (title && title.closest("[inert]") === null) {
      title.focus({ preventScroll: true });
      if (document.activeElement === title) return;
    }
    left -= 1;
    if (left > 0) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
  const bodyId = React.useId();
  // UX-58: each section of the rail is a heading holding its toggle
  // (h3 > button[aria-expanded]), so a screen reader can jump by headings.
  return (
    <section className="fin-section" data-open={open ? "true" : "false"}>
      <header className="fin-section__header">
        <h3 className="fin-section__heading">
          <button
            type="button"
            className="fin-section__toggle"
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="fin-section__caret" aria-hidden="true">
              {open ? "▾" : "▸"}
            </span>
            <span className="fin-section__title">{title}</span>
          </button>
        </h3>
        {aside ? <div className="fin-section__aside">{aside}</div> : null}
      </header>
      {open ? (
        <div id={bodyId} className="fin-section__body">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Inline editable amount (the header's "Liquidez hoy" / "Reserva mínima").
 * At rest it shows the formatted value; focused, the raw number — held by
 * Mantine's `useField` (one input, no form) and checked with `schema`, a
 * shared number schema of @slicex/contracts read through `amountTextSchema`
 * (the same text → number rules as every money input, "12 mil" included).
 *
 * Enter / blur save a valid value. An invalid one is NOT dropped: the input
 * keeps it, turns red and says why — in a visible note anchored under the
 * field (UX-18), announced (role="alert") and as its tooltip — until it is
 * fixed, or Escape brings the saved value back. While editing, the field is
 * a layer of the Escape stack (use-overlay.ts), so its Escape reverts even
 * inside a popover that closes on Escape.
 */
export function InlineNumberInput({
  value,
  format,
  onCommit,
  schema,
  ariaLabel,
  className,
  onInvalidChange,
}: {
  value: number;
  format: (n: number) => string;
  onCommit: (n: number) => void;
  /** What a valid amount is (its messages are the ones shown). */
  schema: z.ZodType<number>;
  ariaLabel: string;
  className?: string;
  /** Told when the field starts / stops showing an error (e.g. to hide a help card). */
  onInvalidChange?: (invalid: boolean) => void;
}) {
  // Not editing: the formatted value. Editing (or left invalid): the text.
  const [editing, setEditing] = React.useState(false);
  const field = useField<string>({ initialValue: "" });
  // The blur that follows Enter (saved) or Escape (restored) is not a commit.
  const skipBlurRef = React.useRef(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const errorId = React.useId();
  const textSchema = React.useMemo(
    () => amountTextSchema({ number: schema, required: true }),
    [schema],
  );
  const revert = () => {
    skipBlurRef.current = true;
    field.reset();
    setEditing(false);
    inputRef.current?.blur();
  };
  useEscapeLayer(editing, revert, { within: [inputRef] });

  /** Saves the text if it is valid; else shows why. True when saved. */
  const commit = (): boolean => {
    const text = field.getValue();
    const result = textSchema.safeParse(text);
    const parsed = amountValue(text);
    if (!result.success || parsed === undefined) {
      field.setError(result.error?.issues[0]?.message ?? "Monto inválido");
      return false;
    }
    field.setError(null);
    setEditing(false);
    if (parsed !== value) onCommit(parsed);
    return true;
  };

  const error = editing ? field.error : null;
  const invalid = Boolean(error);
  const onInvalidRef = React.useRef(onInvalidChange);
  onInvalidRef.current = onInvalidChange;
  React.useEffect(() => {
    onInvalidRef.current?.(invalid);
  }, [invalid]);
  // The visible note sits under the field (fixed, in a portal: the header
  // clips its overflow). Placed when the error appears and on resize.
  const [noteAt, setNoteAt] = React.useState<{ left: number; top: number } | null>(null);
  React.useLayoutEffect(() => {
    if (!invalid) {
      setNoteAt(null);
      return undefined;
    }
    const place = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      setNoteAt({ left: Math.max(8, rect.left), top: rect.bottom + 6 });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [invalid]);
  return (
    <>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        spellCheck={false}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        title={error ? String(error) : undefined}
        className={className}
        value={editing ? field.getValue() : format(value)}
        onFocus={(event) => {
          skipBlurRef.current = false;
          if (!editing) {
            field.setValue(String(value));
            setEditing(true);
          }
          const target = event.currentTarget;
          // Select after React swaps the value in.
          requestAnimationFrame(() => target.select());
        }}
        onChange={(event) => field.setValue(event.target.value)}
        onBlur={() => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (commit()) {
              skipBlurRef.current = true;
              event.currentTarget.blur();
            }
          } else if (event.key === "Escape") {
            // Only reached without the Escape stack (the layer above takes it).
            event.preventDefault();
            revert();
          }
        }}
      />
      {error && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fin-inline-error"
              style={noteAt ? { left: noteAt.left, top: noteAt.top } : { visibility: "hidden" }}
            >
              <span id={errorId} role="alert" className="fin-inline-error__text">
                {ariaLabel}: {error}
              </span>
              <span className="fin-inline-error__hint" aria-hidden="true">
                Ej.: 12000 o 12 mil · Esc deja {format(value)}
              </span>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
