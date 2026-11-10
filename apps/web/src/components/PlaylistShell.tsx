import React from "react";
import {
  PLAYLIST_TOOL_HOTKEYS,
  createPlaylistCore,
  createPlaylistInteractionController,
  createPlaylistRenderer,
  type PlaylistContextMenu,
  type PlaylistCore,
  type PlaylistCreateRequest,
  type PlaylistMarkerKind,
  type PlaylistMetrics,
  type PlaylistSnapMode,
  type PlaylistToolId,
  type ViewportNavigator,
} from "@slicex/canvas";
import type {
  ActualRecord,
  FinancialDocument,
  FinancialItem,
  FinancialItemKind,
} from "@slicex/core";
import { PlaylistInspector } from "./PlaylistInspector";
import type {
  FinancialBridgeApi,
  FinancialPlacement,
  PreviewEffect,
} from "../finance/bridge-api";
import { FinancialBridge } from "../finance/financial-bridge";
import { applyRecCorrections, bootstrapPlan, type RecState } from "../finance/bootstrap";
import { formatDateShort } from "../finance/format";
import { Futures } from "../finance/futures";
import { loadPlan, savePlan } from "../finance/persistence";
import { parseStatement } from "../finance/statement";
import { CommandBar } from "../finance/components/CommandBar";
import { FuturesMenu } from "../finance/components/FuturesMenu";
import { OnboardingDialog, WelcomeBanner } from "../finance/components/Onboarding";
import { RecDialog } from "../finance/components/RecDialog";
import { StatementDialog } from "../finance/components/StatementDialog";
import { ValleyCard } from "../finance/components/ValleyCard";
import { NavControls, NavHelp } from "../finance/components/NavControls";
import { createFinancialPlaylistState } from "../finance/mapping";
import { displayRowLabel, ROW_NAME_MANY, ROW_NAME_ONE } from "../finance/labels";
import {
  financeShellMetrics,
  shellDensityFor,
  shellLayoutStyle,
} from "../finance/shell-metrics";
import { createCalendarTimeAxis } from "../finance/time-axis";
import { FinancialSummaryBar } from "../finance/components/FinancialSummaryBar";
import { PlayheadReadout } from "../finance/components/PlayheadReadout";
import { FinancialEditorModal } from "../finance/components/FinancialEditorModal";
import { FinancialSidePanel } from "../finance/components/FinancialSidePanel";
import { useTheme } from "../theme";
import { useFitInViewport } from "../ui/fit-in-viewport";
import { useDismiss } from "../ui/use-dismiss";
import { useWheelScrollX } from "../ui/wheel-scroll-x";

// Playback speed of the financial timeline: 1 beat = 1 day.
const PLAYBACK_DAYS_PER_SECOND = 7;

// The canvas geometry (money lane + row heights) is picked once, from the
// window height, when the shell mounts (src/finance/shell-metrics.ts).
function initialShellDensity() {
  return shellDensityFor(
    typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerHeight,
  );
}

const NAV_HINT_KEY = "slicex.navHint";

function navHintSeen(): boolean {
  try {
    return globalThis.localStorage?.getItem(NAV_HINT_KEY) === "1";
  } catch {
    return true;
  }
}

// Financial item editor: edit an existing item (double-click on its clip)
// or create one from a draft ("+ Ingreso" & co.; added only on "Guardar").
type EditorState =
  | { mode: "edit"; id: string }
  | { mode: "create"; draft: FinancialItem; placement?: FinancialPlacement }
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

// The canvas draws its labels with Inter (shipped by the app). Pixi
// rasterises a Text once, so the renderer is created once the font is ready
// (local file: a few ms) — but never later than FONT_WAIT_MS. If the font
// arrives after that, `lateFont` resolves and the shell asks the renderer to
// re-rasterise its labels once (renderer.refreshFonts).
const FONT_WAIT_MS = 1200;

interface CanvasFontWait {
  // true = the font is ready; false = gave up waiting (fallback face).
  ready: Promise<boolean>;
  // Settles when the font load settles (loaded or failed).
  lateFont: Promise<void>;
}

function waitForCanvasFont(): CanvasFontWait {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts || typeof fonts.load !== "function") {
    return { ready: Promise.resolve(true), lateFont: Promise.resolve() };
  }
  const loaded = Promise.all([
    fonts.load('500 12px "Inter Variable"'),
    fonts.load('600 12px "Inter Variable"'),
  ]).then(
    () => undefined,
    () => undefined,
  );
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), FONT_WAIT_MS);
  });
  return {
    ready: Promise.race([loaded.then(() => true), timeout]),
    lateFont: loaded,
  };
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

// What the context menus can ask of the shell (financial actions).
interface MenuActions {
  /** Open the editor on a NEW item of `kind` dated `day`, to land on row `trackIndex`. */
  newItem(kind: FinancialItemKind, day: number, trackIndex: number): void;
  /** Open the editor on an existing item (clip id = item id). */
  editItem(clipId: string): void;
}

const DIVIDER: MenuItemDef = { label: "", onSelect: () => {}, divider: true };

// Row menu. The engine's tracks are "líneas de evento" for the person
// (slots in English). Rows are permanent, like FL's playlist: they can be
// emptied, renamed, muted or locked, and new ones inserted, but never
// removed — the endless empty rows below are always there anyway.
function buildTrackMenuItems(
  core: PlaylistCore,
  trackIndex: number,
  actions: MenuActions,
): MenuItemDef[] {
  const state = core.getState();
  const track = state.tracks[trackIndex];
  if (!track) return [];
  const trackId = track.id;
  const hasClips = state.clips.some((clip) => clip.trackId === trackId);
  const close = () => core.closeContextMenu();
  const day = Math.max(0, Math.floor(state.playPosition.time));
  return [
    {
      label: "Nuevo ingreso en esta línea…",
      onSelect: () => {
        close();
        actions.newItem("income", day, trackIndex);
      },
    },
    {
      label: "Nuevo gasto en esta línea…",
      onSelect: () => {
        close();
        actions.newItem("expense", day, trackIndex);
      },
    },
    DIVIDER,
    {
      label: track.muted ? "Reactivar línea de evento" : "Silenciar línea de evento",
      onSelect: () => {
        core.toggleTrackMute(trackIndex);
        close();
      },
    },
    {
      label: track.soloed ? "Quitar solo" : "Solo esta línea de evento",
      onSelect: () => {
        core.toggleTrackSolo(trackIndex);
        close();
      },
    },
    {
      label: track.locked ? "Desbloquear línea de evento" : "Bloquear línea de evento",
      onSelect: () => {
        core.toggleTrackLock(trackIndex);
        close();
      },
    },
    DIVIDER,
    {
      label: "Renombrar línea de evento…",
      onSelect: () => {
        const next = window.prompt(
          "Nombre de la línea de evento (vacío = automático)",
          displayRowLabel(track.label ?? ""),
        );
        if (next !== null) {
          // Empty, or the automatic name itself: back to automatic, so it
          // keeps following what the row holds (evento / eventos).
          const name = next.trim();
          core.renameTrack(
            trackIndex,
            name === ROW_NAME_ONE || name === ROW_NAME_MANY ? "" : name,
          );
        }
        close();
      },
    },
    {
      label: "Color de la línea de evento…",
      onSelect: () => {
        pickColorThen(track.color ?? "#888888", (color) => core.recolorTrack(trackIndex, color));
        close();
      },
    },
    DIVIDER,
    {
      label: "Insertar línea de evento arriba",
      onSelect: () => {
        core.insertTrackBelow(trackIndex - 1);
        close();
      },
    },
    {
      label: "Insertar línea de evento abajo",
      onSelect: () => {
        core.insertTrackBelow(trackIndex);
        close();
      },
    },
    {
      label: "Vaciar línea de evento",
      disabled: !hasClips || track.locked === true,
      onSelect: () => {
        core.clearTrackClips(trackIndex);
        close();
      },
    },
  ];
}

function buildClipMenuItems(
  core: PlaylistCore,
  clipId: string,
  actions: MenuActions,
): MenuItemDef[] {
  const state = core.getState();
  const clip = state.clips.find((c) => c.id === clipId);
  if (!clip) return [];
  const close = () => core.closeContextMenu();
  return [
    {
      label: "Editar…",
      hotkey: "Doble clic",
      onSelect: () => {
        close();
        actions.editItem(clip.id);
      },
    },
    {
      label: clip.muted ? "Reactivar" : "Silenciar",
      onSelect: () => {
        core.toggleClipMute(clip.id);
        close();
      },
    },
    DIVIDER,
    {
      label: "Copiar",
      hotkey: "Ctrl+C",
      onSelect: () => {
        if (!state.selection.clipIds.includes(clip.id)) core.setClipSelection([clip.id]);
        core.copyToClipboard();
        close();
      },
    },
    {
      label: "Borrar",
      hotkey: "Supr",
      onSelect: () => {
        core.deleteClip(clip.id);
        close();
      },
    },
  ];
}

// Draft for the pencil on empty space: the kind of the selected item (the
// one FL's pencil would stamp), else of what already lives on that row
// ("Sueldo" -> income), else an expense; dated on that day. A drag also
// sets the end of a recurring draft.
function draftForRow(
  bridge: FinancialBridge,
  core: PlaylistCore,
  request: PlaylistCreateRequest,
): FinancialItem {
  const state = core.getState();
  const rowId = state.tracks[request.trackIndex]?.id;
  const neighbour = rowId ? state.clips.find((clip) => clip.trackId === rowId) : undefined;
  const like =
    (request.templateClipId ? bridge.getItem(request.templateClipId) : null) ??
    (neighbour ? bridge.getItem(neighbour.id) : null);
  const day = Math.max(0, Math.floor(request.start));
  const draft = bridge.createDraftItem(like?.kind ?? "expense", day);
  if (
    request.duration !== null &&
    request.duration >= 2 &&
    draft.recurrence.frequency !== "once"
  ) {
    const lastDay = day + Math.round(request.duration) - 1;
    return {
      ...draft,
      recurrence: { ...draft.recurrence, endDate: bridge.dateAtBeat(lastDay) },
    } as FinancialItem;
  }
  return draft;
}

const MARKER_KIND_OPTIONS: ReadonlyArray<{
  kind: PlaylistMarkerKind;
  label: string;
}> = [
  { kind: "label", label: "Etiqueta" },
  { kind: "start", label: "Inicio" },
  { kind: "loop", label: "Bucle" },
  { kind: "marker-loop", label: "Bucle de marcador" },
  { kind: "marker-skip", label: "Salto" },
  { kind: "marker-pause", label: "Pausa" },
  { kind: "time-signature", label: "Compás" },
  { kind: "rec-start", label: "Inicio de grabación" },
  { kind: "rec-stop", label: "Fin de grabación" },
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
      label: "Renombrar marcador…",
      onSelect: () => {
        const next = window.prompt("Nombre del marcador", marker.label ?? "");
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
    DIVIDER,
    {
      label: "Llevar el cursor aquí",
      onSelect: () => {
        core.setPlayPosition(marker.time);
        close();
      },
    },
    {
      label: "Borrar marcador",
      hotkey: "Supr",
      onSelect: () => {
        core.removeMarker(marker.id);
        close();
      },
    },
  ];
}

// Empty space (any row — the endless ones below included): new things
// land exactly there, on that day and that row.
function buildBackgroundMenuItems(
  core: PlaylistCore,
  time: number,
  trackIndex: number,
  actions: MenuActions,
): MenuItemDef[] {
  const state = core.getState();
  const close = () => core.closeContextMenu();
  const hasClipboard = state.clipboard != null && state.clipboard.entries.length > 0;
  const day = Math.max(0, Math.floor(time));
  const create = (kind: FinancialItemKind) => () => {
    close();
    actions.newItem(kind, day, trackIndex);
  };
  return [
    { label: "Nuevo ingreso aquí…", onSelect: create("income") },
    { label: "Nuevo gasto aquí…", onSelect: create("expense") },
    { label: "Nuevo préstamo aquí…", onSelect: create("loan") },
    { label: "Nueva compra a MSI aquí…", onSelect: create("installment-plan") },
    DIVIDER,
    {
      label: "Pegar aquí",
      hotkey: "Ctrl+V",
      disabled: !hasClipboard,
      onSelect: () => {
        core.pasteClipboard({ atTime: time, atTrackIndex: trackIndex });
        close();
      },
    },
    {
      label: "Seleccionar todo",
      hotkey: "Ctrl+A",
      onSelect: () => {
        core.selectAllClips();
        close();
      },
    },
    {
      label: "Deseleccionar",
      hotkey: "Ctrl+D",
      onSelect: () => {
        core.deselectAll();
        close();
      },
    },
  ];
}

function PlaylistContextMenuOverlay({
  core,
  actions,
}: {
  core: PlaylistCore | null;
  actions: MenuActions;
}) {
  const [menu, setMenu] = React.useState<PlaylistContextMenu>(null);
  // Opened at the pointer: near an edge it would hang off screen.
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  useFitInViewport(menuRef, menu !== null, [menu]);

  React.useEffect(() => {
    if (!core) {
      setMenu(null);
      return undefined;
    }
    setMenu(core.getState().contextMenu);
    const sub = core.subscribe((state) => setMenu(state.contextMenu));
    return () => sub.unsubscribe();
  }, [core]);

  useDismiss(menu !== null && core !== null, [menuRef], () => core?.closeContextMenu(), {
    escape: true,
  });

  if (!menu || !core) return null;

  let items: MenuItemDef[] = [];
  if (menu.kind === "track") {
    items = buildTrackMenuItems(core, menu.trackIndex, actions);
  } else if (menu.kind === "clip") {
    items = buildClipMenuItems(core, menu.clipId, actions);
  } else if (menu.kind === "background") {
    items = buildBackgroundMenuItems(core, menu.time, menu.trackIndex, actions);
  } else if (menu.kind === "marker") {
    items = buildMarkerMenuItems(core, menu.markerId);
  }

  return (
    <div
      ref={menuRef}
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
      <div className="playlist-shell__segmented" role="group" aria-label="Herramienta">
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
      </div>
      <label
        className="playlist-shell__snap"
        title="Ajustar a (Retroceso alterna Libre)"
      >
        {/* The words hide on narrower windows (still the select's name);
            the magnet inside the pill keeps it recognisable. */}
        <span className="playlist-shell__snap-label">Ajustar a</span>
        <span className="playlist-shell__snap-field">
          <svg className="playlist-shell__snap-icon" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3.5 2v4.5a3.5 3.5 0 0 0 7 0V2M2.4 4.2h2.2M9.4 4.2h2.2" />
          </svg>
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
        </span>
      </label>
      {/* Only a multi-selection is worth a chip (how many will move). */}
      {selectedCount > 1 ? (
        <div
          className="playlist-shell__counter"
          role="status"
          aria-label="Selección"
          title={`${selectedCount} de ${clipCount} objetos seleccionados`}
          data-has-selection="true"
        >
          <span className="playlist-shell__counter-selected">
            {selectedCount} seleccionados
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function PlaylistShell() {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  // Fixed for the life of the playlist (the core's metrics are). The DOM
  // overlays (side rail, inspector, readout) align to the same numbers
  // through CSS variables, so they open BELOW the ruler + money lane. Both
  // objects keep their identity: React never re-applies the style.
  const [density] = React.useState(initialShellDensity);
  const metrics = React.useMemo<PlaylistMetrics>(() => financeShellMetrics(density), [density]);
  const layoutStyle = React.useMemo(() => shellLayoutStyle(metrics), [metrics]);
  // The tool bar scrolls sideways when it can't fit: the wheel moves it.
  const toolBarRef = useWheelScrollX();
  // Light / dark: the DOM follows the CSS tokens; the canvas palette is
  // switched through the renderer (created later, inside the init frame).
  const { theme, toggle: toggleTheme } = useTheme();
  const themeRef = React.useRef(theme);
  themeRef.current = theme;
  const rendererRef = React.useRef<ReturnType<
    typeof createPlaylistRenderer
  > | null>(null);
  const [core, setCore] = React.useState<PlaylistCore | null>(null);
  const [bridge, setBridge] = React.useState<FinancialBridgeApi | null>(null);
  const [futures, setFutures] = React.useState<Futures | null>(null);
  const [navigator, setNavigator] = React.useState<ViewportNavigator | null>(null);
  const [navHint, setNavHint] = React.useState<"hint" | "help" | null>(() =>
    navHintSeen() ? null : "hint",
  );
  const dismissNavHint = React.useCallback(() => {
    setNavHint(null);
    try {
      globalThis.localStorage?.setItem(NAV_HINT_KEY, "1");
    } catch {
      // private mode: the hint just shows again next time
    }
  }, []);
  const [error, setError] = React.useState<string | null>(null);
  // Double-click on a clip surfaces a "playlist-clip-open" CustomEvent from
  // the controller; the shell opens the financial editor for that item
  // (item.id === clip.id). "Nuevo" opens it on a draft.
  const [editor, setEditor] = React.useState<EditorState>(null);
  const closeEditor = React.useCallback(() => setEditor(null), []);
  const openDraft = React.useCallback(
    (draft: FinancialItem) => setEditor({ mode: "create", draft }),
    [],
  );
  // Right-click menus: "Nuevo … aquí" lands on that day and that row.
  const menuActions = React.useMemo<MenuActions>(
    () => ({
      newItem: (kind, day, trackIndex) => {
        if (!bridge) return;
        setEditor({
          mode: "create",
          draft: bridge.createDraftItem(kind, day),
          placement: { trackIndex },
        });
      },
      editItem: (clipId) => {
        if (bridge?.getItem(clipId)) setEditor({ mode: "edit", id: clipId });
      },
    }),
    [bridge],
  );
  // Where focus goes back when the editor closes and its opener is gone.
  const getHost = React.useCallback(() => hostRef.current, []);

  // Waves 2–4.
  const [today] = React.useState(localTodayISO);
  const [hoverDay, setHoverDay] = React.useState<number | null>(null);
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [peek, setPeek] = React.useState<{ label: string; effect: PreviewEffect | null } | null>(
    null,
  );
  const [onboarding, setOnboarding] = React.useState<"banner" | "dialog" | null>(null);
  const [rec, setRec] = React.useState<RecState | null>(null);
  const [recOpen, setRecOpen] = React.useState(false);
  const [statement, setStatement] = React.useState<{ cardId: string; text: string } | null>(
    null,
  );

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
    let unsubscribeFutures: (() => void) | null = null;
    let unsubscribeLayout: (() => void) | null = null;
    let tickId = 0;
    let lastFrame = performance.now();
    let pumpId = 0;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    let unsubscribeTransport: (() => void) | null = null;

    const initId = requestAnimationFrame(() => {
      if (cancelled) return;
      const font = waitForCanvasFont();
      void font.ready.then((fontReady) => {
        build();
        if (!fontReady) {
          void font.lateFont.then(() => {
            if (!cancelled) rendererRef.current?.refreshFonts();
          });
        }
      });
    });

    function build(): void {
      if (cancelled || !host) return;
      const plan = bootstrapPlan(today, loadPlan());
      const doc = plan.doc;
      instance = createPlaylistCore(createFinancialPlaylistState(doc, plan.layout), {
        metrics,
        timeAxis: createCalendarTimeAxis(doc.startDate),
        // Financial clips have no time-stretch meaning: a stretch would
        // rescale the schedule phase and shift every payday.
        stretchEnabled: false,
        // Tracks are endless (FL): empty rows always wait below the items
        // to draw, paste or drop on; rows are never removed by themselves.
      });
      const bridgeInstance = new FinancialBridge(instance, doc);
      financial = bridgeInstance;
      const futuresInstance = new Futures(bridgeInstance, plan.saved);
      setCore(instance);
      setBridge(bridgeInstance);
      setFutures(futuresInstance);
      if (plan.firstVisit) setOnboarding("banner");
      if (plan.rec) setRec(plan.rec);
      interaction = createPlaylistInteractionController(host, instance, {
        // Amount by hand: drag a clip's top edge (one undo entry).
        onClipLevelDrag: ({ clipId, phase, deltaY }) =>
          bridgeInstance.levelDrag(clipId, phase, deltaY),
        // Length by hand: the selected item's grabber, at the centre of the
        // screen, moves its end (goal-seek for debts that end at payoff).
        clipExtend: (clipId) => bridgeInstance.canExtend(clipId),
        // Zoomed in it never gets slower than ~a day per 3 px (a month per 100 px).
        clipExtendMinBeatsPerPx: 1 / 3,
        // Valleys explain themselves under the pointer.
        onOverviewHover: (beat) => setHoverDay(beat),
        // The mouse wheel scrolls the rows, like any document; Shift (or
        // the wheel over the ruler / money lane) moves time.
        mouseWheel: "rows",
        // The pencil never adds an item by itself (it used to stamp an
        // unnamed $500 "Gasto" on a double-click): it opens the editor on a
        // draft at that day and row; nothing is added until "Guardar".
        onCreateRequest: (request) => {
          if (!instance) return;
          setEditor({
            mode: "create",
            draft: draftForRow(bridgeInstance, instance, request),
            placement: { trackIndex: request.trackIndex },
          });
        },
      });
      setNavigator(interaction.navigator ?? null);
      renderer = createPlaylistRenderer(host, instance, {
        theme: themeRef.current,
        clipLevelHandles: true,
        clipExtend: (clipId) => bridgeInstance.canExtend(clipId),
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
        // The engine names empty rows "Track N"; for the person they are
        // "Línea de evento N".
        formatTrackLabel: displayRowLabel,
        getClipHighlight: (clipId) => bridgeInstance.isHighlighted(clipId),
        // The cash that day + that day's movements under every date tooltip.
        getTooltipDetail: (beat) => bridgeInstance.getDayDetail(beat),
      });
      // Provider data (clip detail / content, the money lane, track meta)
      // comes from the bridge, which can change with no core notify (e.g.
      // only an amount edited in the editor). The bridge notifies only on
      // real data changes, never per frame, and invalidate() just schedules
      // the renderer's coalesced rAF frame. While the lane morphs between
      // futures (~320 ms) a short rAF pump repaints it; it stops by itself.
      const rendererInstance = renderer;
      rendererRef.current = rendererInstance;
      const pump = () => {
        pumpId = 0;
        if (cancelled) return;
        rendererInstance.invalidate();
        if (bridgeInstance.isAnimating()) pumpId = requestAnimationFrame(pump);
      };
      // Autosave (debounced) on real changes of the plan or its futures.
      let savedRevision = bridgeInstance.getRevision();
      const scheduleSave = () => {
        if (saveTimer !== null) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveTimer = null;
          if (!cancelled) savePlan(futuresInstance.toSaved());
        }, 600);
      };
      unsubscribeBridge = bridgeInstance.subscribe(() => {
        rendererInstance.invalidate();
        if (bridgeInstance.isAnimating() && pumpId === 0) {
          pumpId = requestAnimationFrame(pump);
        }
        const revision = bridgeInstance.getRevision();
        if (revision !== savedRevision) {
          savedRevision = revision;
          scheduleSave();
        }
      });
      unsubscribeFutures = futuresInstance.subscribe(scheduleSave);
      // Rows are part of the plan too (a renamed / added / emptied track,
      // an item moved to another row): reference checks only, O(1).
      let lastTracks = instance.getState().tracks;
      let lastClips = instance.getState().clips;
      const layoutSub = instance.subscribe((state) => {
        if (state.tracks === lastTracks && state.clips === lastClips) return;
        lastTracks = state.tracks;
        lastClips = state.clips;
        scheduleSave();
      });
      unsubscribeLayout = () => layoutSub.unsubscribe();
      // A rolled-forward plan is today's plan: persist it right away.
      if (plan.rec) savePlan(futuresInstance.toSaved());

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
    }

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
      if (pumpId !== 0) cancelAnimationFrame(pumpId);
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      unsubscribeTransport?.();
      unsubscribeBridge?.();
      unsubscribeFutures?.();
      unsubscribeLayout?.();
      interaction?.destroy();
      rendererRef.current = null;
      renderer?.destroy();
      financial?.destroy();
      host.removeEventListener("playlist-clip-open", handleClipOpen);
      setCore(null);
      setBridge(null);
      setFutures(null);
      setNavigator(null);
    };
  }, [today, metrics]);

  // Theme switch: one repaint of the cached canvas layers (never per frame).
  React.useEffect(() => {
    rendererRef.current?.setTheme(theme);
  }, [theme]);

  // While a dialog is open everything behind it is inert: no Tab into the
  // canvas host, no Delete / Ctrl+Z reaching the playlist.
  const editorOpen =
    (editor !== null ||
      onboarding === "dialog" ||
      recOpen ||
      statement !== null) &&
    bridge !== null;

  // Hold Q: peek at the other future. Hold A over a clip: your year without
  // it. "/": write a movement. Paste on a selected card: its statement.
  React.useEffect(() => {
    if (!bridge || !futures || !core) return undefined;
    let held: string | null = null;
    const typing = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const startPeek = (label: string, preview: Parameters<FinancialBridgeApi["setPreview"]>[0]) => {
      const before = bridge.getOverviewData()?.primary ?? null;
      bridge.setPreview(preview);
      bridge.animateFrom(before);
      setPeek({ label, effect: bridge.getPreviewEffect() });
    };
    const endPeek = () => {
      if (held === null) return;
      held = null;
      const before = bridge.getOverviewData()?.primary ?? null;
      bridge.setPreview(null);
      bridge.animateFrom(before);
      setPeek(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (editorOpen || commandOpen) return;
      // Undo / redo also work when focus sits on a DOM control outside the
      // canvas (e.g. right after "Aplicar" on a valley fix); the canvas host
      // handles its own shortcuts.
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !typing(event.target) &&
        !hostRef.current?.contains(event.target as Node)
      ) {
        const key = event.key.toLowerCase();
        if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          core.undo();
          return;
        }
        if (key === "y" || (key === "z" && event.shiftKey)) {
          event.preventDefault();
          core.redo();
          return;
        }
      }
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (event.repeat || held !== null) return;
      const key = event.key.toLowerCase();
      if (key === "q") {
        const target = futures.peekTarget();
        const doc = target ? futures.docOf(target.id) : null;
        if (!target || !doc) return;
        held = "q";
        startPeek(`Futuro: ${target.name}`, { kind: "document", doc });
        return;
      }
      if (key === "a") {
        const hover = core.getState().hover;
        if (!hover || hover.kind !== "clip") return;
        const item = bridge.getItem(hover.clipId);
        if (!item) return;
        held = "a";
        startPeek(`Sin ${item.name}`, { kind: "exclude", itemId: item.id });
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (held !== null && event.key.toLowerCase() === held) endPeek();
    };
    const onPaste = (event: ClipboardEvent) => {
      if (editorOpen || typing(event.target)) return;
      const ids = core.getState().selection.clipIds;
      const card = ids.length === 1 ? bridge.getItem(ids[0]!) : null;
      if (!card || card.kind !== "credit-card") return;
      const text = event.clipboardData?.getData("text") ?? "";
      if (parseStatement(text, { today }).length === 0) return;
      event.preventDefault();
      setStatement({ cardId: card.id, text });
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", endPeek);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", endPeek);
      window.removeEventListener("paste", onPaste);
      endPeek();
    };
  }, [bridge, futures, core, editorOpen, commandOpen, today]);

  const createYear = React.useCallback(
    (doc: FinancialDocument) => {
      bridge?.loadDocument(doc);
      setOnboarding(null);
      setRec(null);
    },
    [bridge],
  );

  const applyRec = React.useCallback(
    (actuals: ActualRecord[], cashOverride: number | undefined) => {
      if (!bridge || !futures || !rec) return;
      const ledger = applyRecCorrections(bridge, rec, today, actuals, cashOverride);
      futures.upsertLedger(ledger);
      setRecOpen(false);
      setRec(null);
    },
    [bridge, futures, rec, today],
  );

  return (
    <section
      className="playlist-shell playlist-shell--finance"
      aria-label="Playlist"
      data-density={density}
      style={layoutStyle}
    >
      {bridge ? (
        <FinancialSummaryBar
          bridge={bridge}
          onCreateDraft={openDraft}
          inert={editorOpen}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenCommand={() => setCommandOpen(true)}
          tools={
            // Tools + futures inside the header card: nothing floats over
            // the ruler dates or the money lane.
            <div className="playlist-shell__bar" inert={editorOpen} ref={toolBarRef}>
              <PlaylistToolbar core={core} />
              {futures ? (
                <FuturesMenu bridge={bridge} futures={futures} inert={editorOpen} />
              ) : null}
            </div>
          }
        />
      ) : null}
      <div className="playlist-shell__stage" inert={editorOpen}>
        <div
          ref={hostRef}
          className="playlist-shell__surface"
          tabIndex={0}
          role="application"
          aria-roledescription="línea de tiempo"
          aria-label="Línea de tiempo: arrastra para mover, rueda para subir y bajar, Shift+rueda para avanzar en el tiempo"
        />
        <PlaylistContextMenuOverlay core={core} actions={menuActions} />
        {/* Date · cash · debt at the playhead, in the money lane's header
            cell (rails open below the lane: nothing covers it). */}
        {bridge ? <PlayheadReadout bridge={bridge} className="fin-readout--lane" /> : null}
        {core && navigator && bridge ? (
          <NavControls core={core} navigator={navigator} bridge={bridge} />
        ) : null}
        {error ? (
          <div className="playlist-shell__status" role="alert">
            <strong>Error</strong>
            <span>{error}</span>
          </div>
        ) : null}
        <PlaylistInspector core={core} />
        {bridge ? <FinancialSidePanel bridge={bridge} /> : null}
        {bridge && !commandOpen ? <ValleyCard bridge={bridge} hoverDay={hoverDay} /> : null}
        {bridge && commandOpen ? (
          <CommandBar bridge={bridge} today={today} onClose={() => {
            setCommandOpen(false);
            hostRef.current?.focus();
          }} />
        ) : null}
        {peek ? (
          <div className="fin-peek" role="status" aria-live="polite">
            <strong>{peek.label}</strong>
            {peek.effect ? (
              <span data-tone={peek.effect.tone}>{peek.effect.text}</span>
            ) : null}
          </div>
        ) : null}
        <div className="fin-banners">
          {navHint && navigator && onboarding !== "banner" && !rec ? (
            <section className="fin-banner fin-banner--hint" aria-label="Cómo moverte">
              {navHint === "help" ? (
                <div className="fin-banner__text">
                  <NavHelp />
                </div>
              ) : (
                <div className="fin-banner__text">
                  <strong>Muévete libre:</strong> la rueda sube y baja entre líneas de evento,
                  Shift+rueda avanza en el tiempo, Ctrl+rueda o pellizca hace zoom y
                  Espacio+arrastra es la mano.
                </div>
              )}
              {navHint === "hint" ? (
                <button type="button" className="fin-button" onClick={() => setNavHint("help")}>
                  Ver todo
                </button>
              ) : null}
              <button type="button" className="fin-button fin-button--primary" onClick={dismissNavHint}>
                Entendido
              </button>
            </section>
          ) : null}
          {onboarding === "banner" ? (
            <WelcomeBanner
              onStart={() => setOnboarding("dialog")}
              onDismiss={() => setOnboarding(null)}
            />
          ) : null}
          {rec && !recOpen ? (
            <section className="fin-banner" aria-label="Tu año al día">
              <div className="fin-banner__text">
                <strong>Tu año está al día.</strong> Desde el {formatDateShort(rec.since)} supusimos
                que todo pasó como lo planeaste.
              </div>
              <button type="button" className="fin-button" onClick={() => setRecOpen(true)}>
                Revisar
              </button>
              <button
                type="button"
                className="fin-icon-button"
                aria-label="Está bien así"
                title="Está bien así"
                onClick={() => setRec(null)}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M5 5l10 10M15 5 5 15" />
                </svg>
              </button>
            </section>
          ) : null}
        </div>
      </div>
      {editor && bridge ? (
        editor.mode === "edit" ? (
          <FinancialEditorModal
            key={"edit:" + editor.id}
            bridge={bridge}
            itemId={editor.id}
            onClose={closeEditor}
            returnFocusFallback={getHost}
            onImportStatement={(cardId) => {
              setEditor(null);
              setStatement({ cardId, text: "" });
            }}
          />
        ) : (
          <FinancialEditorModal
            key={"create:" + editor.draft.id}
            bridge={bridge}
            draft={editor.draft}
            placement={editor.placement}
            onClose={closeEditor}
            returnFocusFallback={getHost}
          />
        )
      ) : null}
      {onboarding === "dialog" ? (
        <OnboardingDialog
          today={today}
          onCreate={createYear}
          onClose={() => setOnboarding("banner")}
        />
      ) : null}
      {rec && recOpen ? (
        <RecDialog
          pending={rec.pending}
          since={rec.since}
          onApply={applyRec}
          onClose={() => setRecOpen(false)}
        />
      ) : null}
      {statement && bridge ? (
        <StatementDialog
          bridge={bridge}
          cardId={statement.cardId}
          today={today}
          initialText={statement.text}
          onClose={() => {
            setStatement(null);
            hostRef.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}
