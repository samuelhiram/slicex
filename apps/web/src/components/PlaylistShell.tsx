import React from "react";
import {
  PLAYLIST_TOOL_HOTKEYS,
  createPlaylistCore,
  createPlaylistInteractionController,
  createPlaylistRenderer,
  type PlaylistContextMenu,
  type PlaylistCore,
  type PlaylistMarkerKind,
  type PlaylistMetrics,
  type PlaylistSnapMode,
  type PlaylistToolId,
} from "@slicex/canvas";
import { createDemoFinancialDocument } from "@slicex/core";
import type { FinancialItem } from "@slicex/core";
import { PlaylistInspector } from "./PlaylistInspector";
import type { FinancialBridgeApi } from "../finance/bridge-api";
import { FinancialBridge } from "../finance/financial-bridge";
import {
  FINANCE_PLAYLIST_METRICS,
  createFinancialPlaylistState,
} from "../finance/mapping";
import { createCalendarTimeAxis } from "../finance/time-axis";
import { FinancialSummaryBar } from "../finance/components/FinancialSummaryBar";
import { PlayheadReadout } from "../finance/components/PlayheadReadout";
import { FinancialEditorModal } from "../finance/components/FinancialEditorModal";
import { FinancialSidePanel } from "../finance/components/FinancialSidePanel";

// Playback speed of the financial timeline: 1 beat = 1 day.
const PLAYBACK_DAYS_PER_SECOND = 7;

// The finance playlist draws the money waveform in an overview lane between
// the ruler and the first track.
const OVERVIEW_LANE_HEIGHT = 112;
const SHELL_METRICS: PlaylistMetrics = {
  ...FINANCE_PLAYLIST_METRICS,
  overviewLaneHeight: OVERVIEW_LANE_HEIGHT,
};

// Canvas geometry the DOM overlays (side rail, inspector) align to, so they
// open BELOW the ruler + money lane instead of covering the curve. A
// module-level constant: React never re-applies an unchanged style object.
const SHELL_LAYOUT_STYLE = {
  "--pl-ruler-h": `${SHELL_METRICS.rulerHeight}px`,
  "--pl-lane-h": `${SHELL_METRICS.overviewLaneHeight}px`,
} as React.CSSProperties;

// Financial item editor: edit an existing item (double-click on its clip)
// or create one from a draft ("+ Ingreso" & co.; added only on "Guardar").
type EditorState =
  | { mode: "edit"; id: string }
  | { mode: "create"; draft: FinancialItem }
  | null;

// Local calendar date of the device ("today" for the projection). The only
// place that reads the clock: @slicex/core stays pure and receives dates.
function localTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Finance-native snap: 1 beat = 1 day, 1 bar = 1 week (beatsPerBar 7),
// "axis" = the calendar axis' snap targets (quincenas; falls back to the
// day when the axis provides none).
const SNAP_OPTIONS: ReadonlyArray<{ value: PlaylistSnapMode; label: string }> =
  [
    { value: "beat", label: "Día" },
    { value: "bar", label: "Semana" },
    { value: "axis", label: "Quincena" },
    { value: "none", label: "Libre" },
  ];

const SNAP_VALUES: ReadonlySet<PlaylistSnapMode> = new Set(
  SNAP_OPTIONS.map((option) => option.value),
);

// Paint (B) and Slip (S) keep their hotkeys; they are just not offered in
// the toolbar (no clear financial meaning to advertise).
const TOOL_BUTTONS: ReadonlyArray<{
  id: PlaylistToolId;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    id: "select",
    label: "Seleccionar",
    icon: <path d="M3.5 1.5v10l2.8-2.6 1.9 4.1 1.6-.7-1.9-4.1 3.8-.2z" fill="currentColor" stroke="none" />,
  },
  {
    id: "draw",
    label: "Dibujar",
    icon: <path d="M2.5 11.5 3 9l6.6-6.6 2 2L5 11zM8.4 3.6l2 2" />,
  },
  {
    id: "slice",
    label: "Cortar",
    icon: (
      <>
        <circle cx="4" cy="11" r="1.8" />
        <circle cx="10" cy="11" r="1.8" />
        <path d="M5.2 9.6 11 2M8.8 9.6 3 2" />
      </>
    ),
  },
  {
    id: "mute",
    label: "Silenciar",
    icon: (
      <>
        <circle cx="7" cy="7" r="5" />
        <path d="M3.5 10.5l7-7" />
      </>
    ),
  },
  {
    id: "delete",
    label: "Borrar",
    icon: <path d="M2.5 4h9M5.5 4V2.5h3V4M3.8 4l.6 8h5.2l.6-8" />,
  },
  {
    id: "zoom",
    label: "Zoom",
    icon: (
      <>
        <circle cx="6" cy="6" r="3.8" />
        <path d="M8.8 8.8 12.5 12.5" />
      </>
    ),
  },
];

interface ToolbarProps {
  core: PlaylistCore | null;
}

interface MenuItemDef {
  label: string;
  hotkey?: string;
  onSelect: () => void;
  disabled?: boolean;
  divider?: boolean;
}

function PlaylistMenuItem({ item }: { item: MenuItemDef }) {
  if (item.divider) {
    return <div className="playlist-shell__menu-divider" role="separator" />;
  }
  return (
    <button
      type="button"
      className="playlist-shell__menu-item"
      onClick={item.onSelect}
      disabled={item.disabled === true}
    >
      <span className="playlist-shell__menu-label">{item.label}</span>
      {item.hotkey ? (
        <span className="playlist-shell__menu-hotkey">{item.hotkey}</span>
      ) : null}
    </button>
  );
}

function pickColorThen(
  current: string,
  apply: (color: string) => void,
): void {
  if (typeof document === "undefined") return;
  const input = document.createElement("input");
  input.type = "color";
  input.value = current;
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  document.body.appendChild(input);
  input.addEventListener("change", () => {
    apply(input.value);
    input.remove();
  });
  input.addEventListener("blur", () => input.remove(), { once: true });
  input.click();
}

function buildTrackMenuItems(
  core: PlaylistCore,
  trackIndex: number,
): MenuItemDef[] {
  const state = core.getState();
  const track = state.tracks[trackIndex];
  if (!track) return [];
  const trackId = track.id;
  const hasClips = state.clips.some((clip) => clip.trackId === trackId);
  const hasSelectedClipsOnTrack = state.clips.some(
    (clip) =>
      clip.trackId === trackId && state.selection.clipIds.includes(clip.id),
  );
  const close = () => core.closeContextMenu();
  return [
    {
      label: track.muted ? "Unmute track" : "Mute track",
      onSelect: () => {
        core.toggleTrackMute(trackIndex);
        close();
      },
    },
    {
      label: track.soloed ? "Unsolo track" : "Solo track",
      onSelect: () => {
        core.toggleTrackSolo(trackIndex);
        close();
      },
    },
    {
      label: track.locked ? "Unlock track" : "Lock track",
      onSelect: () => {
        core.toggleTrackLock(trackIndex);
        close();
      },
    },
    { label: "", onSelect: () => {}, divider: true },
    {
      label: "Rename track",
      onSelect: () => {
        const next = window.prompt(
          "Rename track",
          track.label ?? `Track ${trackIndex + 1}`,
        );
        if (next?.trim()) {
          core.renameTrack(trackIndex, next.trim());
        }
        close();
      },
    },
    {
      label: "Recolor track",
      onSelect: () => {
        pickColorThen(track.color ?? "#888888", (color) =>
          core.recolorTrack(trackIndex, color),
        );
        close();
      },
    },
    { label: "", onSelect: () => {}, divider: true },
    {
      label: "Insert track below",
      onSelect: () => {
        core.insertTrackBelow(trackIndex);
        close();
      },
    },
    {
      label: "Delete track content",
      disabled: !hasClips,
      onSelect: () => {
        core.clearTrackClips(trackIndex);
        close();
      },
    },
    {
      label: "Delete selected clips on track",
      disabled: !hasSelectedClipsOnTrack,
      onSelect: () => {
        core.deleteSelectedClipsOnTrack(trackIndex);
        close();
      },
    },
    {
      label: "Delete empty track",
      disabled: hasClips || state.tracks.length <= 1,
      onSelect: () => {
        core.deleteEmptyTrack(trackIndex);
        close();
      },
    },
  ];
}

function buildClipMenuItems(
  core: PlaylistCore,
  clipId: string,
): MenuItemDef[] {
  const state = core.getState();
  const clip = state.clips.find((c) => c.id === clipId);
  if (!clip) return [];
  const close = () => core.closeContextMenu();
  return [
    {
      label: "Rename and recolor",
      onSelect: () => {
        const nextLabel = window.prompt("Rename clip", clip.label);
        if (nextLabel != null && nextLabel.trim()) {
          core.setClipLabel(clip.id, nextLabel.trim());
        }
        pickColorThen(clip.color, (color) => core.setClipColor(clip.id, color));
        close();
      },
    },
    {
      label: "Make unique",
      onSelect: () => {
        core.makeClipUnique(clip.id);
        close();
      },
    },
    {
      label: "Select source",
      onSelect: () => {
        core.selectClipSource(clip.id);
        close();
      },
    },
    {
      label: "Select all similar",
      hotkey: "Shift+C",
      onSelect: () => {
        core.selectAllSimilarClips(clip.id);
        close();
      },
    },
    { label: "", onSelect: () => {}, divider: true },
    {
      label: clip.muted ? "Unmute" : "Mute",
      onSelect: () => {
        core.toggleClipMute(clip.id);
        close();
      },
    },
    {
      label: "Delete",
      hotkey: "Del",
      onSelect: () => {
        core.deleteClip(clip.id);
        close();
      },
    },
  ];
}

const MARKER_KIND_OPTIONS: ReadonlyArray<{
  kind: PlaylistMarkerKind;
  label: string;
}> = [
  { kind: "label", label: "Label" },
  { kind: "start", label: "Start" },
  { kind: "loop", label: "Loop" },
  { kind: "marker-loop", label: "Marker loop" },
  { kind: "marker-skip", label: "Marker skip" },
  { kind: "marker-pause", label: "Marker pause" },
  { kind: "time-signature", label: "Time signature" },
  { kind: "rec-start", label: "Recording start" },
  { kind: "rec-stop", label: "Recording stop" },
];

function buildMarkerMenuItems(
  core: PlaylistCore,
  markerId: string,
): MenuItemDef[] {
  const marker = core.getState().markers.find((m) => m.id === markerId);
  if (!marker) return [];
  const close = () => core.closeContextMenu();
  return [
    {
      label: "Rename marker",
      onSelect: () => {
        const next = window.prompt(
          "Rename marker",
          marker.label ?? "",
        );
        if (next != null) {
          core.updateMarker(marker.id, { label: next.trim() || undefined });
        }
        close();
      },
    },
    ...MARKER_KIND_OPTIONS.map<MenuItemDef>((option) => ({
      label: `${option.kind === marker.kind ? "✓ " : "   "}${option.label}`,
      onSelect: () => {
        core.updateMarker(marker.id, { kind: option.kind });
        close();
      },
    })),
    { label: "", onSelect: () => {}, divider: true },
    {
      label: "Jump playhead here",
      onSelect: () => {
        core.setPlayPosition(marker.time);
        close();
      },
    },
    {
      label: "Delete marker",
      hotkey: "Del",
      onSelect: () => {
        core.removeMarker(marker.id);
        close();
      },
    },
  ];
}

function buildBackgroundMenuItems(
  core: PlaylistCore,
  time: number,
  trackIndex: number,
): MenuItemDef[] {
  const state = core.getState();
  const close = () => core.closeContextMenu();
  const hasClipboard = state.clipboard != null && state.clipboard.entries.length > 0;
  return [
    {
      label: "Paste here",
      hotkey: "Ctrl+V",
      disabled: !hasClipboard,
      onSelect: () => {
        core.pasteClipboard({ atTime: time, atTrackIndex: trackIndex });
        close();
      },
    },
    {
      label: "Insert clip",
      onSelect: () => {
        core.createClip({
          trackIndex,
          start: time,
          duration: 4,
          type: "pattern",
          label: "Clip",
          color: "#7aa6d8",
        });
        close();
      },
    },
    {
      label: "Select all clips",
      hotkey: "Ctrl+A",
      onSelect: () => {
        core.selectAllClips();
        close();
      },
    },
    {
      label: "Deselect",
      hotkey: "Ctrl+D",
      onSelect: () => {
        core.deselectAll();
        close();
      },
    },
  ];
}

function PlaylistContextMenuOverlay({ core }: { core: PlaylistCore | null }) {
  const [menu, setMenu] = React.useState<PlaylistContextMenu>(null);

  React.useEffect(() => {
    if (!core) {
      setMenu(null);
      return undefined;
    }
    setMenu(core.getState().contextMenu);
    const sub = core.subscribe((state) => setMenu(state.contextMenu));
    return () => sub.unsubscribe();
  }, [core]);

  React.useEffect(() => {
    if (!menu || !core) return undefined;
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".playlist-shell__menu")) return;
      core.closeContextMenu();
    };
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", handler);
    };
  }, [menu, core]);

  if (!menu || !core) return null;

  let items: MenuItemDef[] = [];
  if (menu.kind === "track") {
    items = buildTrackMenuItems(core, menu.trackIndex);
  } else if (menu.kind === "clip") {
    items = buildClipMenuItems(core, menu.clipId);
  } else if (menu.kind === "background") {
    items = buildBackgroundMenuItems(core, menu.time, menu.trackIndex);
  } else if (menu.kind === "marker") {
    items = buildMarkerMenuItems(core, menu.markerId);
  }

  return (
    <div
      className="playlist-shell__menu"
      style={{ left: menu.position.x, top: menu.position.y }}
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, idx) => (
        <PlaylistMenuItem key={`${menu.kind}-${idx}`} item={item} />
      ))}
    </div>
  );
}

function PlaylistToolbar({ core }: ToolbarProps) {
  const [active, setActive] = React.useState<PlaylistToolId>("select");
  const [snapMode, setSnapMode] = React.useState<PlaylistSnapMode>("beat");
  const [clipCount, setClipCount] = React.useState(0);
  const [selectedCount, setSelectedCount] = React.useState(0);

  React.useEffect(() => {
    if (!core) {
      return undefined;
    }
    const s0 = core.getState();
    setActive(s0.tool);
    setSnapMode(s0.snap.mode);
    setClipCount(s0.clips.length);
    setSelectedCount(s0.selection.clipIds.length);
    const sub = core.subscribe((state) => {
      // Primitives only: React bails out (Object.is) on every notify that
      // does not change them — hover, play tick, viewport (canon §2.6).
      setActive(state.tool);
      setSnapMode(state.snap.mode);
      setClipCount(state.clips.length);
      setSelectedCount(state.selection.clipIds.length);
    });
    return () => sub.unsubscribe();
  }, [core]);

  return (
    <div
      className="playlist-shell__toolbar"
      role="toolbar"
      aria-label="Herramientas"
    >
      {TOOL_BUTTONS.map((button) => {
        const hotkey = PLAYLIST_TOOL_HOTKEYS[button.id];
        const isActive = active === button.id;
        return (
          <button
            key={button.id}
            type="button"
            className="playlist-shell__tool"
            data-active={isActive ? "true" : "false"}
            data-tool={button.id}
            aria-pressed={isActive}
            aria-label={button.label}
            title={`${button.label} (${hotkey})`}
            onClick={() => core?.setTool(button.id)}
          >
            <svg
              className="playlist-shell__tool-icon"
              viewBox="0 0 14 14"
              aria-hidden="true"
            >
              {button.icon}
            </svg>
            <span className="playlist-shell__tool-label">{button.label}</span>
            <span className="playlist-shell__tool-hotkey">{hotkey}</span>
          </button>
        );
      })}
      <label
        className="playlist-shell__snap"
        title="Ajustar a (Retroceso alterna Libre)"
      >
        <span className="playlist-shell__snap-label">Ajustar a</span>
        <select
          value={snapMode}
          onChange={(event) =>
            core?.setSnapMode(event.target.value as PlaylistSnapMode)
          }
          className="playlist-shell__snap-select"
        >
          {SNAP_VALUES.has(snapMode) ? null : (
            // A mode set elsewhere (e.g. a keyboard shortcut) that the
            // finance toolbar does not offer: shown, not selectable.
            <option value={snapMode} disabled>
              Otro
            </option>
          )}
          {SNAP_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div
        className="playlist-shell__counter"
        role="status"
        aria-label="Objetos en el timeline"
        title={`${clipCount} ${clipCount === 1 ? "objeto" : "objetos"} en el timeline${selectedCount > 0 ? ` · ${selectedCount} seleccionados` : ""}`}
        data-has-selection={selectedCount > 0 ? "true" : "false"}
      >
        <span className="playlist-shell__counter-value">{clipCount}</span>
        <span className="playlist-shell__counter-label">
          {clipCount === 1 ? "objeto" : "objetos"}
        </span>
        {selectedCount > 0 ? (
          <span className="playlist-shell__counter-selected">
            {selectedCount} sel.
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function PlaylistShell() {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [core, setCore] = React.useState<PlaylistCore | null>(null);
  const [bridge, setBridge] = React.useState<FinancialBridgeApi | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Double-click on a clip surfaces a "playlist-clip-open" CustomEvent from
  // the controller; the shell opens the financial editor for that item
  // (item.id === clip.id). "+ Ingreso" & co. open it on a draft.
  const [editor, setEditor] = React.useState<EditorState>(null);
  const closeEditor = React.useCallback(() => setEditor(null), []);
  const openDraft = React.useCallback(
    (draft: FinancialItem) => setEditor({ mode: "create", draft }),
    [],
  );
  // Where focus goes back when the editor closes and its opener is gone.
  const getHost = React.useCallback(() => hostRef.current, []);

  React.useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return undefined;
    }

    // React 18 StrictMode mounts → unmounts → remounts synchronously in
    // dev. Pixi v8 has process-global state (BatcherPipe / TexturePool /
    // GraphicsContextSystem) that gets corrupted when a half-initialised
    // Application is torn down, surfacing in the *next* mount as null
    // geometry or undefined TexturePool entries. Defer creation by one
    // animation frame so the first short-lived mount never builds a Pixi
    // Application at all — the cleanup just cancels the pending init.
    let cancelled = false;
    let instance: PlaylistCore | null = null;
    let interaction: ReturnType<
      typeof createPlaylistInteractionController
    > | null = null;
    let renderer: ReturnType<typeof createPlaylistRenderer> | null = null;
    let financial: FinancialBridge | null = null;
    let unsubscribeBridge: (() => void) | null = null;
    let tickId = 0;
    let lastFrame = performance.now();

    let unsubscribeTransport: (() => void) | null = null;

    const initId = requestAnimationFrame(() => {
      if (cancelled) return;
      const doc = createDemoFinancialDocument(localTodayISO());
      instance = createPlaylistCore(createFinancialPlaylistState(doc), {
        metrics: SHELL_METRICS,
        timeAxis: createCalendarTimeAxis(doc.startDate),
        // Financial clips have no time-stretch meaning: a stretch would
        // rescale the schedule phase and shift every payday.
        stretchEnabled: false,
        // Only the real lanes: no endless empty tracks under the items.
        virtualTracks: false,
      });
      const bridgeInstance = new FinancialBridge(instance, doc);
      financial = bridgeInstance;
      setCore(instance);
      setBridge(bridgeInstance);
      interaction = createPlaylistInteractionController(host, instance);
      renderer = createPlaylistRenderer(host, instance, {
        onError: (reason) => {
          setError(reason instanceof Error ? reason.message : "Renderer failed.");
        },
        // Render-loop providers: O(1) cached lookups on the bridge that
        // return the SAME object while unchanged (canon: provider contract).
        getClipDetail: (clipId) => bridgeInstance.getClipDetail(clipId),
        getClipSparkline: (clipId) => bridgeInstance.getClipSparkline(clipId),
        getClipContent: (clipId) => bridgeInstance.getClipContent(clipId),
        getOverviewData: () => bridgeInstance.getOverviewData(),
        getDragAnnotation: () => bridgeInstance.getDragAnnotation(),
        getTrackMeta: (trackId) => bridgeInstance.getTrackMeta(trackId),
      });
      // Provider data (clip detail / content, the money lane, track meta)
      // comes from the bridge, which can change with no core notify (e.g.
      // only an amount edited in the editor). The bridge notifies only on
      // real data changes, never per frame, and invalidate() just schedules
      // the renderer's coalesced rAF frame.
      const rendererInstance = renderer;
      unsubscribeBridge = bridgeInstance.subscribe(() =>
        rendererInstance.invalidate(),
      );

      // Canon §3.5 + §3.10: only run the play-position rAF when playback
      // is actually engaged. While paused there's no animation to advance,
      // so cycling the rAF wastes a callback per frame even with the
      // idempotent dispatch short-circuit.
      const tick = (now: number) => {
        if (!instance || cancelled) return;
        const deltaSeconds = Math.min(0.05, (now - lastFrame) / 1000);
        lastFrame = now;
        instance.advancePlayPosition(deltaSeconds * PLAYBACK_DAYS_PER_SECOND);
        tickId = requestAnimationFrame(tick);
      };
      const startTick = () => {
        if (tickId !== 0 || cancelled) return;
        lastFrame = performance.now();
        tickId = requestAnimationFrame(tick);
      };
      const stopTick = () => {
        if (tickId === 0) return;
        cancelAnimationFrame(tickId);
        tickId = 0;
      };

      let isRunning = instance.getState().playPosition.isRunning;
      if (isRunning) startTick();
      const sub = instance.subscribe((state) => {
        const nextRunning = state.playPosition.isRunning;
        if (nextRunning === isRunning) return;
        isRunning = nextRunning;
        if (nextRunning) startTick();
        else stopTick();
      });
      unsubscribeTransport = () => {
        sub.unsubscribe();
        stopTick();
      };
    });

    const handleClipOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ clipId: string }>).detail;
      if (detail?.clipId) {
        setEditor({ mode: "edit", id: detail.clipId });
      }
    };
    host.addEventListener("playlist-clip-open", handleClipOpen);

    return () => {
      cancelled = true;
      cancelAnimationFrame(initId);
      unsubscribeTransport?.();
      unsubscribeBridge?.();
      interaction?.destroy();
      renderer?.destroy();
      financial?.destroy();
      host.removeEventListener("playlist-clip-open", handleClipOpen);
      setCore(null);
      setBridge(null);
    };
  }, []);

  // While the (aria-modal) editor is open everything behind it is inert:
  // no Tab into the canvas host, no Delete / Ctrl+Z reaching the playlist.
  const editorOpen = editor !== null && bridge !== null;

  return (
    <section
      className="playlist-shell playlist-shell--finance"
      aria-label="Playlist"
      style={SHELL_LAYOUT_STYLE}
    >
      {bridge ? (
        <FinancialSummaryBar
          bridge={bridge}
          onCreateDraft={openDraft}
          inert={editorOpen}
        />
      ) : null}
      {/* Tools + playhead readout get their own row: nothing floats over
          the ruler dates or the money lane. */}
      <div className="playlist-shell__bar" inert={editorOpen}>
        <PlaylistToolbar core={core} />
        {bridge ? <PlayheadReadout bridge={bridge} /> : null}
      </div>
      <div className="playlist-shell__stage" inert={editorOpen}>
        <div
          ref={hostRef}
          className="playlist-shell__surface"
          tabIndex={0}
        />
        <PlaylistContextMenuOverlay core={core} />
        {error ? (
          <div className="playlist-shell__status" role="alert">
            <strong>Error</strong>
            <span>{error}</span>
          </div>
        ) : null}
        <PlaylistInspector core={core} />
        {bridge ? <FinancialSidePanel bridge={bridge} /> : null}
      </div>
      {editor && bridge ? (
        editor.mode === "edit" ? (
          <FinancialEditorModal
            key={"edit:" + editor.id}
            bridge={bridge}
            itemId={editor.id}
            onClose={closeEditor}
            returnFocusFallback={getHost}
          />
        ) : (
          <FinancialEditorModal
            key={"create:" + editor.draft.id}
            bridge={bridge}
            draft={editor.draft}
            onClose={closeEditor}
            returnFocusFallback={getHost}
          />
        )
      ) : null}
    </section>
  );
}
