"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { storeAdapter as defaultStoreAdapter } from "../lib/storeAdapter";
import { formatBalanceValue, resolveSnapshotBalance, } from "../lib/editorFormatters";
import { useStoreSnapshot } from "../lib/useStoreSnapshot";
export function BalanceSummary({ store = defaultStoreAdapter }) {
    const snapshot = useStoreSnapshot(store);
    const balance = resolveSnapshotBalance(snapshot);
    const balanceTone = balance < 0 ? "negative" : "positive";
    return (_jsxs("div", { role: "status", "data-tone": balanceTone, className: "balance-summary", children: [_jsxs("div", { className: "balance-summary__copy", children: [_jsx("span", { className: "balance-summary__label", children: "Balance: " }), _jsx("strong", { className: "balance-summary__value", "data-testid": "balance-summary-value", children: formatBalanceValue(balance) })] }), _jsx("span", { "aria-hidden": "true", className: "balance-summary__accent" })] }));
}
