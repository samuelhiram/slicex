"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import dynamic from "next/dynamic";
import { createBalanceStoreSubscriber } from "@slicex/canvas";
import { calculateBalanceAt } from "@slicex/core";
import { storeAdapter } from "../lib/storeAdapter";
const snapshotStoreAdapter = storeAdapter;
const DynamicCanvasShell = dynamic(() => import("../components/CanvasShell").then((module) => module.CanvasShell), { ssr: false });
function formatPlayhead(playheadAt) {
    if (playheadAt == null) {
        return "No playhead";
    }
    const date = playheadAt instanceof Date ? new Date(playheadAt) : new Date(playheadAt);
    if (Number.isNaN(date.getTime())) {
        return "No playhead";
    }
    return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(date);
}
function resolveBalanceLabel() {
    const snapshot = snapshotStoreAdapter.getState();
    if (!snapshot.document || snapshot.playheadAt == null) {
        return 0;
    }
    const playheadDate = snapshot.playheadAt instanceof Date
        ? new Date(snapshot.playheadAt)
        : new Date(snapshot.playheadAt);
    if (Number.isNaN(playheadDate.getTime())) {
        return 0;
    }
    return calculateBalanceAt(snapshot.document, playheadDate.toISOString());
}
function resolvePlayheadLabel() {
    return formatPlayhead(snapshotStoreAdapter.getState().playheadAt);
}
export default function Page() {
    const [balance, setBalance] = React.useState(() => resolveBalanceLabel());
    const [playheadLabel, setPlayheadLabel] = React.useState(() => resolvePlayheadLabel());
    React.useEffect(() => {
        const balanceSubscription = createBalanceStoreSubscriber(snapshotStoreAdapter, setBalance);
        const playheadSubscription = snapshotStoreAdapter.subscribeState((snapshot) => {
            setPlayheadLabel(formatPlayhead(snapshot.playheadAt));
        });
        return () => {
            balanceSubscription.destroy();
            playheadSubscription.unsubscribe();
        };
    }, []);
    return (_jsxs("main", { style: {
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            background: "#f8fafc",
            color: "#0f172a",
        }, children: [_jsxs("header", { style: {
                    height: 48,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    padding: "0 16px",
                    borderBottom: "1px solid #cbd5e1",
                    background: "#ffffff",
                    flex: "0 0 48px",
                }, children: [_jsx("div", { children: "SliceX" }), _jsxs("div", { children: ["Balance: ", balance] }), _jsxs("div", { children: ["Playhead: ", playheadLabel] })] }), _jsx("section", { id: "editor-root", style: { flex: 1, minHeight: 0 }, children: _jsx("div", { style: {
                        width: "100%",
                        height: "100%",
                        overflow: "hidden",
                    }, children: _jsx(DynamicCanvasShell, {}) }) })] }));
}
