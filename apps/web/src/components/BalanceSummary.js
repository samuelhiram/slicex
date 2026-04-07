"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import { createBalanceStoreSubscriber, } from "@slicex/canvas";
import { storeAdapter as defaultStoreAdapter } from "../lib/storeAdapter";
function formatBalance(balance) {
    return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 0,
    }).format(balance);
}
export function BalanceSummary({ store = defaultStoreAdapter }) {
    const [balance, setBalance] = React.useState(0);
    React.useEffect(() => {
        const subscription = createBalanceStoreSubscriber(store, setBalance);
        return () => {
            subscription.destroy();
        };
    }, [store]);
    const balanceTone = balance < 0 ? "#b42318" : "#0f766e";
    return (_jsxs("aside", { "aria-live": "polite", role: "status", style: {
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 16,
            padding: "14px 18px",
            borderRadius: 16,
            border: "1px solid rgba(15, 23, 42, 0.12)",
            background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
            boxShadow: "0 12px 32px rgba(15, 23, 42, 0.08)",
        }, children: [_jsxs("div", { children: [_jsx("div", { style: {
                            fontSize: 12,
                            fontWeight: 700,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "#64748b",
                        }, children: "Current balance" }), _jsx("div", { style: {
                            marginTop: 4,
                            fontSize: 28,
                            fontWeight: 800,
                            lineHeight: 1.1,
                            color: balanceTone,
                        }, "data-testid": "balance-summary-value", children: formatBalance(balance) })] }), _jsx("div", { style: {
                    alignSelf: "stretch",
                    width: 4,
                    borderRadius: 999,
                    background: balance < 0
                        ? "linear-gradient(180deg, #ef4444 0%, #b91c1c 100%)"
                        : "linear-gradient(180deg, #14b8a6 0%, #0f766e 100%)",
                } })] }));
}
