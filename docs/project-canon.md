# SliceX — canon básico del proyecto

> Estado sintetizado del repo inspeccionado en `master`.
> Este archivo sirve como referencia canónica corta para entender qué es SliceX hoy, cómo está organizado y qué partes del repo describen el estado real.
> **Para el comportamiento del producto** (modelo de timeline, objetos financieros, mecánicas de tarjeta/MSI, etc.) ver [product-spec.md](product-spec.md) — ese es el documento primigenio del producto, no este.

## 1. Qué es SliceX hoy

SliceX es un monorepo con `pnpm` + workspaces + `turbo` para una app web en Next.js y paquetes compartidos. En el estado actual del código, la superficie principal visible no es un editor financiero genérico sino un **Playlist tipo FL Studio** montado en `apps/web` y renderizado con Pixi desde `@slicex/canvas`.

## 2. Estado real actual

### Lo que sí está implementado en el código

- `apps/web/src/app/page.tsx` monta directamente `PlaylistShell`.
- `PlaylistShell` crea un estado demo, inicializa el core, la interacción y el renderer del playlist.
- `@slicex/canvas` exporta tres capas claras:
  - `playlist-core`
  - `playlist-interaction`
  - `playlist-renderer-pixi`
- El playlist actual soporta, a nivel de código:
  - tracks y clips de tipo `audio`, `pattern` y `automation`
  - play position marker / playhead
  - drag de clips
  - resize izquierdo y derecho
  - marquee selection
  - edición de automation points
  - zoom horizontal con wheel + ctrl/meta
  - pan con mouse medio
  - scrollbars horizontal y vertical
  - context menu en track headers
  - tracks virtuales al navegar hacia abajo
  - timeline virtual/infinito a la derecha

### Lo que no está conectado todavía como flujo final de producto

- La pantalla principal usa `createDemoPlaylistState()`; el playlist visible actual es **demo/in-memory**.
- La persistencia Prisma existe, pero el playlist actual no aparece cableado aquí a lectura/escritura real de timelines desde la UI principal.
- La documentación raíz todavía mezcla una narrativa de "editor financiero" con el código actual del playlist.

## 3. Arquitectura vigente del repo

### App

- `apps/web`
  - App Router de Next.js.
  - Entrada actual del producto visible.
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

### Entrada web

- `apps/web/src/app/page.tsx`
- `apps/web/src/components/PlaylistShell.tsx`
- `apps/web/src/app/globals.css`

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

El estado del playlist vive en `PlaylistState` y contiene:

- `tracks`
- `clips`
- `viewport`
- `snap`
- `selection`
- `marquee`
- `contextMenu`
- `hover`
- `playPosition`

### Reglas importantes del modelo

- El playhead vive como `playPosition.time`.
- La posición en pantalla se deriva desde tiempo + viewport.
- El viewport guarda `scrollX`, `scrollY`, `pxPerBeat`, `width`, `height`.
- El renderer consume una presentación derivada; no guarda la verdad del modelo.
- La capa `presentation.ts` prepara vistas calculadas para tracks, clips, ruler, scrollbars, context menu, marquee y play position.

## 6. Interacción implementada

La interacción del playlist está centralizada en `playlist-interaction/controller.ts`.

### Gestos soportados en el código

- pan
- marquee
- clip drag
- clip resize
- automation point drag
- play position drag
- scrollbar drag horizontal
- scrollbar drag vertical

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

### Documentos útiles y vigentes

- `README.md`
  - quickstart y mapa general del monorepo
- `AGENTS.md`
  - ownership, workflow y reglas de colaboración
- `CONTEXT.md`
  - historial operativo y notas acumuladas
- `CONTRIBUTING.md`
  - pre-PR checklist y convenciones
- `docs/frontend-canon.md`
  - canon visual/layout del frontend

### Cómo deben interpretarse

- `README.md` y `AGENTS.md` siguen siendo útiles como marco.
- `CONTEXT.md` **no debe leerse como una foto exacta única del estado actual**; contiene historial acumulado de fases, bloques y cambios previos.
- Este archivo (`docs/project-canon.md`) debe ser la referencia corta para responder: **qué es el repo hoy y dónde tocar primero**.

## 11. Inconsistencias reales encontradas

Estas inconsistencias existen en el repo inspeccionado y conviene conocerlas:

1. **Narrativa mixta del producto**
   - Parte de la documentación raíz describe un editor financiero.
   - El código visible actual monta un playlist estilo FL Studio.

2. **`CONTEXT.md` mezcla historia y estado**
   - Incluye fases previas de canvas/financial timeline.
   - También incluye notas más recientes de playlist/interacción.
   - Sirve como log histórico, no como snapshot único.

3. **CI duplicada en un solo archivo**
   - `.github/workflows/ci.yml` contiene dos bloques `name: CI` concatenados.
   - Eso debe considerarse deuda de limpieza documental/técnica.

4. **Rama objetivo mencionada con variación**
   - Algunos docs hablan de PR contra `main`.
   - El repo inspeccionado usa `master` como default branch.

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

No implica validación de ejecución local en esta pasada.
No implica confirmación de que CI esté verde hoy.
Sí implica una foto estructural confiable del código y documentación actualmente presentes.
