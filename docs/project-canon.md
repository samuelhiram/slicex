# SliceX — canon básico del proyecto

> Estado sintetizado del repo inspeccionado en `master`. **Última verificación: 2026-08-13**
> (rutas, comandos y suite de tests comprobados contra el código, no sólo leídos).
> Este archivo sirve como referencia canónica corta para entender qué es SliceX hoy, cómo está organizado y qué partes del repo describen el estado real.
> **Para el comportamiento del producto** (modelo de timeline, objetos financieros, mecánicas de tarjeta/MSI, etc.) ver [product-spec.md](product-spec.md) — ese es el documento primigenio del producto, no este.

## 1. Qué es SliceX hoy

SliceX es un monorepo con `pnpm` + workspaces + `turbo` para una app web (SPA Vite + React + Hono Worker desplegada en Cloudflare Workers) y paquetes compartidos. En el estado actual del código, la superficie principal visible no es un editor financiero genérico sino un **Playlist tipo FL Studio** montado en `apps/web` y renderizado con Pixi desde `@slicex/canvas`.

## 2. Estado real actual

### Lo que sí está implementado en el código

- `apps/web/src/App.tsx` monta directamente `PlaylistShell` (no hay router; la entrada es
  `index.html` → `src/main.tsx` → `<App />`).
- `PlaylistShell` crea un estado demo, inicializa el core, la interacción y el renderer del playlist,
  y monta además `PlaylistInspector` y `ErrorBoundary`.
- `@slicex/canvas` exporta tres capas claras:
  - `playlist-core`
  - `playlist-interaction`
  - `playlist-renderer-pixi`
- El playlist actual soporta, a nivel de código:
  - tracks y clips de tipo `audio`, `pattern` y `automation`
  - play position marker / playhead + transporte con `Space`
  - drag de clips, resize izquierdo y derecho, stretch mode (Shift+M)
  - marquee selection, grupos, clipboard (copy/paste) e historial undo/redo
  - edición de automation points
  - zoom horizontal con wheel + ctrl/meta, pan con mouse medio
  - scrollbars horizontal y vertical
  - context menu en track headers y en clips
  - tracks virtuales al navegar hacia abajo y timeline virtual/infinito a la derecha
  - markers de timeline (labels, loop bounds, recording fences)
  - toolbar completa de 8 herramientas — `select`, `draw`, `paint`, `delete`, `mute`, `slip`,
    `slice`, `zoom` — con hotkeys `E/P/B/D/T/S/C/Z`, todas implementadas en
    `playlist-interaction/tools/`
  - overlays de drag: ghost preview, snap indicator y tooltip B.B.T
  - gestos touch: pinch zoom, long-press e inercia

### Lo que no está conectado todavía como flujo final de producto

- La pantalla principal usa `createDemoPlaylistState()`; el playlist visible actual es **demo/in-memory**.
- La persistencia Prisma existe, pero el playlist actual no aparece cableado aquí a lectura/escritura real de timelines desde la UI principal.
- La documentación raíz todavía mezcla una narrativa de "editor financiero" con el código actual del playlist.

## 3. Arquitectura vigente del repo

### App

- `apps/web`
  - SPA Vite + React 19 (cliente) + Hono Worker (API) corriendo como **un solo Cloudflare Worker** vía `@cloudflare/vite-plugin`.
  - Entrada cliente: `index.html` → `src/main.tsx` → `<App />` → `<PlaylistShell />`.
  - Entrada Worker: `worker/index.ts` (Hono + Sentry CF) → rutas en `worker/routes/`.
  - Static Assets binding sirve la SPA con `not_found_handling: "single-page-application"` y `run_worker_first: ["/api/*"]` deriva el API al Worker.
  - Monta el playlist full-screen.

### Paquetes

- `@slicex/core`
  - Dominio y lógica pura.
  - En la documentación raíz aparece como capa de negocio principal.
- `@slicex/canvas`
  - Motor del playlist actual.
  - Contiene modelo, geometría, interacción y renderer Pixi.
- `@slicex/contracts`
  - DTOs, validaciones y contratos compartidos.
- `@slicex/db`
  - Prisma schema y cliente de base de datos.
  - Modela `User`, `Tenant`, `TenantMembership`, `Timeline`, `TimelineRevision` y `AuditLog`.

## 4. Superficie principal para entender el proyecto

### Entrada web (cliente)

- `apps/web/index.html`
- `apps/web/src/main.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/components/PlaylistShell.tsx`
- `apps/web/src/styles/globals.css`

### Entrada web (Worker / API)

- `apps/web/worker/index.ts`
- `apps/web/worker/routes/health.ts`
- `apps/web/worker/routes/timelines.ts`
- `wrangler.jsonc` — **en la raíz del repo**, no en `apps/web/`. `vite.config.ts` lo referencia como
  `../../wrangler.jsonc` y `wrangler deploy` se corre desde la raíz.
- `apps/web/vite.config.ts` — dev server en puerto **4321**, `strictPort: false`.

### Playlist core

- `packages/canvas/src/index.ts`
- `packages/canvas/src/playlist-core/index.ts`
- `packages/canvas/src/playlist-core/types.ts`
- `packages/canvas/src/playlist-core/geometry.ts`
- `packages/canvas/src/playlist-core/state.ts`
- `packages/canvas/src/playlist-core/presentation.ts`
- `packages/canvas/src/playlist-core/demo.ts`

### Interacción

- `packages/canvas/src/playlist-interaction/controller.ts`
- `packages/canvas/src/playlist-interaction/hit-test.ts`

### Renderer

- `packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts`

### Infraestructura / governance

- `package.json`
- `apps/web/package.json`
- `packages/canvas/package.json`
- `packages/core/package.json`
- `packages/contracts/package.json`
- `packages/db/package.json`
- `packages/db/prisma/schema.prisma`
- `vitest.config.ts`
- `.github/workflows/ci.yml`
- `scripts/check-imports.mjs`
- `scripts/check-js-siblings.mjs`

## 5. Cómo está modelado el playlist

### Estado

El estado del playlist vive en `PlaylistState` (`playlist-core/types.ts`) y contiene:

- `tracks`, `clips`
- `viewport`, `snap`
- `selection`, `marquee`, `hover`, `contextMenu`
- `playPosition`, `transport`
- `tool`, `clipboard`, `stretchMode`
- `markers`
- `dragPreview`, `snapHint`, `tooltip` — overlays efímeros de gesto, se limpian en el release

### Reglas importantes del modelo

- El playhead vive como `playPosition.time`.
- La posición en pantalla se deriva desde tiempo + viewport.
- El viewport guarda `scrollX`, `scrollY`, `pxPerBeat`, `width`, `height`.
- El renderer consume una presentación derivada; no guarda la verdad del modelo.
- La capa `presentation.ts` prepara vistas calculadas para tracks, clips, ruler, scrollbars, context menu, marquee y play position.

## 6. Interacción implementada

La interacción del playlist está centralizada en `playlist-interaction/controller.ts`.

### Gestos soportados en el código

Los 17 `kind` de `playlist-interaction/gesture-types.ts`:

- `pan`, `marquee`
- `clip-drag`, `clip-resize`, `clip-create-drag`
- `automation-point-drag`
- `play-position-drag`
- `scrollbar-horizontal`, `scrollbar-vertical`
- `slip-drag`, `slice-drag`
- `paint-drag`, `delete-drag`, `mute-drag`
- `track-resize`, `track-reorder`
- `marker-drag`

### Acciones por contexto

- click en ruler mueve play position
- arrastrar play position lo reposiciona
- right click en track header abre context menu
- right click en automation body agrega automation point
- right click en automation point lo elimina
- `Delete` / `Backspace` elimina selección
- `Space` alterna reproducción del playhead

## 7. Renderer actual

El renderer actual está en `playlist-renderer-pixi/renderer-impl.ts` y usa:

- `Application`
- `Container`
- `Graphics`
- `Text`

La composición está separada en capas de dibujo:

- fondo/scene
- timeline con `mask`
- chrome del ruler y track headers
- foreground para scrollbars y context menu

Esto confirma que el proyecto actual sí está orientado a un playlist canvas interactivo, no a un layout React estático.

## 8. Persistencia y backend

`@slicex/db` ya define una base de persistencia multi-tenant con revisiones de timeline:

- `Timeline`
- `TimelineRevision.documentJson`
- `headRevisionId`
- `AuditLog`

Eso indica que la intención arquitectónica de persistir documentos/versiones sigue viva, aunque la UI principal del playlist inspeccionada en esta pasada todavía corre con demo data.

## 9. Comandos y gates relevantes

### Desarrollo

- `pnpm dev`
- `pnpm dev:web`

### Calidad

- `pnpm -w run typecheck`
- `pnpm -w run test:unit`
- `pnpm -w run test:e2e`
- `pnpm -w run check:arch`
- `pnpm -w run check:env`
- `pnpm -w run check:fast`

### Reglas automáticas existentes

- `scripts/check-imports.mjs`
  - bloquea deep imports entre paquetes `@slicex/*`
- `scripts/check-js-siblings.mjs`
  - bloquea mirrors `.js/.jsx` junto a `.ts/.tsx`

## 10. Documentos del repo y cómo leerlos

Índice completo con estado por documento: [docs/README.md](README.md).

### Documentos útiles y vigentes

- `docs/product-spec.md`
  - **fuente de verdad del producto** (modelo, mecánicas financieras, MSI)
- `docs/performance-canon.md`
  - **regla dura** para todo código en `playlist-*` y el shell React
- `docs/fl-playlist-parity-spec.md`
  - contrato de paridad con FL Studio, gesto por gesto
- `docs/playlist-manual-test.md`
  - guion de prueba manual del playlist
- `README.md`
  - quickstart y mapa general del monorepo
- `AGENTS.md`
  - ownership, workflow y reglas de colaboración
- `CONTRIBUTING.md`
  - pre-PR checklist y convenciones
- `docs/frontend-canon.md`
  - canon visual/layout del frontend
- `CONTEXT.md`
  - resumen operativo **+ historial acumulado**; la mitad de abajo es archivo de la era Next.js

### Cómo deben interpretarse

- `README.md` y `AGENTS.md` siguen siendo útiles como marco.
- `CONTEXT.md` **no debe leerse como una foto exacta única del estado actual**; contiene historial acumulado de fases, bloques y cambios previos.
- Este archivo (`docs/project-canon.md`) debe ser la referencia corta para responder: **qué es el repo hoy y dónde tocar primero**.

## 11. Inconsistencias reales encontradas

Estas inconsistencias existen en el repo y conviene conocerlas (revisadas 2026-08-13):

1. **Narrativa mixta del producto** — *vigente, es intencional.*
   - La documentación de producto describe un gestor financiero; el código visible monta un playlist
     estilo FL Studio. No es contradicción: el playlist es el motor de interacción que después
     hospedará los objetos financieros. Ver `product-spec.md`.

2. **`CONTEXT.md` mezcla historia y estado** — *acotado.*
   - El historial quedó agrupado bajo "Historial acumulado (archivo)" con banner explícito. La
     cabecera sí describe el estado real.

3. **Rama objetivo `main` vs `master`** — *resuelto.*
   - `CONTRIBUTING.md` ya apunta a `master`, igual que CI y `AGENTS.md`. `master` es además la
     **única branch** del repo desde 2026-08-13.

4. **`docs/adr/` tiene numeración solapada** — *documentado, sin resolver.*
   - Conviven dos series de ADR con los mismos números (0001–0004). Ver [adr/README.md](adr/README.md).

5. **`scripts/e2e-static-server.js` está roto** — *sin resolver.*
   - Apunta a `apps/web/public/index.html` y a `playwright.local.config.ts`; ninguno existe. El
     script `test:e2e:static` no corre. El camino vivo es `test:e2e`.

6. **CI declara pasos que no se han verificado verdes en esta pasada.**
   - `.github/workflows/ci.yml` corre `corepack enable` *después* de `actions/setup-node` con
     `cache: 'pnpm'`, orden que suele fallar en runners limpios. Sin `gh` CLI local no se pudo
     confirmar el estado real de las corridas.

## 12. Qué tomar como verdad canónica mínima

Para trabajo operativo diario, la verdad mínima debe ser esta:

- La app visible actual es el playlist en `apps/web`.
- El motor principal actual está en `packages/canvas/src/playlist-*`.
- `@slicex/db` y los modelos Prisma representan la base de persistencia/versionado.
- `AGENTS.md` define reglas de ownership.
- `docs/frontend-canon.md` define el baseline visual.
- `docs/project-canon.md` define el snapshot corto y canónico del repo.

## 13. Punto de entrada recomendado por tipo de tarea

### Si el cambio es visual o de interacción del playlist

Entrar por:

- `apps/web/src/components/PlaylistShell.tsx`
- `packages/canvas/src/playlist-core/*`
- `packages/canvas/src/playlist-interaction/*`
- `packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts`

### Si el cambio es de persistencia

Entrar por:

- `packages/db/prisma/schema.prisma`
- `@slicex/contracts`
- handlers/rutas de `apps/web`

### Si el cambio es de reglas o arquitectura

Entrar por:

- `AGENTS.md`
- `README.md`
- `CONTRIBUTING.md`
- `scripts/check-imports.mjs`
- `scripts/check-js-siblings.mjs`

## 14. Criterio de mantenimiento de este archivo

Actualizar `docs/project-canon.md` cuando cambie al menos una de estas cosas:

- entrada principal del producto
- paquete/capa principal del motor
- modelo principal del dominio visible
- reglas de ownership
- comandos de validación
- branch/canon de CI
- documento que deba considerarse fuente de verdad

## 15. Alcance de esta auditoría

Este canon fue sintetizado mediante inspección directa del repositorio y sus documentos principales.

Revisión 2026-08-13, verificado ejecutando:

- `pnpm -w run check:arch` — verde (imports, mirrors `.js`, anti-patrones de performance)
- `pnpm -w run typecheck` — verde (raíz + cliente + worker)
- `pnpm exec vitest run` — **314 tests en 30 archivos**, verdes
- `pnpm dev:web` — arranca y sirve `/` y `/api/health` con 200 en el puerto 4321

**No** implica confirmación de que CI esté verde hoy (ver inconsistencia 6).
**No** implica validación de la ruta de deploy a Cloudflare en esta pasada.
