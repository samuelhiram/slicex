# Contributing to SliceX

## Branching & commits

- Branch base: **`master`**. No `main`.
- Nombres: `feat/<desc>`, `fix/<desc>`, `chore/<desc>`, `docs/<desc>`, `hotfix/<desc>`.
- Mensajes: `type(scope): short description` — ej. `feat(playlist): add slice tool guide`.
- No trabajar directo sobre `master`; abrir branch y mergear con PR.

## Pre-PR checklist

```powershell
pnpm install
pnpm -w run check:arch    # deep imports + mirrors .js + anti-patrones de performance
pnpm -w run typecheck     # raíz + cliente + worker
pnpm exec vitest run      # unit tests
```

Los tres tienen que estar en verde, no dos. Si tocas UI o canvas, además levanta `pnpm dev:web` y
verifica en el navegador — typecheck no detecta un render roto.

`pnpm -w run check:fast` (= `check:arch` + `check:env`) es el gate corto para iterar.

## Reglas que bloquean merge

- **Performance canon** ([docs/performance-canon.md](docs/performance-canon.md)): obligatorio para
  código en `packages/canvas/src/playlist-*` o el shell React. Si un budget de
  `packages/canvas/tests/perf-budget.spec.ts` falla, se arregla el código — **no se relaja la
  tolerancia**.
- Sin deep imports entre paquetes (`@slicex/<pkg>` únicamente).
- Sin mirrors `.js` junto a `.ts`/`.tsx`.
- Prisma sólo dentro de `@slicex/db`; `@slicex/core` sin IO.
- Cambios de lógica llevan test. Cambios de DTO actualizan `@slicex/contracts`.

## Review

- Abre PR contra `master`. La CI debe pasar y necesitas al menos una revisión aprobatoria.
- Antes de borrar cualquier pieza del scaffolding financiero (`@slicex/core`, `@slicex/contracts`,
  `@slicex/db`, `editorStore.ts`, la ruta `/api/timelines/:timelineId`): **preguntar primero**. Está
  dormido a propósito, no es deuda muerta.

## Code generation via AI

- Documenta qué se generó y por qué, y añade tests que cubran el comportamiento.
- Nunca mergear código generado sin revisión humana.
