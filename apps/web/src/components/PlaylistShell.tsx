"use client";

import React from "react";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  createPlaylistInteractionController,
  createPlaylistRenderer,
} from "@slicex/canvas";

export function PlaylistShell() {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return undefined;
    }

    const core = createPlaylistCore(createDemoPlaylistState());
    const interaction = createPlaylistInteractionController(host, core);
    const renderer = createPlaylistRenderer(host, core, {
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
      core.advancePlayPosition(deltaSeconds * 2);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      interaction.destroy();
      renderer.destroy();
    };
  }, []);

  return (
    <section className="playlist-shell" aria-label="Playlist">
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
