import React from "react";
import {
  PLAYLIST_TOOL_HOTKEYS,
  createDemoPlaylistState,
  createPlaylistCore,
  createPlaylistInteractionController,
  createPlaylistRenderer,
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

function PlaylistToolbar({ core }: ToolbarProps) {
  const [active, setActive] = React.useState<PlaylistToolId>("select");
  const [snapMode, setSnapMode] = React.useState<PlaylistSnapMode>("beat");

  React.useEffect(() => {
    if (!core) {
      return undefined;
    }
    setActive(core.getState().tool);
    setSnapMode(core.getState().snap.mode);
    const sub = core.subscribe((state) => {
      setActive(state.tool);
      setSnapMode(state.snap.mode);
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
    </div>
  );
}

export function PlaylistShell() {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [core, setCore] = React.useState<PlaylistCore | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );
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
      onReady: () => setStatus("ready"),
      onError: (reason) => {
        setStatus("error");
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
      {status !== "ready" ? (
        <div
          className="playlist-shell__status"
          role={status === "error" ? "alert" : "status"}
        >
          <strong>{status === "error" ? "Error" : "Cargando"}</strong>
          <span>{status === "error" ? error : "Playlist"}</span>
        </div>
      ) : null}
    </section>
  );
}
