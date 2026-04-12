"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BalanceSummary } from "../components/BalanceSummary";
import { CanvasShell } from "../components/CanvasShell";
import { formatPlayheadLabel } from "../lib/editorFormatters";
import { storeAdapter } from "../lib/storeAdapter";
import { useStoreSnapshot } from "../lib/useStoreSnapshot";
const trackPalette = [
    "#0f766e",
    "#2563eb",
    "#7c3aed",
    "#d97706",
    "#0891b2",
    "#4f46e5",
];
const amountFormatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
});
function formatAmount(amount) {
    const formatted = amountFormatter.format(Math.abs(amount));
    if (amount > 0) {
        return `+${formatted}`;
    }
    if (amount < 0) {
        return `-${formatted}`;
    }
    return formatted;
}
function formatItemDate(value) {
    if (value == null) {
        return "No date";
    }
    const parsedDate = value instanceof Date ? new Date(value) : new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
        return "No date";
    }
    return dateFormatter.format(parsedDate);
}
export default function Page() {
    const snapshot = useStoreSnapshot(storeAdapter);
    const document = snapshot.document;
    const items = document?.items ?? [];
    const playheadLabel = formatPlayheadLabel(snapshot.playheadAt);
    return (_jsxs("main", { className: "editor-page", children: [_jsxs("header", { className: "editor-topbar", children: [_jsxs("div", { className: "editor-brand", children: [_jsx("span", { className: "editor-brand__eyebrow", children: "Timeline workspace" }), _jsx("div", { className: "editor-brand__title", children: "SliceX" })] }), _jsxs("div", { className: "editor-metrics", children: [_jsx(BalanceSummary, { store: storeAdapter }), _jsxs("div", { className: "editor-metric", children: [_jsx("span", { className: "editor-metric__label", children: "Playhead: " }), _jsx("strong", { className: "editor-metric__value", children: playheadLabel })] })] })] }), _jsxs("section", { className: "editor-body", children: [_jsxs("aside", { className: "editor-sidebar", children: [_jsxs("div", { className: "editor-panel", children: [_jsx("div", { className: "editor-panel__label", children: "Active timeline" }), _jsx("h1", { className: "editor-panel__title", children: document?.title ?? "Untitled timeline" }), _jsx("p", { className: "editor-panel__body", children: items.length > 0
                                            ? `${items.length} entries are projected into the canvas.`
                                            : "No timeline items are loaded yet." })] }), _jsx("ul", { className: "editor-track-list", "aria-label": "Timeline items", children: items.length > 0 ? (items.map((item, index) => {
                                    const trackColor = trackPalette[index % trackPalette.length];
                                    const tone = item.amount < 0 ? "negative" : item.amount > 0 ? "positive" : "neutral";
                                    return (_jsxs("li", { className: "editor-track", "data-tone": tone, children: [_jsx("span", { "aria-hidden": "true", className: "editor-track__swatch", style: { backgroundColor: trackColor } }), _jsxs("div", { className: "editor-track__meta", children: [_jsx("span", { className: "editor-track__name", children: item.name }), _jsx("span", { className: "editor-track__detail", children: formatItemDate(item.date) })] }), _jsx("strong", { className: "editor-track__amount", children: formatAmount(item.amount) })] }, item.id));
                                })) : (_jsxs("li", { className: "editor-track editor-track--empty", children: [_jsx("strong", { children: "No timeline entries yet." }), "Add an item to see it projected onto the canvas."] })) })] }), _jsx("div", { className: "editor-canvas-shell", id: "editor-root", children: _jsx(CanvasShell, {}) })] })] }));
}
