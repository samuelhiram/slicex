# JS Dedup Report

> **Histórico (2026-04-19).** Resultado del dedup de mirrors `.js`. La regla que dejó viva sí sigue
> vigente y la enforce `scripts/check-js-siblings.mjs` dentro de `check:arch`.

## Resultado

Consolidacion completada. TypeScript quedo como fuente de verdad en `src/` y los mirrors `.js`/`.spec.js` que estaban duplicando archivos `.ts`/`.tsx` fueron eliminados. El unico caso vivo que mantenia un mirror activo en runtime, `packages/canvas/src/playlist-interaction/hit-test.js`, fue corregido primero y luego borrado.

## Cambios aplicados

- `packages/canvas/src/playlist-interaction/controller.ts` dejo de importar `./hit-test.js` y paso a importar `./hit-test`.
- `vitest.config.ts` paso a descubrir solo `**/*.spec.ts` y `**/*.spec.tsx`.
- Se agrego `scripts/check-js-siblings.mjs` y `check:arch` ahora ejecuta ese guardrail junto con `scripts/check-imports.mjs`.
- `tsconfig.base.json` quedo con `noEmit: true` y los scripts de typecheck de root y `apps/web` quedaron explicitos con `--noEmit` para evitar que `tsc` regenere mirrors.
- Se eliminaron los mirrors `.js` y `.spec.js` listados en el plan, incluyendo `apps/web/tests/playwright.js`.

## Validacion

- `pnpm.cmd -w run check:arch` -> OK
- `pnpm.cmd -w run typecheck` -> OK
- `pnpm.cmd -w exec vitest run` -> OK
- `pnpm.cmd --filter apps-web build` -> OK
- `pnpm.cmd -w run check:arch` despues del build -> OK

## Nota sobre `apps/web/tests/playwright.js`

Se verifico que no tenia consumidor repo-local antes de borrarlo; no aparecio ningun import de `./playwright` dentro de `apps/web/tests`.

## Efectos secundarios del toolchain

Durante la validacion, Next/TypeScript refrescaron `apps/web/next-env.d.ts` y `tsconfig.tsbuildinfo`. No forman parte de la deduplicacion funcional, pero quedaron actualizados por la ejecucion de las herramientas.
