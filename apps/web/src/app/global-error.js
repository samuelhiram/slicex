"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
export default function GlobalError({ error, reset, }) {
    useEffect(() => {
        console.error(error);
    }, [error]);
    return (_jsx("html", { lang: "en", children: _jsx("body", { children: _jsxs("main", { className: "global-error", role: "alert", children: [_jsx("div", { className: "global-error__eyebrow", children: "Global error" }), _jsx("h1", { className: "global-error__title", children: "SliceX hit a fatal application error." }), _jsx("p", { className: "global-error__body", children: "The root layout failed. Inspect the Next.js terminal output and reload after fixing the issue." }), _jsx("button", { type: "button", className: "global-error__action", onClick: reset, children: "Try again" })] }) }) }));
}
