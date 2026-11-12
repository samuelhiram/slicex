// What a headline number means, where it is: a small card under the metric
// on hover (after a short delay; instant when moving from another metric)
// or keyboard focus. A plain definition plus what YOUR numbers say right now
// ("queda $6,292 por debajo de tu reserva") and what a click does.
//
// Rendered in a portal (the metrics row clips its overflow), kept on screen
// by useFitInViewport, closed by the shared dismiss rule (outside press,
// scroll, resize, Escape) and on blur / click. The card can be hovered
// (WCAG 1.4.13): leaving the metric hides it after a short grace period, and
// moving onto the card keeps it open.
//
// Closed, the description stays in the DOM with `hidden`: still the metric's
// `aria-describedby`, never read in the page flow (UX-56).
//
// `toggle: true` (informative metrics, which do nothing else on click): the
// metric is a `<button aria-expanded>` and a click / Enter shows or hides the
// card; focus alone does not open it.
import * as React from "react";
import { createPortal } from "react-dom";
import { useFitInViewport } from "../../ui/fit-in-viewport";
import { useDismiss } from "../../ui/use-dismiss";

export interface MetricHelpContent {
  title: string;
  /** What the number is, in general terms. */
  body: string;
  /** What the person's own numbers say now (optional). */
  detail?: string;
  /** What a click on the metric does (optional). */
  action?: string;
  /** Tone of `detail`. */
  tone?: "ok" | "low" | "negative";
}

export interface MetricHelpOptions {
  /** The metric is a disclosure button: click toggles the card (no focus-open). */
  toggle?: boolean;
}

const SHOW_DELAY_MS = 350;
// Moving from one metric to the next within this window shows at once.
const WARM_WINDOW_MS = 500;
// Leaving the metric (or the card) hides the card after this grace period,
// so the pointer can travel onto the card.
export const HIDE_GRACE_MS = 300;
let lastHiddenAt = 0;

export function useMetricHelp<T extends HTMLElement>(
  content: MetricHelpContent,
  options: MetricHelpOptions = {},
) {
  const id = React.useId();
  const toggleMode = options.toggle === true;
  const triggerRef = React.useRef<T | null>(null);
  const tipRef = React.useRef<HTMLDivElement | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = React.useState<{ left: number; top: number } | null>(null);
  const open = anchor !== null;
  useFitInViewport(tipRef, open, [anchor]);

  const clearTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  // How the card was opened: a card opened with a click stays until a
  // second click (or Escape / outside press / blur), not on pointer leave.
  const openedByRef = React.useRef<"hover" | "focus" | "click">("hover");
  const show = React.useCallback(() => {
    clearTimer();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ left: Math.max(8, rect.left), top: rect.bottom + 8 });
  }, []);
  const hide = React.useCallback(() => {
    clearTimer();
    setAnchor((current) => {
      if (current !== null) lastHiddenAt = Date.now();
      return null;
    });
  }, []);
  const schedule = React.useCallback(() => {
    clearTimer();
    const byHover = () => {
      openedByRef.current = "hover";
      show();
    };
    if (Date.now() - lastHiddenAt < WARM_WINDOW_MS) {
      byHover();
      return;
    }
    timer.current = setTimeout(byHover, SHOW_DELAY_MS);
  }, [show]);
  // Pointer left the metric or the card: hide unless it comes back in time.
  const scheduleHide = React.useCallback(() => {
    clearTimer();
    if (openedByRef.current === "click") return;
    timer.current = setTimeout(hide, HIDE_GRACE_MS);
  }, [hide]);
  const showByFocus = React.useCallback(() => {
    openedByRef.current = "focus";
    show();
  }, [show]);
  const toggle = React.useCallback(() => {
    // Shown by hovering: the click pins it rather than closing it.
    if (open && openedByRef.current === "click") {
      hide();
      return;
    }
    openedByRef.current = "click";
    show();
  }, [open, hide, show]);

  React.useEffect(() => clearTimer, []);
  useDismiss(open, [triggerRef, tipRef], hide, { escape: true });

  const triggerProps = {
    ref: triggerRef,
    onMouseEnter: schedule,
    onMouseLeave: scheduleHide,
    onFocus: toggleMode ? undefined : showByFocus,
    onBlur: hide,
    onClick: toggleMode ? toggle : hide,
    "aria-describedby": id,
    ...(toggleMode ? { "aria-expanded": open } : {}),
  };

  const tip = open
    ? createPortal(
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          className="fin-help"
          style={{ left: anchor.left, top: anchor.top }}
          onMouseEnter={clearTimer}
          onMouseLeave={scheduleHide}
        >
          <strong className="fin-help__title">{content.title}</strong>
          <span className="fin-help__body">{content.body}</span>
          {content.detail ? (
            <span className="fin-help__detail" data-tone={content.tone ?? "ok"}>
              {content.detail}
            </span>
          ) : null}
          {content.action ? <span className="fin-help__action">{content.action}</span> : null}
        </div>,
        document.body,
      )
    : // Closed: still the metric's description (aria-describedby reads
      // hidden elements), but out of the reading flow.
      <span id={id} hidden>
        {content.title}. {content.body} {content.detail ?? ""}
      </span>;

  return { triggerProps, tip, id, open, show, hide };
}
