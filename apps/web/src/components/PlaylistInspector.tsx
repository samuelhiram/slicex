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
import * as React from "react";
import type { PlaylistClip, PlaylistCore } from "@slicex/canvas";

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

export function PlaylistInspector({ core }: { core: PlaylistCore | null }) {
  const [collapsed, setCollapsed] = React.useState(true);
  const { selectedClipIds, focusedClip } = useInspectorState(core);

  if (!core) {
    return null;
  }

  const toggleButton = (
    <button
      type="button"
      className="playlist-inspector__toggle"
      onClick={() => setCollapsed((c) => !c)}
      aria-label={collapsed ? "Open inspector" : "Close inspector"}
      title={collapsed ? "Open inspector" : "Close inspector"}
    >
      {collapsed ? "◀" : "▶"}
    </button>
  );

  if (collapsed) {
    return (
      <aside
        className="playlist-inspector playlist-inspector--collapsed"
        aria-label="Inspector"
      >
        {toggleButton}
      </aside>
    );
  }

  return (
    <aside className="playlist-inspector" aria-label="Inspector">
      <header className="playlist-inspector__header">
        <strong>Inspector</strong>
        {toggleButton}
      </header>
      <div className="playlist-inspector__body">
        {selectedClipIds.length === 0 ? (
          <p className="playlist-inspector__empty">No clip selected.</p>
        ) : selectedClipIds.length === 1 && focusedClip ? (
          <SingleClipInspector core={core} clip={focusedClip} />
        ) : (
          <MultiClipInspector core={core} clipIds={selectedClipIds} />
        )}
      </div>
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
        <span>Label</span>
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
        <span>Muted</span>
      </label>
      <label className="playlist-inspector__field">
        <span>Content offset (beats)</span>
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
        <span>Stretch ratio</span>
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
          <span>Group</span>
          <div className="playlist-inspector__group-row">
            <code>{clip.groupId}</code>
            <button
              type="button"
              onClick={() => core.setClipGroup(clip.id, null)}
            >
              Ungroup
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
      <p>{clipIds.length} clips selected.</p>
      <div className="playlist-inspector__multi-actions">
        <button
          type="button"
          onClick={() => core.setClipsMuted(clipIds, true)}
        >
          Mute all
        </button>
        <button
          type="button"
          onClick={() => core.setClipsMuted(clipIds, false)}
        >
          Unmute all
        </button>
        <button type="button" onClick={() => core.groupSelection()}>
          Group
        </button>
        <button type="button" onClick={() => core.ungroupSelection()}>
          Ungroup
        </button>
      </div>
    </div>
  );
}
