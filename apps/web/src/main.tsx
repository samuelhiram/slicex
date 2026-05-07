import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "./styles/globals.css";
import { App } from "./App";
import { initSentry } from "./lib/sentry";

initSentry();

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container '#root' not found in document.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
