# SliceX — Notas para Claude

Lee esto antes de tocar el repo. Para comportamiento del producto ver [docs/product-spec.md](docs/product-spec.md) (fuente de verdad del producto). Para arquitectura del repo ver [docs/project-canon.md](docs/project-canon.md). Para ownership y reglas de capa ver [AGENTS.md](AGENTS.md).

## Qué es el producto

Gestor financiero avanzado tipo **Excel-DAW**: timeline infinito con tracks y objetos financieros estirables (ingresos, egresos, deudas con tarjetas/MSI), múltiples timelines clonables para simular escenarios. Expectativa de UX: *Figma Experience pero mejor*. Detalles de mecánicas en [docs/product-spec.md](docs/product-spec.md).

Target multi-plataforma: web → Android → iOS. Por eso la **separación motor gráfico / motor lógico no es estilo, es requisito**. `@slicex/core` debe poder portarse sin React ni Pixi.

## Estado real hoy (master)

- Foco actual: **motor de interacción del playlist tipo FL Studio** en `@slicex/canvas/playlist-*`. **No está terminado**.
- La UI principal monta el playlist con datos demo en memoria ([PlaylistShell.tsx](apps/web/src/components/PlaylistShell.tsx) → `createDemoPlaylistState()`). No hay flujo financiero conectado todavía.
- La rama financiera (`@slicex/core`, `@slicex/contracts`, `@slicex/db`, ruta `/api/timelines/[timelineId]`, `editorStore.ts`) está **dormida pero viva** — es scaffolding para la fase 2, no deuda muerta. **No proponer borrarla sin confirmación explícita.**

## Stack

| Capa | Tech |
|---|---|
| Monorepo | pnpm 10 + workspaces + Turbo |
| App | Next.js 16 (App Router) + React 19 + TypeScript 5 |
| Renderer | Pixi.js 8 |
| Estado | Zustand 4 (store actual `editorStore.ts` está dormido — modelo financial, no playlist) |
| Persistencia | Prisma 7 + `@prisma/adapter-pg` (Postgres) |
| Validación | Zod en `@slicex/contracts` |
| Logging | `pino` + `@sentry/nextjs` |
| Tests | Vitest (unit) + Playwright (config presente, **0 specs** hoy) |

## Mapa rápido

- [apps/web/src/components/PlaylistShell.tsx](apps/web/src/components/PlaylistShell.tsx) — única superficie React activa.
- [packages/canvas/src/playlist-core/](packages/canvas/src/playlist-core/) — modelo, geometría, estado, demo data.
- [packages/canvas/src/playlist-interaction/controller.ts](packages/canvas/src/playlist-interaction/controller.ts) — pan, zoom, drag, resize, marquee, automation, scrollbars (~780 líneas).
- [packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts](packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts) — renderer Pixi por capas (~720 líneas).
- [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma) — schema multi-tenant con `Timeline`/`TimelineRevision` para persistencia futura.

## Reglas que se aplican aquí

- **Sin deep imports** entre paquetes. Solo `@slicex/<pkg>` (no `@slicex/<pkg>/src/...`). Lo enforce [scripts/check-imports.mjs](scripts/check-imports.mjs).
- **Sin mirrors `.js` junto a `.ts`/`.tsx`** en `src/` ni en tests. Lo enforce [scripts/check-js-siblings.mjs](scripts/check-js-siblings.mjs).
- **`@slicex/core` no hace IO**. La lógica financiera vive ahí, sin React/Pixi/Prisma.
- **Prisma solo en `@slicex/db`**. No instanciar `PrismaClient` en otra capa.
- **Branch base: `master`** (no `main`, aunque algún doc viejo lo diga).

## Comandos

```powershell
pnpm install
pnpm dev                  # turbo dev de todos los paquetes
pnpm dev:web              # solo apps/web

pnpm -w run check:arch    # check-imports + check-js-siblings
pnpm -w run typecheck     # tsc -b --noEmit
pnpm -w run test:unit     # vitest (pasar -- --run para no entrar en watch)
pnpm exec vitest run      # forma directa, equivalente
pnpm -w run check:env     # crea/valida .env.local
pnpm -w run check:fast    # check:arch + check:env (gate pre-commit)

pnpm -w --filter @slicex/db prisma generate
pnpm -w --filter @slicex/db prisma migrate dev
```

## Cómo trabajar conmigo

- **Antes de borrar algo del scaffolding financiero** (`@slicex/core`, `@slicex/contracts`, `@slicex/db`, `editorStore.ts`, ruta `/api/timelines/[timelineId]`): preguntar.
- **Antes de tocar `master`**: confirmar. Trabajar en branch.
- **Gates obligatorios** antes de reportar trabajo terminado: `check:arch`, `typecheck`, `vitest run`. Tres en verde, no dos.
- **Dev server en el navegador**: para cambios de UI/canvas, levantar `pnpm dev:web` y verificar en el browser, no solo confiar en typecheck.
- **Notas de fixes** en `docs/` (ej. `header-occlusion-fix.md`, `timeline-grid-bleed-fix.md`) son históricas; no asumir que reflejan estado actual sin verificar.

## Lo que ya se limpió (referencia)

Fase A (commit `b0b48c0`) podó cruft, middleware roto (`proxy.ts`), duplicados de Sentry/Playwright, directorios vacíos, `pixi-viewport` sin uso. Ver el diff si necesitas contexto histórico.
