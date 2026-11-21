// Mantine in SliceX: @mantine/form (state + validation of every form) and
// the calendar of @mantine/dates (DateField). The controls themselves stay
// ours (Soft UI); see docs/forms-audit.md.
//
// One palette: Mantine's CSS variables point at OUR tokens (globals.css),
// and its colour scheme follows the app theme (theme.ts), so the calendar
// switches light/dark with everything else. Its stylesheets are imported in
// main.tsx BEFORE globals.css (ours win at equal specificity), and only the
// pieces in use — never Mantine's baseline, which restyles <body>.
import * as React from "react";
import { MantineProvider, createTheme, type CSSVariablesResolver } from "@mantine/core";
import { DatesProvider, type DatesProviderSettings } from "@mantine/dates";
import "dayjs/locale/es";
import type { ThemeName } from "./theme";

const MANTINE_THEME = createTheme({
  fontFamily: "var(--font-sans)",
  cursorType: "pointer",
  defaultRadius: "md",
});

// Same values for both schemes: the tokens themselves switch with data-theme.
const TOKENS: Record<string, string> = {
  "--mantine-color-body": "var(--raised)",
  "--mantine-color-text": "var(--text)",
  "--mantine-color-bright": "var(--text)",
  "--mantine-color-dimmed": "var(--muted)",
  "--mantine-color-placeholder": "var(--muted)",
  "--mantine-color-default-border": "var(--line-strong)",
  "--mantine-color-error": "var(--fin-negative)",
  "--mantine-primary-color-filled": "var(--accent)",
  "--mantine-primary-color-filled-hover": "var(--accent-hover)",
  "--mantine-primary-color-light": "var(--accent-soft)",
  "--mantine-primary-color-light-hover": "var(--accent-soft)",
  "--mantine-primary-color-light-color": "var(--accent)",
  "--mantine-primary-color-contrast": "var(--on-accent)",
  "--mantine-radius-default": "var(--radius-s)",
};

const resolveTokens: CSSVariablesResolver = () => ({
  variables: TOKENS,
  light: TOKENS,
  dark: TOKENS,
});

// es-MX calendar: weeks start on Sunday (as Mexican calendars do), no
// weekend colouring (a weekend is not a warning in a money plan), always 6
// rows so the popover never changes height between months.
const DATES_SETTINGS: DatesProviderSettings = {
  locale: "es",
  firstDayOfWeek: 0,
  weekendDays: [],
  consistentWeeks: true,
};

export function SlicexMantineProvider({
  theme,
  children,
}: {
  theme: ThemeName;
  children: React.ReactNode;
}) {
  return (
    <MantineProvider
      theme={MANTINE_THEME}
      forceColorScheme={theme}
      cssVariablesResolver={resolveTokens}
    >
      <DatesProvider settings={DATES_SETTINGS}>{children}</DatesProvider>
    </MantineProvider>
  );
}
