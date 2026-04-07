"use client";
import React from "react";
import { storeAdapter } from "../lib/storeAdapter";

export function CanvasShell() {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let destroyed = false;
    let renderer: { destroy(): void } | null = null;

    async function mountRenderer() {
      try {
        if (!containerRef.current) {
          return;
        }

        const { createRenderer } = await import("@slicex/canvas");

        if (destroyed || !containerRef.current) {
          return;
        }

        renderer = createRenderer(containerRef.current, storeAdapter, {
          onReady: () => {
            if (!destroyed) {
              setStatus("ready");
            }
          },
          onError: (error) => {
            if (destroyed) {
              return;
            }

            setStatus("error");
            setErrorMessage(
              error instanceof Error ? error.message : "Canvas renderer failed to start.",
            );
          },
        });
      } catch (error) {
        if (destroyed) {
          return;
        }

        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "Canvas renderer failed to start.",
        );
      }
    }

    void mountRenderer();

    return () => {
      destroyed = true;
      renderer?.destroy();
    };
  }, []);

  const isReady = status === "ready";

  return (
    <div className="canvas-shell" data-state={status}>
      <div ref={containerRef} className="canvas-shell__surface" />
      {!isReady ? (
        <div
          aria-live={status === "error" ? undefined : "polite"}
          className="canvas-shell__state"
          role={status === "error" ? "alert" : "status"}
        >
          <div className="canvas-shell__panel">
            <div className="canvas-shell__eyebrow">
              {status === "error" ? "Renderer error" : "Loading canvas"}
            </div>
            <div className="canvas-shell__title">
              {status === "error"
                ? "SliceX could not start the canvas"
                : "Booting the Pixi scene"}
            </div>
            <p className="canvas-shell__body">
              {status === "error"
                ? errorMessage ?? "Try reloading the page."
                : "Initializing the viewport, layers, and store subscriptions."}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
