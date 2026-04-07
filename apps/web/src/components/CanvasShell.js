"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import dynamic from "next/dynamic";
import { storeAdapter } from "../lib/storeAdapter";
const CanvasRenderer = dynamic(() => import("@slicex/canvas").then((m) => m.CanvasRenderer), { ssr: false });
export function CanvasShell() {
    return (_jsx("div", { style: { width: "100%", height: "100%" }, children: _jsx(CanvasRenderer, { store: storeAdapter }) }));
}
