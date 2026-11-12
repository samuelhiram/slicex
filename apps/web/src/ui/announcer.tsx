// What just happened, said once for everyone: after a commit (Guardar,
// Aplicar, soltar un gesto, Rec) a component calls
//
//   announce({ message: "Guardado. Tu punto más bajo: −$1,292 el 27 nov", undo });
//
// and the provider shows it in two places:
//   (a) a `role="status"` live region, ALWAYS mounted (a region that mounts
//       with its text is not announced) and visually hidden, with the last
//       message; each message goes in a fresh node, so the same text twice
//       is announced twice;
//   (b) a visible notice at the bottom centre of the stage, clear of the
//       canvas' bottom scrollbar: the text, "Deshacer" when there is an
//       `undo`, and × ("Cerrar aviso"). It never closes by itself (WCAG 2.2.1):
//       the next `announce` replaces it; ×, Escape (from inside it: a scoped
//       layer of the Escape stack) or "Deshacer" close it. "Deshacer" runs
//       `undo` and announces "Deshecho".
//
// Performance: `announce` is stable for the provider's whole life (the
// context value never changes, consumers never re-render because of it),
// and the provider's state changes ONLY inside `announce` / close — never
// per frame. Its children are passed through, so React skips them.
//
// Outside a provider `useAnnounce()` is a no-op (components tested alone).
import * as React from "react";
import { useEscapeLayer } from "./use-overlay";

export interface Announcement {
  /** The sentence to say and show ("Guardado. Tu caja hoy: $11,400"). */
  message: string;
  /** Makes the notice offer "Deshacer"; e.g. `() => bridge.core.undo()`. */
  undo?: () => void;
  /** Text of the undo button (default "Deshacer"). */
  undoLabel?: string;
}

export type AnnounceFn = (announcement: Announcement) => void;

const NO_ANNOUNCE: AnnounceFn = () => {};
const AnnounceContext = React.createContext<AnnounceFn>(NO_ANNOUNCE);

/**
 * The `announce` function of the nearest `AnnouncerProvider` (a no-op
 * outside one). Stable: safe in effect / callback dependency lists.
 *
 * @example
 * const announce = useAnnounce();
 * if (bridge.applyValleyFix(fix)) {
 *   announce({ message: "Arreglo aplicado. Sin alertas", undo: () => bridge.core.undo() });
 * }
 */
export function useAnnounce(): AnnounceFn {
  return React.useContext(AnnounceContext);
}

export interface AnnouncerProviderProps {
  children?: React.ReactNode;
  /**
   * Where the focus goes when the notice closes while it had the focus and
   * the element the focus came from is gone (e.g. the canvas host).
   */
  fallbackFocus?: () => HTMLElement | null;
  /** The notice is inert (not focusable, hidden from AT) — e.g. a dialog is open. */
  inert?: boolean;
  /**
   * Receives `announce` for code that sits ABOVE the provider (the shell's
   * own handlers): `announceRef.current?.({ message })`.
   */
  announceRef?: React.RefObject<AnnounceFn | null>;
}

interface Notice {
  message: string;
  undo?: () => void;
  undoLabel: string;
}

interface AnnouncerState {
  /** Bumped by every message: the key of the live region's text node. */
  seq: number;
  /** Text of the live region ("" before the first message). */
  live: string;
  /** The visible notice, or null. */
  notice: Notice | null;
}

const INITIAL_STATE: AnnouncerState = { seq: 0, live: "", notice: null };

/**
 * Hosts the app's announcements: a persistent `role="status"` region and
 * the visible notice. Mount once around the shell; read `announce` with
 * `useAnnounce()`.
 *
 * @example
 * <AnnouncerProvider fallbackFocus={() => hostRef.current} inert={dialogOpen}>
 *   {shell}
 * </AnnouncerProvider>
 */
export function AnnouncerProvider({
  children,
  fallbackFocus,
  inert = false,
  announceRef,
}: AnnouncerProviderProps) {
  const [state, setState] = React.useState<AnnouncerState>(INITIAL_STATE);
  const seqRef = React.useRef(0);

  const announce = React.useCallback<AnnounceFn>((announcement) => {
    const message = announcement.message.trim();
    if (message === "") return;
    seqRef.current += 1;
    const seq = seqRef.current;
    setState({
      seq,
      live: message,
      notice: {
        message,
        undo: announcement.undo,
        undoLabel: announcement.undoLabel ?? "Deshacer",
      },
    });
  }, []);

  React.useImperativeHandle(announceRef, () => announce, [announce]);

  const close = React.useCallback(() => {
    setState((current) => (current.notice === null ? current : { ...current, notice: null }));
  }, []);

  const noticeRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  // Focus bookkeeping: whether the focus is inside the notice, and the
  // element it came from (where it goes back when the notice closes).
  const focusInsideRef = React.useRef(false);
  const cameFromRef = React.useRef<Element | null>(null);
  const fallbackRef = React.useRef(fallbackFocus);
  fallbackRef.current = fallbackFocus;

  const runUndo = () => {
    const undo = state.notice?.undo;
    if (!undo) return;
    close();
    const before = seqRef.current;
    undo();
    // `undo` may announce its own result; otherwise say it was undone.
    if (seqRef.current === before) {
      seqRef.current += 1;
      const seq = seqRef.current;
      setState((current) => ({ ...current, seq, live: "Deshecho" }));
    }
  };

  // Escape closes it — only from inside it: elsewhere Escape belongs to
  // whatever has the focus (the canvas, a field, a dialog).
  useEscapeLayer(state.notice !== null, close, { within: [noticeRef] });

  // The notice changed or closed while it had the focus: keep the focus in
  // it (on ×) while it shows, or send it back where it came from.
  React.useLayoutEffect(() => {
    if (!focusInsideRef.current) return;
    const doc = document;
    const current = doc.activeElement;
    const lost = !current || current === doc.body || !current.isConnected;
    if (!lost) {
      if (!noticeRef.current?.contains(current)) focusInsideRef.current = false;
      return;
    }
    if (state.notice !== null && closeRef.current) {
      closeRef.current.focus({ preventScroll: true });
      return;
    }
    focusInsideRef.current = false;
    const back = cameFromRef.current;
    cameFromRef.current = null;
    if (back instanceof HTMLElement && back.isConnected && back !== doc.body) {
      back.focus({ preventScroll: true });
      if (doc.activeElement === back) return;
    }
    fallbackRef.current?.()?.focus({ preventScroll: true });
  }, [state.notice]);

  const textId = React.useId();
  const notice = state.notice;
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div className="fin-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {state.live ? <span key={state.seq}>{state.live}</span> : null}
      </div>
      {notice ? (
        <div
          ref={noticeRef}
          className="fin-toast"
          role="group"
          aria-labelledby={textId}
          inert={inert}
          onFocus={(event) => {
            if (!focusInsideRef.current) {
              const from = event.relatedTarget;
              cameFromRef.current = from instanceof Element && !noticeRef.current?.contains(from) ? from : null;
            }
            focusInsideRef.current = true;
          }}
          onBlur={(event) => {
            // Moved to another element outside: no longer ours to bring back.
            // (No relatedTarget: the focused button was removed, or the
            // window lost the focus — still ours.)
            const next = event.relatedTarget;
            if (next instanceof Node && !noticeRef.current?.contains(next)) {
              focusInsideRef.current = false;
            }
          }}
        >
          <p id={textId} className="fin-toast__text">
            {notice.message}
          </p>
          {notice.undo ? (
            <button type="button" className="fin-toast__undo" onClick={runUndo}>
              {notice.undoLabel}
            </button>
          ) : null}
          <button
            ref={closeRef}
            type="button"
            className="fin-toast__close"
            aria-label="Cerrar aviso"
            title="Cerrar aviso"
            onClick={close}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M5 5l10 10M15 5 5 15" />
            </svg>
          </button>
        </div>
      ) : null}
    </AnnounceContext.Provider>
  );
}
