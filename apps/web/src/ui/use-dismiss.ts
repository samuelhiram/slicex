// Floating UI dismissal (menus, popovers, context menus): ONE rule shared by
// every floating component, so none of them closes on its own content.
//   - a press OUTSIDE every owned element (trigger + popover) closes;
//   - a press INSIDE never closes (text, padding, headings, separators,
//     disabled items) — only an item's own action decides that;
//   - scrolling INSIDE (the wheel over a long menu) never closes; scrolling
//     something else does (the anchor moved);
//   - a window resize closes (the anchor moved);
//   - Escape closes when asked (menus with their own key handling skip it).
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
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", dismiss);
    if (escape) window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", dismiss);
      if (escape) window.removeEventListener("keydown", key);
    };
  }, [open, escape]);
}
