// What a headline number means, where it is: a small card under the metric
// on hover (after a short delay; instant when moving from another metric)
// or keyboard focus. A plain definition plus what YOUR numbers say right now
// ("queda $6,292 por debajo de tu reserva") and what a click does.
//
// Rendered in a portal (the metrics strip clips and masks its overflow),
// kept on screen by useFitInViewport, closed by the shared dismiss rule
// (outside press, scroll — e.g. the strip scrolled —, resize, Escape) and
// on leave / blur / click. Never intercepts the pointer.
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

const SHOW_DELAY_MS = 350;
// Moving from one metric to the next within this window shows at once.
const WARM_WINDOW_MS = 500;
let lastHiddenAt = 0;

export function useMetricHelp<T extends HTMLElement>(content: MetricHelpContent) {
  const id = React.useId();
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
    if (Date.now() - lastHiddenAt < WARM_WINDOW_MS) {
      show();
      return;
    }
    timer.current = setTimeout(show, SHOW_DELAY_MS);
  }, [show]);

  React.useEffect(() => clearTimer, []);
  useDismiss(open, [triggerRef, tipRef], hide, { escape: true });

  const triggerProps = {
    ref: triggerRef,
    onMouseEnter: schedule,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    onClick: hide,
    "aria-describedby": id,
  };

  const tip = open
    ? createPortal(
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          className="fin-help"
          style={{ left: anchor.left, top: anchor.top }}
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
    : // Closed: the description stays reachable for screen readers.
      <span id={id} className="fin-sr-only">
        {content.title}. {content.body} {content.detail ?? ""}
      </span>;

  return { triggerProps, tip };
}
