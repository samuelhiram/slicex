// Light / dark theme for the whole app: the DOM (CSS tokens under
// `:root[data-theme=…]` in styles/globals.css) and the canvas (the Pixi
// palette, switched by PlaylistRenderer.setTheme).
//
// First visit follows the OS (prefers-color-scheme) and keeps following it;
// once the user picks a theme with the toggle, that choice is remembered.
import * as React from "react";

export type ThemeName = "light" | "dark";

const STORAGE_KEY = "slicex.theme";

function isThemeName(value: unknown): value is ThemeName {
  return value === "light" || value === "dark";
}

export function readStoredTheme(): ThemeName | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isThemeName(value) ? value : null;
  } catch {
    return null;
  }
}

function storeTheme(theme: ThemeName): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode / blocked storage: the choice just won't persist.
  }
}

function darkQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia("(prefers-color-scheme: dark)");
}

export function systemTheme(): ThemeName {
  return darkQuery()?.matches ? "dark" : "light";
}

export function initialTheme(): ThemeName {
  return readStoredTheme() ?? systemTheme();
}

// Applies the theme to the document: CSS tokens, native controls
// (color-scheme) and the browser chrome colour.
export function applyDocumentTheme(theme: ThemeName): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute("content", theme);
  const chrome = document.querySelector('meta[name="theme-color"]');
  if (chrome) chrome.setAttribute("content", theme === "dark" ? "#0e0e10" : "#ffffff");
}

export interface ThemeController {
  theme: ThemeName;
  toggle: () => void;
}

export function useTheme(): ThemeController {
  const [theme, setTheme] = React.useState<ThemeName>(initialTheme);
  const [explicit, setExplicit] = React.useState(() => readStoredTheme() !== null);

  React.useEffect(() => {
    applyDocumentTheme(theme);
  }, [theme]);

  // Follow the OS until the user picks a theme.
  React.useEffect(() => {
    if (explicit) return undefined;
    const query = darkQuery();
    if (!query) return undefined;
    const onChange = () => setTheme(query.matches ? "dark" : "light");
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, [explicit]);

  const toggle = React.useCallback(() => {
    setTheme((current) => {
      const next: ThemeName = current === "dark" ? "light" : "dark";
      storeTheme(next);
      return next;
    });
    setExplicit(true);
  }, []);

  return { theme, toggle };
}
