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

## Actualizacion 2026-04-07 - Bloque 4 Canvas

- `packages/canvas/src/adapters/store-subscriber.ts` expone `createBalanceStoreSubscriber()` y `BalanceChangeCallback`, conecta `calculateBalanceAt()` con snapshots de Zustand y limpia la suscripcion en `destroy()`.
- `packages/canvas/package.json` ahora declara `@slicex/core` como dependencia de workspace para resolver el import runtime desde canvas.
- `packages/canvas/tests/balance-calculation.spec.ts` cubre los 3 escenarios pedidos: balance inicial antes de objetos, aumento tras ingreso y disminucion tras egreso.
- `packages/canvas/src/index.ts` reexporta el subscriber y su tipo publico.
- `apps/web/src/components/BalanceSummary.tsx` consume el subscriber desde React y `CanvasShell` lo muestra sobre el canvas.
- `apps/web/tests/balance-summary.unit.spec.tsx` verifica que el balance cambia al mover el playhead y que el unsubscribe se ejecuta al desmontar.
- `apps/web/src/store/editorStore.ts` sigue siendo compatible con `TimelineDocument` de `@slicex/core`; solo se actualizo el import de Zustand a la API con nombre.
- `vitest.config.ts` y `vitest.setup.ts` incluyen el unit test de apps/web y preparan el entorno jsdom para el wiring de React.
- Gates validados en esta fase: `node scripts/check-imports.mjs` ✅, `pnpm test:unit -- --run` ✅, `pnpm typecheck` ✅.
- Pendiente: confirmacion explicita del usuario antes de avanzar a BLOQUE 5.

## Actualizacion 2026-04-07 - Bloque 5 Canvas / UI

- `packages/canvas/src/renderer.ts` y `packages/canvas/src/renderer.js` ahora usan `autoDetectRenderer()` con un stage wrapper propio y evitan el path de `Application.view`.
- `packages/canvas/src/scene/RulerLayer.ts/js` y `TrackLayer.ts/js` ya no construyen `Text` de Pixi; la escena queda en modo grafico puro para evitar el crash de texto en navegador.
- El parser pass sobre los mirrors JS sigue limpio y `pnpm test:unit -- --run` pasa completo con 17 archivos y 41 tests aprobados.
- El siguiente paso es revalidar en navegador con el servidor limpio y, si se mantiene estable, retirar la instrumentacion temporal restante si apareciera algun ruido nuevo.

## Actualizacion 2026-04-07 - Limpieza visual / React

- `apps/web/src/app/layout.tsx` ya no define `<head>` manual; la metadata vive en `metadata` y el body usa `IBM Plex Sans` via `next/font/google`.
- `apps/web/src/app/page.tsx`, `apps/web/src/components/BalanceSummary.tsx` y `apps/web/src/components/CanvasShell.tsx` pasaron de estilos inline sueltos a una composicion con rail lateral, metric chips y overlay de carga/error.
- `apps/web/src/lib/storeAdapter.ts` ahora cachea snapshots por identidad de estado para evitar devolver objetos nuevos en cada lectura.
- `apps/web/src/lib/useStoreSnapshot.ts` usa una suscripcion simple con `useEffect` + `useState`; `useSyncExternalStore` generaba un loop con snapshots no estables.
- Para validar el bundle real, se limpio `apps/web/.next` y se re-lanzo `pnpm dev:web` antes de revisar los logs.

## Actualizacion 2026-04-12 - Canon frontend

- Se definio un canon visual nuevo en [docs/frontend-canon.md](docs/frontend-canon.md): shell full-bleed, sin cards/sombras, separacion por lineas y padding minimo.
- `apps/web/src/app/globals.css` ahora usa variables de tema para light/dark automatico y elimina los patrones de card del editor.
- El canvas ya dibuja rejilla de pistas aunque el timeline este vacio, para evitar el panel plano y dar escala visual desde el arranque.

## Actualizacion 2026-04-12 - Observabilidad e2e

- `apps/web/tests/playwright.ts` agrega un fixture compartido que captura `console.error`, `pageerror`, `requestfailed` y respuestas `5xx`.
- Playwright ahora guarda screenshot y video solo cuando falla un test, para facilitar triage sin ensuciar corridas felices.

## Actualizacion 2026-04-12 - Verificacion timeline

- La barra slice/playhead ya cruza el canvas completo en estado `ready` y se renderiza como linea vertical de 1px con cap superior.
- Para capturas visuales confiables, esperar `.canvas-shell[data-state="ready"]` antes de tomar screenshot; el estado de carga puede ocultar la linea aunque el renderer este funcionando.
