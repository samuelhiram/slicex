"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
export default function ErrorPage({ error, reset, }) {
    useEffect(() => {
        console.error(error);
    }, [error]);
    return (_jsxs("main", { className: "app-error", role: "alert", children: [_jsx("div", { className: "app-error__eyebrow", children: "Route error" }), _jsx("h1", { className: "app-error__title", children: "The editor crashed in this route." }), _jsx("p", { className: "app-error__body", children: "Next.js caught the failure. Check the terminal for browser logs and retry the route." }), _jsx("button", { type: "button", className: "app-error__action", onClick: reset, children: "Try again" })] }));
}
