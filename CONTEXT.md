# Resumen ejecutivo

SliceX es un monorepo modular diseñado para arrancar M1 con fronteras claras entre dominio, UI, y persistencia. El objetivo es proporcionar una base técnica reproducible y segura para construir funcionalidades financieras sin deuda arquitectónica.

## Arquitectura y paquetes principales

- `@slicex/core`: lógica de dominio y cálculos financieros (TypeScript puro, sin IO).
- `@slicex/canvas`: motor gráfico basado en Pixi, renderers y adaptadores para el editor.
- `@slicex/contracts`: DTOs, validaciones y el `ErrorEnvelope` usado por rutas y APIs.
- `@slicex/db`: Prisma schema, migraciones y cliente Prisma singleton.
- `apps/web`: Next.js App Router, route handlers, store (Zustand) y componentes UI.

## Modelado de datos (timeline / tenancy)

- Los timelines se representan con metadatos en la tabla `timelines` y snapshots JSON en `timeline_revisions.document_json`.
- `head_revision_id` apunta a la revisión activa. Las revisiones permiten mantener historial y diffs sin bloquear lecturas.

## Convenciones importantes

- No hacer deep-imports (`@slicex/<pkg>/...`) — usar la API pública del paquete.
- Prisma: todas las consultas y migraciones deben estar en `@slicex/db`.
- Separación de responsabilidades: `@slicex/core` no debe realizar IO.

## Flujo de desarrollo local (quickstart)

1. Instala dependencias:

```powershell
pnpm install
```

2. Genera Prisma client (si cambias schema):

```powershell
pnpm -w --filter @slicex/db prisma generate
```

3. Ejecuta el servidor de desarrollo (monorepo):

```powershell
pnpm dev
```

## Comprobaciones y gates locales

- Arquitectura (deep-imports):

```powershell
pnpm -w run check:arch
```

- Entorno local básico (crea `.env.local` si no existe):

```powershell
pnpm -w run check:env
```

- Typecheck y tests:

```powershell
pnpm -w run typecheck
pnpm -w run test:unit
```

## Variables de entorno relevantes

- `NEXT_PUBLIC_APP_URL` — URL pública local para la app (`http://localhost:3000`).
- Otras variables de integración (Sentry, Supabase) están esbozadas en `apps/web/src/lib/supabaseServer.ts` y `apps/web/src/instrumentation-client.ts`.

## Prisma y migraciones

- El schema Prisma está en `packages/db/prisma/schema.prisma`.
- Para desarrollar localmente: crear una base de datos local, ejecutar `pnpm -w --filter @slicex/db prisma migrate dev` y luego `pnpm -w --filter @slicex/db prisma generate`.

## Testing y CI

- Unit tests: Vitest (`pnpm -w run test:unit`).
- E2E: Playwright (`pnpm -w run test:e2e`).
- CI: ver `.github/workflows/ci.yml` — incluye checks de imports, typecheck y tests.

## Dónde mirar para más detalles

- ADRs y decisiones de arquitectura: `docs/adr/`.
- Scripts operativos y utilidades: `scripts/` (ej: `check-imports.mjs`, `sync-env.mjs`).
- Ownership y workflow: [AGENTS.md](AGENTS.md)

## Notas operativas

- Si modificas `@slicex/contracts`, asegúrate de versionar los cambios y coordinar a los equipos consumidores.
- Antes de mergear PRs grandes, ejecutar `pnpm -w run check:fast` para evitar regresiones en ownership y env.

Este archivo es el resumen operativo del repo; mantenerlo breve y actualizado. Para cambios mayores, añadir un ADR en `docs/adr`.

## Actualizacion 2026-04-06

- Paso 0 de Fase 2 completado: se eliminaron `inspect_react.js`, `tmp_fetch.js` y `report.txt` de la raiz.
- Las rutas API de `apps/web` ya propagan `x-request-id` hacia `withRequestId()`.
- `PUT /api/timelines/[timelineId]` ahora valida el body contra `TimelineDocumentSchema`, crea la revision y actualiza `headRevisionId` en la misma transaccion.
- Gate validado: `node scripts/check-imports.mjs`, `pnpm typecheck` y `pnpm test:unit` pasan; Vitest queda en modo watch en esta terminal, pero la suite completa reporto 12 archivos y 26 tests aprobados.

## Actualizacion 2026-04-06 - Bloque 1 Canvas

- `packages/canvas/src/coordinate-system.ts` ya expone `DAY_WIDTH_PX = 80`, `dateToPixel()` y `pixelToDate()` con conversiones inversas en UTC.
- `packages/canvas/src/viewport.ts` ya expone un wrapper de viewport basado en `pixi-viewport@6.0.3`, con drag horizontal, wheel zoom y pinch zoom.
- `packages/canvas/src/index.ts` reexporta el nuevo sistema de coordenadas y el viewport.
- `packages/canvas/tests/coordinate-system.spec.ts` valida que date/pixel son inversas en varios zooms.
- `packages/canvas/tests/viewport.spec.ts` valida la configuracion horizontal del viewport mediante un mock inyectado.
- Audit de TODOs en los archivos nuevos: sin matches.
- Gate de bloque 1 completado: `check-imports` verde, `tsc -b` verde y `vitest` paso con 14 archivos y 30 tests aprobados.

## Actualizacion 2026-04-06 - Bloque 2 Canvas

- `packages/canvas/src/scene/` ya contiene `RulerLayer`, `TrackLayer`, `ObjectLayer` y `PlayheadLayer` con estado de vista compartido para el siguiente paso de wiring.
- El ruler adapta la granularidad de marcas segun zoom y renderiza labels en UTC; tracks pintan filas alternadas; objects se cullen fuera de viewport; playhead dibuja la linea roja vertical.
- `packages/canvas/src/scene/index.ts` y `packages/canvas/src/index.ts` ya exponen la nueva escena sin deep-imports.
- Audit de TODOs en `packages/canvas/src/scene`: sin matches.
- Gate de bloque 2 completado: `node scripts/check-imports.mjs` y `pnpm typecheck` pasan.
- Pendiente de confirmacion del usuario antes de iniciar BLOQUE 3.

## Actualizacion 2026-04-06 - Bloque 3 Canvas

- `packages/canvas/src/renderer.ts` ahora proyecta el snapshot del store en `RulerLayer`, `TrackLayer`, `ObjectLayer` y `PlayheadLayer` mediante `projectCanvasScene()`.
- `packages/canvas/src/types.ts` y `apps/web/src/lib/storeAdapter.ts` ya exponen `CanvasStoreSnapshot` con `getState()` y `subscribeState()` sin romper el adaptador anterior.
- `apps/web/src/app/page.tsx` monta `CanvasShell` directamente dentro del editor root y el shell visual ya no es un placeholder vacio.
- `packages/canvas/tests/renderer.spec.ts` cubre tanto el modo headless como la proyeccion de escena.
- Audit de TODOs en `packages/canvas/src` y `apps/web/src`: sin matches.
- Gate completado: `node scripts/check-imports.mjs`, `pnpm -w run typecheck` y `pnpm -w run test:unit --run` pasan.
- Pendiente de confirmacion del usuario antes de iniciar BLOQUE 4.
