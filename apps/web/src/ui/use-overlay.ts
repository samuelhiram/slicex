// Open / close contract shared by every surface of the app (menus,
// popovers, side panels, dialogs). Three pieces, usable on their own:
//
//   useRestoreFocus  remembers who had the focus when a surface opened and
//                    gives it back when it closes (or to a fallback), so
//                    closing never leaves the focus on <body>.
//   useEscapeLayer   the app's ONE Escape: a stack of layers where only the
//                    top one (the last activated) gets the key.
//   useOverlay       both, plus "press outside closes" (useDismiss) for
//                    menus / popovers, and the initial focus.
//
// Escape stack, in detail:
//   - one `keydown` listener on `window`, capture phase, for the whole
//     stack: it runs before any element's own handler, so the surface on
//     top wins even over a focused control inside a surface below it;
//   - the layer that takes the key gets `preventDefault` + `stopPropagation`
//     (nothing else hears that Escape: not the canvas, not a dialog's old
//     `window` listener, not `useDismiss`); with no layer to take it the
//     event is left untouched;
//   - a layer may be scoped (`within`): it only takes an Escape pressed
//     inside its own elements (a toast, a side panel that stays open while
//     you work on the canvas) and is transparent otherwise — the key goes on
//     to the next layer down;
//   - order = activation order, taken while rendering: parents render before
//     children, so a surface opened together with its parent (a calendar
//     inside a dialog) still lands above it;
//   - a control INSIDE a layer that needs Escape for itself (a field whose
//     Escape reverts what you typed) must become a layer too while it needs
//     it — `useEscapeLayer(editing, revert)` — its own onKeyDown would never
//     see the key. (The DateField calendar is one: a layer above the dialog.)
//   - `useDismiss({ escape: true })` keeps its plain bubble listener (not
//     consumed): it hears Escape only when no layer took it.
import * as React from "react";
import { useDismiss } from "./use-dismiss";

type ElementRef = React.RefObject<HTMLElement | null>;

// --- focus -------------------------------------------------------------------

/**
 * Focuses `el` if it can take the focus right now (connected, not <body>,
 * not disabled, not inside an `inert` subtree). Returns true when the focus
 * actually landed on it.
 */
export function focusIfPossible(el: Element | null | undefined): boolean {
  if (!el || !el.isConnected) return false;
  const doc = el.ownerDocument;
  if (el === doc.body || el === doc.documentElement) return false;
  if (typeof (el as HTMLElement).focus !== "function") return false;
  if (el.matches(":disabled") || el.closest("[inert]") !== null) return false;
  (el as HTMLElement).focus({ preventScroll: true });
  return doc.activeElement === el;
}

/**
 * Whether the focus has nowhere sensible to be: on <body> (its element was
 * removed), on a node that is gone or now inert, or still inside the surface
 * that is closing. A focus the person moved elsewhere (a click on another
 * field closed a menu) is NOT lost and is never taken back.
 */
function focusIsLost(doc: Document, container: HTMLElement | null): boolean {
  const current = doc.activeElement;
  if (!current || current === doc.body || current === doc.documentElement) return true;
  if (!current.isConnected || current.closest("[inert]") !== null) return true;
  return container !== null && container.contains(current);
}

export interface RestoreFocusOptions {
  /**
   * The surface itself. Needed when it stays mounted while closed (a
   * collapsed panel): a focus still inside it then counts as lost.
   */
  containerRef?: ElementRef;
}

/**
 * Focus return for a surface. When `active` turns true it remembers
 * `document.activeElement` (read while rendering, i.e. before any effect of
 * the surface moves the focus inside); when `active` turns false or the
 * component unmounts, and the focus is lost (see above), it gives the focus
 * back to that element if it is still in the DOM and focusable, else to
 * `fallback()` (e.g. the canvas host). Runs in a passive-effect cleanup:
 * after the commit that closed the surface and lifted `inert` from the page.
 *
 * @example
 * // A dialog mounted only while open:
 * useRestoreFocus(true, () => hostRef.current);
 * // A panel that stays mounted:
 * useRestoreFocus(open, undefined, { containerRef: panelRef });
 */
export function useRestoreFocus(
  active: boolean,
  fallback?: () => HTMLElement | null,
  options: RestoreFocusOptions = {},
): void {
  const latest = React.useRef({ fallback, containerRef: options.containerRef });
  latest.current = { fallback, containerRef: options.containerRef };
  const openerRef = React.useRef<Element | null>(null);
  const wasActiveRef = React.useRef(false);
  if (active && !wasActiveRef.current) {
    openerRef.current = typeof document === "undefined" ? null : document.activeElement;
  }
  wasActiveRef.current = active;

  React.useEffect(() => {
    if (!active) return undefined;
    return () => {
      if (typeof document === "undefined") return;
      const { fallback: fallbackNow, containerRef } = latest.current;
      if (!focusIsLost(document, containerRef?.current ?? null)) return;
      if (focusIfPossible(openerRef.current)) return;
      focusIfPossible(fallbackNow?.() ?? null);
    };
  }, [active]);
}

// --- Escape stack -------------------------------------------------------------

interface EscapeLayer {
  /** Activation order (higher = on top), renewed on each activation. */
  seq: number;
  onEscape: () => void;
  within: readonly ElementRef[] | null;
}

const layers = new Set<EscapeLayer>();
let nextSeq = 0;

function takes(layer: EscapeLayer, target: EventTarget | null): boolean {
  if (layer.within === null) return true;
  if (typeof Node === "undefined" || !(target instanceof Node)) return false;
  for (const ref of layer.within) {
    if (ref.current?.contains(target)) return true;
  }
  return false;
}

function onEscapeKey(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
  let top: EscapeLayer | null = null;
  for (const layer of layers) {
    if (top !== null && layer.seq <= top.seq) continue;
    if (takes(layer, event.target)) top = layer;
  }
  if (top === null) return;
  event.preventDefault();
  event.stopPropagation();
  top.onEscape();
}

function pushLayer(layer: EscapeLayer): void {
  if (layers.size === 0 && typeof window !== "undefined") {
    window.addEventListener("keydown", onEscapeKey, true);
  }
  layers.add(layer);
}

function removeLayer(layer: EscapeLayer): void {
  if (!layers.delete(layer)) return;
  if (layers.size === 0 && typeof window !== "undefined") {
    window.removeEventListener("keydown", onEscapeKey, true);
  }
}

export interface EscapeLayerOptions {
  /**
   * Scope: the layer only takes an Escape pressed inside one of these
   * elements (`event.target` within them); anywhere else it is transparent
   * and the key goes on to the layer below. Omit it for a surface that owns
   * Escape while open (dialog, menu, popover, calendar).
   */
  within?: readonly ElementRef[];
}

/**
 * While `active`, this component is a layer of the Escape stack: Escape
 * calls `onEscape` (always the latest one passed) when this layer is the top
 * one that takes the key, and the event is consumed. Layers activated later
 * sit above. `onEscape` usually closes the surface, which deactivates the
 * layer, so the next Escape goes to the one below.
 *
 * @example
 * const [open, setOpen] = React.useState(false);
 * useEscapeLayer(open, () => setOpen(false));
 * // Only when the focus is inside the toast:
 * useEscapeLayer(visible, close, { within: [toastRef] });
 */
export function useEscapeLayer(
  active: boolean,
  onEscape: () => void,
  options: EscapeLayerOptions = {},
): void {
  const layerRef = React.useRef<EscapeLayer | null>(null);
  if (layerRef.current === null) layerRef.current = { seq: 0, onEscape, within: null };
  const layer = layerRef.current;
  // Latest callback / scope without re-registering (like useDismiss).
  layer.onEscape = onEscape;
  layer.within = options.within ?? null;
  // Activation order, taken while rendering (parents first): see header.
  const wasActiveRef = React.useRef(false);
  if (active && !wasActiveRef.current) {
    nextSeq += 1;
    layer.seq = nextSeq;
  }
  wasActiveRef.current = active;

  React.useEffect(() => {
    if (!active) return undefined;
    pushLayer(layer);
    return () => removeLayer(layer);
  }, [active, layer]);
}

// --- useOverlay -----------------------------------------------------------------

/**
 * - `menu` / `popover`: floating, transient. Press outside, outside scroll
 *   or resize close it (useDismiss); Escape closes it from anywhere.
 * - `panel`: a non-modal side surface that stays open while you work.
 *   Escape closes it only from inside it (or its trigger); outside presses
 *   never close it.
 * - `modal`: a dialog over an inert page. Escape closes it; a press outside
 *   does NOT (a dialog with changes must ask before discarding them); the
 *   focus moves inside on open.
 */
export type OverlayKind = "menu" | "popover" | "panel" | "modal";

export interface OverlayOptions {
  open: boolean;
  /** Called by Escape / press outside. Usually sets `open` to false. */
  onClose: () => void;
  kind: OverlayKind;
  /** The surface's root element (the dialog box, the menu, the panel). */
  containerRef?: ElementRef;
  /**
   * The control that opens it: part of the surface for "press outside",
   * and where the focus returns when the element focused at opening is gone.
   */
  triggerRef?: ElementRef;
  /** Element focused when the surface opens (implies `autoFocus`). */
  initialFocusRef?: ElementRef;
  /**
   * Move the focus inside on open: to `initialFocusRef`, else to the
   * container (given tabIndex=-1 if it has none) unless the focus is
   * already inside it. Default: true for `modal` or with `initialFocusRef`.
   */
  autoFocus?: boolean;
  /** Give the focus back on close (default true). */
  restoreFocus?: boolean;
  /** Last resort for the focus on close (after the opener and the trigger). */
  fallbackFocus?: () => HTMLElement | null;
  /** Escape closes it (default true). */
  closeOnEscape?: boolean;
  /**
   * "global": Escape from anywhere while it is the top layer; "within": only
   * from inside the container / trigger. Default: "within" for `panel`.
   */
  escapeScope?: "global" | "within";
  /**
   * A press outside the container and trigger closes it. Default: true for
   * `menu` / `popover`, false for `panel` / `modal`. Needs `containerRef`.
   */
  closeOnOutside?: boolean;
}

/**
 * The whole open / close contract of a surface in one call: Escape layer,
 * press-outside policy by kind, initial focus and focus return. Returns
 * nothing; the caller keeps owning `open`.
 *
 * @example
 * const panelRef = React.useRef<HTMLDivElement | null>(null);
 * const buttonRef = React.useRef<HTMLButtonElement | null>(null);
 * useOverlay({ open, onClose: () => setOpen(false), kind: "menu",
 *   containerRef: panelRef, triggerRef: buttonRef, initialFocusRef: firstItemRef });
 */
export function useOverlay(options: OverlayOptions): void {
  const { open, onClose, kind, containerRef, triggerRef, initialFocusRef } = options;
  const floating = kind === "menu" || kind === "popover";
  const restoreFocus = options.restoreFocus ?? true;
  const closeOnEscape = options.closeOnEscape ?? true;
  const closeOnOutside = options.closeOnOutside ?? floating;
  const escapeScope = options.escapeScope ?? (kind === "panel" ? "within" : "global");
  const autoFocus = options.autoFocus ?? (initialFocusRef !== undefined || kind === "modal");

  const owned = React.useMemo(
    () => [containerRef, triggerRef].filter((ref): ref is ElementRef => ref !== undefined),
    [containerRef, triggerRef],
  );

  // Press outside: menus / popovers also close when their anchor moves
  // (outside scroll, resize); a panel or dialog only on the press itself.
  useDismiss(
    open && closeOnOutside && containerRef !== undefined,
    owned,
    onClose,
    floating ? {} : { scroll: false, resize: false },
  );

  useEscapeLayer(
    open && closeOnEscape,
    onClose,
    escapeScope === "within" && owned.length > 0 ? { within: owned } : {},
  );

  const fallbackRef = React.useRef(options.fallbackFocus);
  fallbackRef.current = options.fallbackFocus;
  const fallback = React.useCallback(() => {
    const trigger = triggerRef?.current ?? null;
    if (trigger && trigger.isConnected && !trigger.matches(":disabled") && trigger.closest("[inert]") === null) {
      return trigger;
    }
    return fallbackRef.current?.() ?? null;
  }, [triggerRef]);
  useRestoreFocus(open && restoreFocus, fallback, { containerRef });

  React.useEffect(() => {
    if (!open || !autoFocus) return;
    if (focusIfPossible(initialFocusRef?.current)) return;
    const container = containerRef?.current ?? null;
    if (!container || container.contains(container.ownerDocument.activeElement)) return;
    if (!container.hasAttribute("tabindex")) container.tabIndex = -1;
    focusIfPossible(container);
  }, [open, autoFocus]);
}
