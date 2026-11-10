import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Mantine's stylesheets first (only what is in use — no baseline, it would
// restyle <body>), so globals.css wins at equal specificity. See mantine.tsx.
import "@mantine/core/styles/global.css";
import "@mantine/core/styles/UnstyledButton.css";
import "@mantine/core/styles/Popover.css";
import "@mantine/dates/styles.css";
import "./styles/globals.css";
import { App } from "./App";
import { initSentry } from "./lib/sentry";
import { clearPlan } from "./finance/persistence";
import { applyDocumentTheme, initialTheme } from "./theme";

initSentry();
// "?reset": start over with the example year (testing). Runs before the
// app loads the saved plan, so no autosave can race it.
if (new URLSearchParams(window.location.search).has("reset")) {
  clearPlan();
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
