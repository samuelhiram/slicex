"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import { createCanvasInteractionController } from "@slicex/canvas";
import { storeAdapter } from "../lib/storeAdapter";
import { applyCanvasCommand, resolveInitialViewportOriginDate, } from "../lib/canvasCommandBridge";
export function CanvasShell() {
    const containerRef = React.useRef(null);
    const [status, setStatus] = React.useState("loading");
    const [errorMessage, setErrorMessage] = React.useState(null);
    React.useEffect(() => {
        let destroyed = false;
        let renderer = null;
        let controller = null;
        const container = containerRef.current;
        if (!container) {
            return undefined;
        }
        const snapshot = storeAdapter.getState();
        const originDate = resolveInitialViewportOriginDate(snapshot);
        if (snapshot.viewport?.originDate !== originDate) {
            storeAdapter.setViewport({
                x: snapshot.viewport?.x ?? 0,
                y: snapshot.viewport?.y ?? 0,
                zoom: snapshot.viewport?.zoom ?? 1,
                originDate,
            });
        }
        controller = createCanvasInteractionController(container, storeAdapter, {
            onCommand: (command) => {
                applyCanvasCommand(command, storeAdapter);
            },
        });
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
                        setErrorMessage(error instanceof Error
                            ? error.message
                            : "Canvas renderer failed to start.");
                    },
                });
            }
            catch (error) {
                if (destroyed) {
                    return;
                }
                setStatus("error");
                setErrorMessage(error instanceof Error
                    ? error.message
                    : "Canvas renderer failed to start.");
            }
        }
        void mountRenderer();
        return () => {
            destroyed = true;
            controller?.destroy();
            renderer?.destroy();
        };
    }, []);
    const isReady = status === "ready";
    return (_jsxs("div", { className: "canvas-shell", "data-state": status, children: [_jsx("div", { ref: containerRef, className: "canvas-shell__surface" }), !isReady ? (_jsxs("div", { "aria-live": status === "error" ? undefined : "polite", className: "canvas-shell__state", role: status === "error" ? "alert" : "status", children: [_jsx("div", { className: "canvas-shell__eyebrow", children: status === "error" ? "Renderer error" : "Loading canvas" }), _jsx("div", { className: "canvas-shell__title", children: status === "error"
                            ? "SliceX could not start the canvas"
                            : "Booting the Pixi scene" }), _jsx("p", { className: "canvas-shell__body", children: status === "error"
                            ? (errorMessage ?? "Try reloading the page.")
                            : "Initializing the viewport, layers, and store subscriptions." })] })) : null] }));
}
