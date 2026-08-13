# JS Dedup Plan

> **Histórico (era Next.js).** Plan de eliminación de los mirrors `.js`. Ya ejecutado — ver
> [js-dedup-report.md](js-dedup-report.md). Las rutas `apps/web/src/app/**` que lista ya no existen.

## Objetivo

Dejar TypeScript como unica fuente de verdad en `src/` y eliminar mirrors `.js`/`.jsx` que dupliquen archivos `.ts`/`.tsx` en el arbol de aplicaciones, paquetes y tests.

## Fase 1 - Runtime vivo

1. Corregir `packages/canvas/src/playlist-interaction/controller.ts` para que deje de importar `./hit-test.js`.
2. Eliminar `packages/canvas/src/playlist-interaction/hit-test.js` solo despues de validar que ya no existe ningun import relativo a ese archivo.

## Fase 2 - Tests

1. Ajustar `vitest.config.ts` para que descubra solo `**/*.spec.ts` y `**/*.spec.tsx`.
2. Eliminar los espejos `.spec.js` que hoy estan entrando a la suite.

## Fase 3 - Borrado de mirrors estables

Eliminar estos archivos una vez que las fases 1 y 2 esten cerradas:

### `apps/web`

- `apps/web/instrumentation.js`
- `apps/web/tests/playwright.js`
- `apps/web/src/app/error.js`
- `apps/web/src/app/global-error.js`
- `apps/web/src/app/layout.js`
- `apps/web/src/app/page.js`
- `apps/web/src/app/api/health/route.js`
- `apps/web/src/app/api/internal/keepalive/route.js`
- `apps/web/src/app/api/timelines/[timelineId]/route.js`
- `apps/web/src/components/PlaylistShell.js`
- `apps/web/src/instrumentation-client.js`
- `apps/web/src/instrumentation.js`
- `apps/web/src/lib/errors.js`
- `apps/web/src/lib/supabaseServer.js`
- `apps/web/src/server/services/timelines.js`
- `apps/web/src/store/editorStore.js`

### `packages/canvas`

- `packages/canvas/src/index.js`
- `packages/canvas/src/playlist-core/demo.js`
- `packages/canvas/src/playlist-core/geometry.js`
- `packages/canvas/src/playlist-core/index.js`
- `packages/canvas/src/playlist-core/presentation.js`
- `packages/canvas/src/playlist-core/state.js`
- `packages/canvas/src/playlist-core/state-track-helpers.js`
- `packages/canvas/src/playlist-core/state-utils.js`
- `packages/canvas/src/playlist-core/types.js`
- `packages/canvas/src/playlist-interaction/controller.js`
- `packages/canvas/src/playlist-interaction/hit-test.js`
- `packages/canvas/src/playlist-interaction/index.js`
- `packages/canvas/src/playlist-renderer-pixi/index.js`
- `packages/canvas/src/playlist-renderer-pixi/renderer.js`
- `packages/canvas/src/playlist-renderer-pixi/renderer-impl.js`

### `packages/core`

- `packages/core/src/calculateBalanceAt.js`
- `packages/core/src/index.js`
- `packages/core/src/types.js`

### `packages/contracts`

- `packages/contracts/src/errors.js`
- `packages/contracts/src/index.js`

### `packages/db`

- `packages/db/src/client.js`
- `packages/db/src/index.js`

### `packages/testing`

- `packages/testing/src/index.js`

### Tests

- `packages/contracts/tests/errors.spec.js`
- `packages/contracts/tests/index.spec.js`
- `packages/core/tests/calculate.spec.js`
- `packages/testing/tests/index.spec.js`

## Fase 4 - Guardrails

1. Add a repo-level check that fails if a `.ts`/`.tsx` file has a same-basename `.js`/`.jsx` sibling under `apps/web/src`, `packages/*/src`, or `packages/*/tests`.
2. Wire that check into `pnpm -w run check:arch` so it runs in CI and pre-commit.

## Fase 5 - Validacion

Run and record the result of:

1. `pnpm -w run check:arch`
2. `pnpm -w run typecheck`
3. `pnpm -w run test:unit`
4. `pnpm --filter apps-web build`

## Criterios de aceptacion

- No quedan mirrors `.js`/`.jsx` junto a archivos `.ts`/`.tsx` en los arboles cubiertos.
- `check:arch` falla si alguien reintroduce un mirror.
- `vitest` deja de descubrir `.spec.js`.
- `apps/web` compila con TypeScript como fuente de verdad.
- `hit-test.js` deja de ser una dependencia viva antes del borrado.
