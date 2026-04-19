# JS Duplication Audit

## Verdict

Mixed. The repository still contains 43 checked-in `.js` mirrors beside `.ts` / `.tsx` sources. Most are stale and can be deleted, but there are two live exceptions that must be handled first: `packages/canvas/src/playlist-interaction/hit-test.js` is imported explicitly from TypeScript, and the `.spec.js` files under `packages/**/tests` are executed by Vitest. `apps/web/tests/playwright.js` is currently dormant rather than proven active.

## Summary

This is not a single duplicate pattern. In `apps/web/src`, the `.js` siblings are legacy mirrors of App Router pages, route handlers, and helpers; Next build artifacts point at the `.ts` / `.tsx` files instead. In `packages/*/src`, the same pattern holds: package entrypoints and import resolution go to TypeScript sources, not the mirrored `.js` files. The exception is `packages/canvas/src/playlist-interaction/hit-test.js`, which is part of the runtime graph because `controller.ts` imports it by name.

## Duplicate File Pairs

### Active today

- `apps/web/src/instrumentation-client.js` ↔ `apps/web/src/instrumentation-client.ts`
- `packages/canvas/src/playlist-interaction/hit-test.js` ↔ `packages/canvas/src/playlist-interaction/hit-test.ts`
- `packages/contracts/tests/errors.spec.js` ↔ `packages/contracts/tests/errors.spec.ts`
- `packages/contracts/tests/index.spec.js` ↔ `packages/contracts/tests/index.spec.ts`
- `packages/core/tests/calculate.spec.js` ↔ `packages/core/tests/calculate.spec.ts`
- `packages/testing/tests/index.spec.js` ↔ `packages/testing/tests/index.spec.ts`

### Dormant

- `apps/web/tests/playwright.js` ↔ `apps/web/tests/playwright.ts`

### Stale mirrors

#### apps/web

- `apps/web/instrumentation.js` ↔ `apps/web/instrumentation.ts`
- `apps/web/src/instrumentation.js` ↔ `apps/web/src/instrumentation.ts`
- `apps/web/src/app/page.js` ↔ `apps/web/src/app/page.tsx`
- `apps/web/src/app/layout.js` ↔ `apps/web/src/app/layout.tsx`
- `apps/web/src/app/error.js` ↔ `apps/web/src/app/error.tsx`
- `apps/web/src/app/global-error.js` ↔ `apps/web/src/app/global-error.tsx`
- `apps/web/src/components/PlaylistShell.js` ↔ `apps/web/src/components/PlaylistShell.tsx`
- `apps/web/src/lib/errors.js` ↔ `apps/web/src/lib/errors.ts`
- `apps/web/src/lib/supabaseServer.js` ↔ `apps/web/src/lib/supabaseServer.ts`
- `apps/web/src/server/services/timelines.js` ↔ `apps/web/src/server/services/timelines.ts`
- `apps/web/src/store/editorStore.js` ↔ `apps/web/src/store/editorStore.ts`
- `apps/web/src/app/api/health/route.js` ↔ `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/internal/keepalive/route.js` ↔ `apps/web/src/app/api/internal/keepalive/route.ts`
- `apps/web/src/app/api/timelines/[timelineId]/route.js` ↔ `apps/web/src/app/api/timelines/[timelineId]/route.ts`

#### packages/contracts

- `packages/contracts/src/errors.js` ↔ `packages/contracts/src/errors.ts`
- `packages/contracts/src/index.js` ↔ `packages/contracts/src/index.ts`

#### packages/core

- `packages/core/src/calculateBalanceAt.js` ↔ `packages/core/src/calculateBalanceAt.ts`
- `packages/core/src/index.js` ↔ `packages/core/src/index.ts`
- `packages/core/src/types.js` ↔ `packages/core/src/types.ts`

#### packages/db

- `packages/db/src/client.js` ↔ `packages/db/src/client.ts`
- `packages/db/src/index.js` ↔ `packages/db/src/index.ts`

#### packages/testing

- `packages/testing/src/index.js` ↔ `packages/testing/src/index.ts`

#### packages/canvas

- `packages/canvas/src/index.js` ↔ `packages/canvas/src/index.ts`
- `packages/canvas/src/playlist-core/demo.js` ↔ `packages/canvas/src/playlist-core/demo.ts`
- `packages/canvas/src/playlist-core/geometry.js` ↔ `packages/canvas/src/playlist-core/geometry.ts`
- `packages/canvas/src/playlist-core/index.js` ↔ `packages/canvas/src/playlist-core/index.ts`
- `packages/canvas/src/playlist-core/presentation.js` ↔ `packages/canvas/src/playlist-core/presentation.ts`
- `packages/canvas/src/playlist-core/state-utils.js` ↔ `packages/canvas/src/playlist-core/state-utils.ts`
- `packages/canvas/src/playlist-core/state-track-helpers.js` ↔ `packages/canvas/src/playlist-core/state-track-helpers.ts`
- `packages/canvas/src/playlist-core/state.js` ↔ `packages/canvas/src/playlist-core/state.ts`
- `packages/canvas/src/playlist-core/types.js` ↔ `packages/canvas/src/playlist-core/types.ts`
- `packages/canvas/src/playlist-interaction/controller.js` ↔ `packages/canvas/src/playlist-interaction/controller.ts`
- `packages/canvas/src/playlist-interaction/index.js` ↔ `packages/canvas/src/playlist-interaction/index.ts`
- `packages/canvas/src/playlist-renderer-pixi/index.js` ↔ `packages/canvas/src/playlist-renderer-pixi/index.ts`
- `packages/canvas/src/playlist-renderer-pixi/renderer.js` ↔ `packages/canvas/src/playlist-renderer-pixi/renderer.ts`
- `packages/canvas/src/playlist-renderer-pixi/renderer-impl.js` ↔ `packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts`

## Evidence

- `apps/web/next.config.ts` sets `pageExtensions: ["ts", "tsx"]`, so `.js` App Router files are not page entrypoints.
- `vitest.config.ts` includes `packages/**/tests/**`, which is why `.spec.js` files run alongside `.spec.ts`.
- `packages/canvas/src/playlist-interaction/controller.ts` imports `./hit-test.js` explicitly, so that mirror is currently required.
- Next build artifacts resolve `apps/web/src/app/page.tsx`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/error.tsx`, `apps/web/src/app/global-error.tsx`, and `apps/web/src/app/api/*/route.ts` instead of their `.js` siblings.
- The build also resolves `apps/web/src/instrumentation-client.js` and the TypeScript instrumentation hooks, showing that the runtime graph is mixed rather than purely dead or purely live.
- The unit suite ran successfully and discovered both `.spec.ts` and `.spec.js` files, so the test mirrors are live today.

## Root Cause

- The repository keeps checked-in `.js` mirrors from earlier migration stages instead of generating them in a build step.
- There is no workspace-wide output pipeline that writes these files into `src/`, so they are hand-maintained legacy copies.
- Vitest discovers the test mirrors because the default include glob is broad enough to pick up `packages/**/tests/**`.
- One explicit `.js` import in Canvas kept a single mirror alive even after the rest of the package switched to TypeScript.

## Runtime Impact

- Safe to remove after verification: the stale mirrors under `apps/web/src`, `packages/contracts/src`, `packages/core/src`, `packages/db/src`, `packages/testing/src`, and most of `packages/canvas/src`.
- Must rewrite before removal: `packages/canvas/src/playlist-interaction/hit-test.js`, because `controller.ts` imports it directly.
- Must reconfigure tests before removal: the `.spec.js` files in `packages/contracts/tests`, `packages/core/tests`, and `packages/testing/tests`, because Vitest currently runs them.
- Needs a quick consumer check before removal: `apps/web/tests/playwright.js`, because it is documented as a shared fixture but no current repo-local consumer was found.

## Consolidation Plan

1. Delete the stale application and package mirrors first: `apps/web/instrumentation.js`, `apps/web/src/instrumentation.js`, the `apps/web/src/app/**` page and route mirrors, `apps/web/src/components/PlaylistShell.js`, `apps/web/src/lib/*.js`, `apps/web/src/server/services/timelines.js`, `apps/web/src/store/editorStore.js`, and the stale `packages/contracts`, `packages/core`, `packages/db`, `packages/testing`, and `packages/canvas` source mirrors.
2. Rewrite `packages/canvas/src/playlist-interaction/controller.ts` to import `./hit-test` from TypeScript, then delete `packages/canvas/src/playlist-interaction/hit-test.js`.
3. Remove the `.spec.js` files under `packages/contracts/tests`, `packages/core/tests`, and `packages/testing/tests` after narrowing Vitest discovery to `.spec.ts` / `.spec.tsx` only.
4. Decide whether `apps/web/tests/playwright.js` has any real consumer. If not, delete it with the rest of the stale test mirrors.
5. Re-run `pnpm -w run check:arch`, `pnpm -w run typecheck`, `pnpm -w run test:unit`, and `pnpm --filter apps-web build` after each phase so the deletion plan stays safe.

## Guardrails

- Add a CI or pre-commit check that rejects new tracked `.js` files when a same-basename `.ts` / `.tsx` sibling exists, with a short allowlist for deliberate compatibility shims.
- Keep Canvas imports extensionless in TypeScript unless a runtime compatibility boundary truly needs `.js`.
- Narrow Vitest discovery so `*.spec.js` does not re-enter the suite once the mirrors are removed.
- Treat `apps/web/src` and `packages/*/src` as TypeScript-only source trees unless a file is explicitly approved as an exception.
