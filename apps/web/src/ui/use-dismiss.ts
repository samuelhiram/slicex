// Floating UI dismissal (menus, popovers, context menus): ONE rule shared by
// every floating component, so none of them closes on its own content.
//   - a press OUTSIDE every owned element (trigger + popover) closes;
//   - a press INSIDE never closes (text, padding, headings, separators,
//     disabled items) — only an item's own action decides that;
//   - scrolling INSIDE (the wheel over a long menu) never closes; scrolling
//     something else does (the anchor moved);
//   - a window resize closes (the anchor moved);
//   - Escape closes when asked (menus with their own key handling skip it).
//     This Escape is a plain `window` listener (bubble, not consumed): a
//     focused field still gets its own Escape first (MetricHelp opens on the
//     focus of "Liquidez hoy", whose Escape reverts the value). Surfaces
//     built on `useOverlay` use the Escape stack instead (use-overlay.ts),
//     whose top layer, when there is one, takes the key before this.
import * as React from "react";

type OwnedRef = React.RefObject<HTMLElement | null>;

/** Whether `target` lies inside any of the owned elements. */
export function isInsideAny(target: EventTarget | null, refs: readonly OwnedRef[]): boolean {
  if (typeof Node === "undefined" || !(target instanceof Node)) return false;
  for (const ref of refs) {
    if (ref.current?.contains(target)) return true;
  }
  return false;
}

export interface DismissOptions {
  /** Close on Escape (default false). */
  escape?: boolean;
  /** Close on an outside scroll (default true; false for panels / dialogs). */
  scroll?: boolean;
  /** Close on a window resize (default true; false for panels / dialogs). */
  resize?: boolean;
}

/**
 * While `open`, calls `onDismiss` on an outside press, an outside scroll, a
 * resize or (optionally) Escape. `refs` = everything the floating UI owns
 * (its trigger and its popover, which usually lives in a portal).
 */
export function useDismiss(
  open: boolean,
  refs: readonly OwnedRef[],
  onDismiss: () => void,
  options: DismissOptions = {},
): void {
  const latest = React.useRef({ refs, onDismiss });
  latest.current = { refs, onDismiss };
  const escape = options.escape === true;
  const scroll = options.scroll !== false;
  const resize = options.resize !== false;

  React.useEffect(() => {
    if (!open) return undefined;
    const dismiss = () => latest.current.onDismiss();
    const outside = (event: Event) => {
      if (!isInsideAny(event.target, latest.current.refs)) dismiss();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("pointerdown", outside, true);
    if (scroll) window.addEventListener("scroll", outside, true);
    if (resize) window.addEventListener("resize", dismiss);
    if (escape) window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      if (scroll) window.removeEventListener("scroll", outside, true);
      if (resize) window.removeEventListener("resize", dismiss);
      if (escape) window.removeEventListener("keydown", key);
    };
  }, [open, escape, scroll, resize]);
}
