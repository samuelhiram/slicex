# SliceX Frontend Canon

This document defines the visual and layout baseline for the web app.

## Rules

- Use a full-bleed shell with structural dividers, not card-heavy composition.
- Prefer 1px separators and aligned rails over large gaps, shadows, or rounded panels.
- Keep padding minimal and reserve it for interactive controls or unavoidable structural insets.
- Avoid page-level scrolling; clip the shell and let only true overflow regions scroll.
- Theme automatically with `color-scheme: light dark` and CSS variables.
- Keep the canvas visually structured at all times: ruler, track grid, and playhead must remain visible even when there are no items.
- React should own shell state and layout. Pixi should own canvas drawing and subscribe to store snapshots.
- Prefer stable, low-dependency primitives for future modal or form surfaces; keep the editor shell CSS-first unless there is a strong reason to adopt a component library.
- Forms: Mantine Form (`@mantine/form`, state/validation/submit — no Mantine UI components) + Zod schemas shared from `@slicex/contracts` (`finance.ts`), resolved with `schemaResolver`. Uncontrolled mode unless the UI derives from every keystroke (then controlled). Every field shows its own error (`aria-invalid` + `aria-describedby`); one `role="alert"` line summarises the first. Controls stay the app's own (Soft UI). See `docs/forms-audit.md`.
