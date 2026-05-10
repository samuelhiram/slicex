import React from "react";
import {
  PLAYLIST_TOOL_HOTKEYS,
  createDemoPlaylistState,
  createPlaylistCore,
  createPlaylistInteractionController,
  createPlaylistRenderer,
  type PlaylistContextMenu,
  type PlaylistCore,
  type PlaylistSnapMode,
  type PlaylistToolId,
} from "@slicex/canvas";

const SNAP_OPTIONS: ReadonlyArray<{ value: PlaylistSnapMode; label: string }> =
  [
    { value: "main", label: "Main" },
    { value: "line", label: "Line" },
    { value: "cell", label: "Cell" },
    { value: "none", label: "None" },
    { value: "sixth-step", label: "1/6 Step" },
    { value: "quarter-step", label: "1/4 Step" },
    { value: "third-step", label: "1/3 Step" },
    { value: "half-step", label: "1/2 Step" },
    { value: "step", label: "Step" },
    { value: "sixth-beat", label: "1/6 Beat" },
    { value: "quarter-beat", label: "1/4 Beat" },
    { value: "third-beat", label: "1/3 Beat" },
    { value: "half-beat", label: "1/2 Beat" },
    { value: "beat", label: "Beat" },
    { value: "bar", label: "Bar" },
    { value: "events", label: "Events" },
  ];

const TOOL_BUTTONS: ReadonlyArray<{
  id: PlaylistToolId;
  label: string;
  title: string;
}> = [
  { id: "select", label: "Sel", title: "Select" },
  { id: "draw", label: "Drw", title: "Draw" },
  { id: "paint", label: "Pnt", title: "Paint" },
  { id: "delete", label: "Del", title: "Delete" },
  { id: "mute", label: "Mut", title: "Mute" },
  { id: "slip", label: "Slp", title: "Slip (coming soon)" },
  { id: "slice", label: "Slc", title: "Slice (coming soon)" },
  { id: "zoom", label: "Zm", title: "Zoom" },
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
  const [stretchMode, setStretchMode] = React.useState(false);

  React.useEffect(() => {
    if (!core) {
      return undefined;
    }
    setActive(core.getState().tool);
    setSnapMode(core.getState().snap.mode);
    setStretchMode(core.getState().stretchMode);
    const sub = core.subscribe((state) => {
      setActive(state.tool);
      setSnapMode(state.snap.mode);
      setStretchMode(state.stretchMode);
    });
    return () => sub.unsubscribe();
  }, [core]);

  return (
    <div className="playlist-shell__toolbar" role="toolbar" aria-label="Tools">
      {TOOL_BUTTONS.map((button) => {
        const hotkey = PLAYLIST_TOOL_HOTKEYS[button.id];
        return (
          <button
            key={button.id}
            type="button"
            className="playlist-shell__tool"
            data-active={active === button.id ? "true" : "false"}
            data-tool={button.id}
            title={`${button.title} (${hotkey})`}
            onClick={() => core?.setTool(button.id)}
          >
            <span className="playlist-shell__tool-label">{button.label}</span>
            <span className="playlist-shell__tool-hotkey">{hotkey}</span>
          </button>
        );
      })}
      <label
        className="playlist-shell__snap"
        title="Snap mode (Backspace toggles None)"
      >
        <span className="playlist-shell__snap-label">Snap</span>
        <select
          value={snapMode}
          onChange={(event) =>
            core?.setSnapMode(event.target.value as PlaylistSnapMode)
          }
          className="playlist-shell__snap-select"
        >
          {SNAP_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="playlist-shell__tool"
        data-active={stretchMode ? "true" : "false"}
        title="Stretch mode — resize stretches content (Shift+M)"
        onClick={() => core?.toggleStretchMode()}
      >
        <span className="playlist-shell__tool-label">Str</span>
        <span className="playlist-shell__tool-hotkey">⇧M</span>
      </button>
    </div>
  );
}

export function PlaylistShell() {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [core, setCore] = React.useState<PlaylistCore | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return undefined;
    }

    const instance = createPlaylistCore(createDemoPlaylistState());
    setCore(instance);
    const interaction = createPlaylistInteractionController(host, instance);
    const renderer = createPlaylistRenderer(host, instance, {
      onError: (reason) => {
        setError(reason instanceof Error ? reason.message : "Renderer failed.");
      },
    });
    let frameId = 0;
    let lastFrame = performance.now();

    const tick = (now: number) => {
      const deltaSeconds = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      instance.advancePlayPosition(deltaSeconds * 2);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      interaction.destroy();
      renderer.destroy();
      setCore(null);
    };
  }, []);

  return (
    <section className="playlist-shell" aria-label="Playlist">
      <PlaylistToolbar core={core} />
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
    </section>
  );
}
