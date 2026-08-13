# SliceX — Notas para Claude

Lee esto antes de tocar el repo. Para comportamiento del producto ver [docs/product-spec.md](docs/product-spec.md) (fuente de verdad del producto). Para arquitectura del repo ver [docs/project-canon.md](docs/project-canon.md). Para ownership y reglas de capa ver [AGENTS.md](AGENTS.md).

## Qué es el producto

Gestor financiero avanzado tipo **Excel-DAW**: timeline infinito con tracks y objetos financieros estirables (ingresos, egresos, deudas con tarjetas/MSI), múltiples timelines clonables para simular escenarios. Expectativa de UX: *Figma Experience pero mejor*. Detalles de mecánicas en [docs/product-spec.md](docs/product-spec.md).

Target multi-plataforma: web → Android → iOS. Por eso la **separación motor gráfico / motor lógico no es estilo, es requisito**. `@slicex/core` debe poder portarse sin React ni Pixi.

## Estado real hoy (master, verificado 2026-08-13)

- Foco actual: **motor de interacción del playlist tipo FL Studio** en `@slicex/canvas/playlist-*`. Fases 1–8 (F1–F12) cerradas; **el producto financiero sigue sin conectar**.
- Las 8 herramientas de la toolbar (`select`, `draw`, `paint`, `delete`, `mute`, `slip`, `slice`, `zoom`) tienen implementación viva en [playlist-interaction/tools/](packages/canvas/src/playlist-interaction/tools/). Ninguna es stub.
- La UI principal monta el playlist con datos demo en memoria ([PlaylistShell.tsx](apps/web/src/components/PlaylistShell.tsx) → `createDemoPlaylistState()`) más un panel [PlaylistInspector.tsx](apps/web/src/components/PlaylistInspector.tsx). No hay flujo financiero conectado todavía.
- La rama financiera (`@slicex/core`, `@slicex/contracts`, `@slicex/db`, ruta `/api/timelines/[timelineId]`, `editorStore.ts`) está **dormida pero viva** — es scaffolding para la fase 2, no deuda muerta. **No proponer borrarla sin confirmación explícita.**
- Suite actual: **314 tests unitarios en 30 archivos**, todos verdes. Playwright tiene **1 spec** ([reload-stress.pw.ts](apps/web/tests/reload-stress.pw.ts)), no cero.
- `master` es la **única branch** del repo (local y remota) desde 2026-08-13.

## Stack

| Capa | Tech |
|---|---|
| Monorepo | pnpm 9 (lockfile v9, sin campo `packageManager`) + workspaces + Turbo |
| App | Vite 6 + React 19 + TypeScript 5 (SPA) |
| Worker / API | Hono 4 sobre Cloudflare Workers, vía `@cloudflare/vite-plugin` |
| Renderer | Pixi.js 8 |
| Estado | Zustand 4 (store actual `editorStore.ts` está dormido — modelo financial, no playlist) |
| Persistencia | Prisma 7 + `@prisma/adapter-pg` sobre Cloudflare Hyperdrive (Postgres) |
| Validación | Zod en `@slicex/contracts` |
| Observabilidad | `@sentry/cloudflare` (Worker) + `@sentry/react` (browser) + JSON `console` → Workers Logpush |
| Tests | Vitest (314 unit) + Playwright (1 spec: `apps/web/tests/*.pw.ts`) |
| Deploy | `wrangler deploy` o Workers Builds (push a `master` → build+deploy) |

## Mapa rápido

- [apps/web/index.html](apps/web/index.html) + [apps/web/src/main.tsx](apps/web/src/main.tsx) — entrada Vite/React.
- [apps/web/src/App.tsx](apps/web/src/App.tsx) — root React, monta `<PlaylistShell />`.
- [apps/web/src/components/PlaylistShell.tsx](apps/web/src/components/PlaylistShell.tsx) — superficie React principal (canvas Pixi); monta también `PlaylistInspector` y `ErrorBoundary`.
- [apps/web/worker/index.ts](apps/web/worker/index.ts) — Worker entry (Hono + Sentry).
- [apps/web/worker/routes/](apps/web/worker/routes/) — `health.ts`, `timelines.ts`.
- [wrangler.jsonc](wrangler.jsonc) — **en la raíz, no en `apps/web/`**: config Worker + assets + Hyperdrive binding. `vite.config.ts` lo referencia como `../../wrangler.jsonc`.
- [apps/web/vite.config.ts](apps/web/vite.config.ts) — Vite + plugin React + plugin Cloudflare. Dev server en **puerto 4321** con `strictPort: false`.
- [packages/canvas/src/playlist-core/](packages/canvas/src/playlist-core/) — modelo, geometría, estado, presentación, demo data.
- [packages/canvas/src/playlist-interaction/controller.ts](packages/canvas/src/playlist-interaction/controller.ts) — dispatcher de 17 gestos: pan, zoom, drag, resize, marquee, automation, scrollbars, slip, slice, paint, delete, mute, markers, track resize/reorder.
- [packages/canvas/src/playlist-interaction/tools/](packages/canvas/src/playlist-interaction/tools/) — una implementación por herramienta de toolbar, vía `registry.ts`.
- [packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts](packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts) — renderer Pixi por capas.
- [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma) — schema multi-tenant con `Timeline`/`TimelineRevision` para persistencia futura.

## Reglas que se aplican aquí

- **Performance es regla dura, no aspiración.** Antes de escribir cualquier código que toque `playlist-core` (reducer), `playlist-interaction` (controller), `playlist-renderer-pixi` (renderer) o el shell React: leer [docs/performance-canon.md](docs/performance-canon.md) y aplicar el patrón obligatorio. El gate `check:arch` ejecuta [scripts/check-perf-patterns.mjs](scripts/check-perf-patterns.mjs) (lint estático de anti-patrones); los budgets viven en [packages/canvas/tests/perf-budget.spec.ts](packages/canvas/tests/perf-budget.spec.ts). Si el patrón cómodo contradice una regla, **buscar el patrón correcto, no relajar la regla**. Ninguna tolerancia se toca para hacer pasar tests — un budget que falla es síntoma correcto de un bug real.
- **Sin deep imports** entre paquetes. Solo `@slicex/<pkg>` (no `@slicex/<pkg>/src/...`). Lo enforce [scripts/check-imports.mjs](scripts/check-imports.mjs).
- **Sin mirrors `.js` junto a `.ts`/`.tsx`** en `src/` ni en tests. Lo enforce [scripts/check-js-siblings.mjs](scripts/check-js-siblings.mjs).
- **`@slicex/core` no hace IO**. La lógica financiera vive ahí, sin React/Pixi/Prisma.
- **Prisma solo en `@slicex/db`**. No instanciar `PrismaClient` en otra capa.
- **Branch base: `master`** (no `main`, aunque algún doc viejo lo diga).

## Comandos

```powershell
pnpm install
pnpm dev                  # turbo dev de todos los paquetes
pnpm dev:web              # apps/web (Vite + Worker CF local) → http://localhost:4321

pnpm -w run build:web     # build SPA + Worker (vite build)
pnpm -w run preview:web   # preview local del build con runtime CF
pnpm -w run deploy:web    # wrangler deploy (usa el wrangler.jsonc de la raíz)

pnpm -w run check:arch    # check-imports + check-js-siblings + check-perf-patterns
pnpm -w run typecheck     # tsc raíz + tsc client + tsc worker
pnpm -w run test:unit     # vitest (pasar -- --run para no entrar en watch)
pnpm exec vitest run      # forma directa, equivalente
pnpm -w run test:e2e      # playwright (levanta el dev server si no hay uno)
pnpm -w run check:env     # crea/valida .env.local
pnpm -w run check:fast    # check:arch + check:env (gate pre-commit)

pnpm -w --filter @slicex/db prisma generate
pnpm -w --filter @slicex/db prisma migrate dev

# Cloudflare — desde la raíz, que es donde vive wrangler.jsonc:
pnpm -w exec wrangler hyperdrive create slicex-pg \
  --connection-string="postgresql://..."
pnpm -w exec wrangler secret put SENTRY_DSN
pnpm -w exec wrangler deploy
```

## Deploy de un dedo

1. Connect repo en Cloudflare Workers Builds (dashboard → Workers → connect Git).
2. Build command: `pnpm -w run build:web`. Output: `apps/web/dist/`.
3. Cada push a `master` (o branch que conectes) hace build + deploy automático. PRs reciben preview URLs.
4. Bindings/secrets vivos en wrangler.jsonc o dashboard (Hyperdrive id, SENTRY_DSN, etc).

## Cómo trabajar conmigo

- **Antes de borrar algo del scaffolding financiero** (`@slicex/core`, `@slicex/contracts`, `@slicex/db`, `editorStore.ts`, ruta Hono `/api/timelines/:timelineId`): preguntar.
- **Antes de tocar `master`**: confirmar. Trabajar en branch.
- **Gates obligatorios** antes de reportar trabajo terminado: `check:arch`, `typecheck`, `vitest run`. Tres en verde, no dos.
- **Dev server en el navegador**: para cambios de UI/canvas, levantar `pnpm dev:web` y verificar en el browser, no solo confiar en typecheck. Ojo: `strictPort: false` hace que Vite se pase al 4322 en silencio si el 4321 está ocupado, mientras Playwright sigue apuntando fijo al 4321 — revisar a qué puerto arrancó de verdad.
- **Notas de fixes y auditorías** en `docs/` llevan banner `> **Histórico**` cuando describen un estado ya superado (ver [docs/README.md](docs/README.md)). No asumir que reflejan el estado actual.

## Lo que ya se limpió (referencia)

- Fase A (commit `b0b48c0`) podó cruft, middleware roto (`proxy.ts`), duplicados de Sentry/Playwright, directorios vacíos, `pixi-viewport` sin uso.
- Fase Cloudflare (branch `feature/cloudflare-migration`, ya borrada): se eliminó Next.js y se sustituyó por Vite + Hono sobre Cloudflare Workers. La composición React, estilos y la ruta `timelines` se preservaron 1:1; sólo cambió el frame que las hospeda.
- Dedup JS (2026-04-19): se borraron los mirrors `.js` junto a `.ts`/`.tsx`; hoy lo bloquea `check-js-siblings`. Ver [docs/js-dedup-report.md](docs/js-dedup-report.md).
- Limpieza de branches (2026-08-13): se mergeó `feat/playlist-slip-slice-finish` a `master` y se borraron `feature/cloudflare-migration`, `fix/cloudflare-deploy` y `update_worker_name_to_slicex`. Esta última llevaba un commit no mergeado del bot de Cloudflare que renombraba el Worker de `slicex-web` a `slicex`; se descartó a propósito — el Worker sigue llamándose `slicex-web`.
