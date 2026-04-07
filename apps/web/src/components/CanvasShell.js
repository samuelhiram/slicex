"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import { storeAdapter } from "../lib/storeAdapter";
export function CanvasShell() {
    const containerRef = React.useRef(null);
    React.useEffect(() => {
        let destroyed = false;
        let renderer = null;
        async function mountRenderer() {
            if (!containerRef.current) {
                return;
            }
            const { createRenderer } = await import("@slicex/canvas");
            if (destroyed || !containerRef.current) {
                return;
            }
            renderer = createRenderer(containerRef.current, storeAdapter);
        }
        void mountRenderer();
        return () => {
            destroyed = true;
            renderer?.destroy();
        };
    }, []);
    return (_jsx("div", { ref: containerRef, style: { width: "100%", height: "100%", minHeight: 0 } }));
}
