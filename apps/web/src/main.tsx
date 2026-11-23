import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Mantine's stylesheets first (only what is in use — no baseline, it would
// restyle <body>), so globals.css wins at equal specificity. See mantine.tsx.
// default-css-variables: Mantine's own sizes (--mantine-scale, spacing…) on
// :root only — the provider injects just what differs from them, so without
// this file every calc() of the calendar is invalid.
import "@mantine/core/styles/default-css-variables.css";
import "@mantine/core/styles/global.css";
import "@mantine/core/styles/UnstyledButton.css";
import "@mantine/core/styles/Popover.css";
import "@mantine/dates/styles.css";
import "./styles/globals.css";
import { App } from "./App";
import { initSentry } from "./lib/sentry";
import { clearPlan, savePlan } from "./finance/persistence";
import { testPlan } from "./finance/test-plans";
import { localTodayISO } from "./clock";
import { applyDocumentTheme, initialTheme } from "./theme";

initSentry();
// "?reset": start over with the example year; "?reset=memoria": with a plan
// set 22 days ago that remembers its past (test-plans.ts). Testing hooks:
// they replace the saved plan. Run before the app loads it, so no autosave
// can race them.
const reset = new URLSearchParams(window.location.search).get("reset");
if (reset !== null) {
  clearPlan();
  const plan = reset ? testPlan(reset, localTodayISO()) : null;
  if (plan) savePlan(plan);
  window.history.replaceState(null, "", window.location.pathname + window.location.hash);
}
// Before the first paint: no flash of the wrong theme.
applyDocumentTheme(initialTheme());

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container '#root' not found in document.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
