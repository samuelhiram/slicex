"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import { createDemoPlaylistState, createPlaylistCore, createPlaylistInteractionController, createPlaylistRenderer, } from "@slicex/canvas";
export function PlaylistShell() {
    const hostRef = React.useRef(null);
    const [status, setStatus] = React.useState("loading");
    const [error, setError] = React.useState(null);
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
        return () => {
            interaction.destroy();
            renderer.destroy();
        };
    }, []);
    return (_jsxs("section", { className: "playlist-shell", "aria-label": "Playlist", children: [_jsx("div", { ref: hostRef, className: "playlist-shell__surface", tabIndex: 0 }), status !== "ready" ? (_jsxs("div", { className: "playlist-shell__status", role: status === "error" ? "alert" : "status", children: [_jsx("strong", { children: status === "error" ? "Error" : "Cargando" }), _jsx("span", { children: status === "error" ? error : "Playlist" })] })) : null] }));
}
