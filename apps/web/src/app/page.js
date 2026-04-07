"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CanvasShell } from "../components/CanvasShell";
export default function Page() {
    return (_jsxs("main", { style: {
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            background: "#f8fafc",
            color: "#0f172a",
        }, children: [_jsxs("header", { style: { padding: "24px 32px 16px" }, children: [_jsx("h1", { style: { margin: 0 }, children: "SliceX \u2014 Editor shell" }), _jsx("p", { style: { margin: "8px 0 0", color: "#475569" }, children: "Canvas engine wiring for the timeline workspace." })] }), _jsx("section", { id: "editor-root", style: { flex: 1, minHeight: 0, padding: "0 24px 24px" }, children: _jsx("div", { style: {
                        width: "100%",
                        height: "100%",
                        overflow: "hidden",
                        border: "1px solid #cbd5e1",
                        borderRadius: 16,
                        background: "#ffffff",
                        boxShadow: "0 16px 40px rgba(15, 23, 42, 0.08)",
                    }, children: _jsx(CanvasShell, {}) }) })] }));
}
