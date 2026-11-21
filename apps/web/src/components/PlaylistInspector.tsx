// F11 — Inspector panel for the currently selected clip(s).
//
// Subscribes granularly to the core (only re-renders when the focused
// clip id or its mutable fields change). Edits go straight to the core's
// idempotent set* helpers; text inputs are debounced 60ms so the user can
// type without flooding undo entries (the core's normalize step still
// collapses identical writes anyway, but the debounce keeps the UI
// snappy and the history clean).
//
// Visual: collapsed by default, opens to a right-side rail. Pure SliceX
// palette (no FL colours), driven by the same CSS vars as the rest of
// the shell.
//
// UX-27: ONE toggle button (a stable node, `aria-expanded`), and the open /
// close contract of `useOverlay` ("panel"): opening moves the focus into the
// panel, Escape from inside closes it, and closing gives the focus back to
// the toggle. UX-58: every text in Spanish.
import * as React from "react";
import type { PlaylistClip, PlaylistCore } from "@slicex/canvas";
import { useOverlay } from "../ui/use-overlay";

interface InspectorState {
  selectedClipIds: string[];
  focusedClip: PlaylistClip | null;
}

function snapshot(core: PlaylistCore): InspectorState {
  const state = core.getState();
  const selectedClipIds = state.selection.clipIds;
  const focusedClip =
    selectedClipIds.length > 0
      ? (state.clips.find((c) => c.id === selectedClipIds[0]) ?? null)
      : null;
  return { selectedClipIds, focusedClip };
}

function shallowSelectionEqual(
  a: InspectorState,
  b: InspectorState,
): boolean {
  if (a.selectedClipIds.length !== b.selectedClipIds.length) return false;
  for (let i = 0; i < a.selectedClipIds.length; i += 1) {
    if (a.selectedClipIds[i] !== b.selectedClipIds[i]) return false;
  }
  // Identity check on the clip object is enough — the reducer always
  // returns a new clip object when the clip changes; equal reference =
  // no field changed.
  return a.focusedClip === b.focusedClip;
}

function useInspectorState(core: PlaylistCore | null): InspectorState {
  const [state, setState] = React.useState<InspectorState>(() =>
    core
      ? snapshot(core)
      : { selectedClipIds: [], focusedClip: null },
  );
  React.useEffect(() => {
    if (!core) return undefined;
    setState(snapshot(core));
    const sub = core.subscribe(() => {
      const next = snapshot(core);
      setState((prev) => (shallowSelectionEqual(prev, next) ? prev : next));
    });
    return () => sub.unsubscribe();
  }, [core]);
  return state;
}

// Tiny debounce so the label input doesn't dispatch on every keystroke.
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function PlaylistInspector({
  core,
  fallbackFocus,
}: {
  core: PlaylistCore | null;
  /** Where the focus goes on close when the toggle cannot take it. */
  fallbackFocus?: () => HTMLElement | null;
}) {
  const [open, setOpen] = React.useState(false);
  const { selectedClipIds, focusedClip } = useInspectorState(core);
  const toggleRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const panelId = React.useId();
  const titleId = React.useId();
  const close = React.useCallback(() => setOpen(false), []);
  useOverlay({
    open: open && core !== null,
    onClose: close,
    kind: "panel",
    containerRef: panelRef,
    triggerRef: toggleRef,
    autoFocus: true,
    fallbackFocus,
  });

  if (!core) {
    return null;
  }

  return (
    <aside
      className={open ? "playlist-inspector" : "playlist-inspector playlist-inspector--collapsed"}
      aria-label="Inspector"
    >
      <button
        ref={toggleRef}
        type="button"
        className="playlist-inspector__toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="Inspector"
        title={open ? "Cerrar inspector" : "Abrir inspector"}
      >
        <span aria-hidden="true">{open ? "▶" : "◀"}</span>
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          className="playlist-inspector__panel"
          role="group"
          aria-labelledby={titleId}
        >
          <header className="playlist-inspector__header">
            <h2 id={titleId} className="playlist-inspector__title">
              Inspector
            </h2>
          </header>
          <div className="playlist-inspector__body">
            {selectedClipIds.length === 0 ? (
              <p className="playlist-inspector__empty">
                Ningún objeto seleccionado. Elige uno en la línea de tiempo.
              </p>
            ) : selectedClipIds.length === 1 && focusedClip ? (
              <SingleClipInspector core={core} clip={focusedClip} />
            ) : (
              <MultiClipInspector core={core} clipIds={selectedClipIds} />
            )}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function SingleClipInspector({
  core,
  clip,
}: {
  core: PlaylistCore;
  clip: PlaylistClip;
}) {
  const [label, setLabel] = React.useState(clip.label);
  const debouncedLabel = useDebounced(label, 60);
  React.useEffect(() => {
    setLabel(clip.label);
  }, [clip.id, clip.label]);
  React.useEffect(() => {
    if (debouncedLabel !== clip.label) {
      core.setClipLabel(clip.id, debouncedLabel);
    }
  }, [debouncedLabel, clip.id, clip.label, core]);

  const stretchRatio = clip.stretchRatio ?? 1;
  const contentOffset = clip.contentOffset ?? 0;

  return (
    <div className="playlist-inspector__form">
      <label className="playlist-inspector__field">
        <span>Nombre</span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label className="playlist-inspector__field">
        <span>Color</span>
        <input
          type="color"
          value={clip.color}
          onChange={(e) => core.setClipColor(clip.id, e.target.value)}
        />
      </label>
      <label className="playlist-inspector__field playlist-inspector__field--inline">
        <input
          type="checkbox"
          checked={clip.muted === true}
          onChange={() => core.toggleClipMute(clip.id)}
        />
        <span>Silenciado (fuera del cálculo)</span>
      </label>
      <label className="playlist-inspector__field">
        <span>Desfase del contenido (días)</span>
        <input
          type="number"
          step={0.01}
          value={contentOffset}
          onChange={(e) =>
            core.setClipContentOffset(clip.id, Number(e.target.value) || 0)
          }
        />
      </label>
      <label className="playlist-inspector__field">
        <span>Estiramiento</span>
        <input
          type="number"
          step={0.01}
          min={0.01}
          value={stretchRatio}
          onChange={(e) =>
            core.setClipStretchRatio(clip.id, Number(e.target.value) || 1)
          }
        />
      </label>
      {clip.groupId !== undefined ? (
        <div className="playlist-inspector__field">
          <span>Grupo</span>
          <div className="playlist-inspector__group-row">
            <code>{clip.groupId}</code>
            <button
              type="button"
              onClick={() => core.setClipGroup(clip.id, null)}
            >
              Desagrupar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MultiClipInspector({
  core,
  clipIds,
}: {
  core: PlaylistCore;
  clipIds: string[];
}) {
  return (
    <div className="playlist-inspector__multi">
      <p>{clipIds.length} objetos seleccionados.</p>
      <div className="playlist-inspector__multi-actions">
        <button
          type="button"
          onClick={() => core.setClipsMuted(clipIds, true)}
        >
          Silenciar todos
        </button>
        <button
          type="button"
          onClick={() => core.setClipsMuted(clipIds, false)}
        >
          Reactivar todos
        </button>
        <button type="button" onClick={() => core.groupSelection()}>
          Agrupar
        </button>
        <button type="button" onClick={() => core.ungroupSelection()}>
          Desagrupar
        </button>
      </div>
    </div>
  );
}
