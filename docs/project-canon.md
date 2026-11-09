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
- `PlaylistShell` crea un **documento financiero demo** (`createDemoFinancialDocument(hoy)` de
  `@slicex/core`), lo proyecta a estado de playlist (`apps/web/src/finance/mapping.ts`), inicializa
  core + interacción + renderer y el `FinancialBridge`, y monta `PlaylistInspector`, los paneles
  financieros (`apps/web/src/finance/components/`) y `ErrorBoundary`.
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

### Motor financiero (MVP, en memoria)

- **Tiempo:** 1 beat = 1 día; beat 0 = `FinancialDocument.startDate` ("hoy"). Ruler de calendario
  vía la opción genérica `PlaylistCoreOptions.timeAxis` (`apps/web/src/finance/time-axis.ts`).
- **`@slicex/core/finance`** (puro): fechas ISO, recurrencias (`once`/`weekly`/`biweekly`/
  `semimonthly`/`monthly`), expansión de eventos, proyección (cash + deuda por cuenta; interés de
  tarjeta estimado por saldo diario promedio), alertas de liquidez, avalancha, comparación de
  escenarios, documento demo.
- **`FinancialBridge`** (`apps/web/src/finance/financial-bridge.ts`): `item.id === clip.id`. La
  geometría del clip es la verdad de las fechas (mover = mover fechas, estirar borde derecho =
  `endDate`, recortar el izquierdo no mueve los días de pago, slice parte la recurrencia); lo no
  temporal (montos, tarjetas) vive en el documento. Undo/redo del playlist es la única pila: cada
  estado del historial tiene su snapshot de items, y cada guardado del editor es una entrada
  (`core.touch()` cuando el clip no cambia). Clips no cortables (`noSlice`): eventos únicos,
  tarjetas, MSI, préstamos con saldo.
- **UI React:** barra de resumen (liquidez, reserva, deuda, próximo pago, mínimo proyectado,
  alertas, altas), readout del playhead, editor (doble clic; alta diferida: el item se crea al
  Guardar), panel "Análisis" (escenario base vs actual, estrategia avalancha a la fecha del
  playhead).
- **Olas 2–4 (2026-11-08)** — "la línea responde", "futuros", "vivir en tu realidad":
  - *Deudas que terminan donde las liquidas:* tarjetas y préstamos con saldo sin fecha final
    (`isPayoffPinned`) tienen el borde derecho derivado del pago total (`estimateDebtPayoffs`;
    una tarjeta se alarga hasta su último MSI). Arrastrar ese borde es **búsqueda de objetivo**
    (`solveDebtPayment` en `@slicex/core/finance/goalseek.ts`): calcula el pago que te libera en
    esa fecha; al soltar, el clip cae en el día real de liquidación. Préstamos por ventana
    conservan su total y lo reparten.
  - *Monto con la mano:* el borde superior de un clip es un "nivel" genérico del canvas
    (`PlaylistInteractionOptions.onClipLevelDrag`); el bridge lo mapea al monto (`levelDrag`).
    Un arrastre = una entrada de undo; la píldora muestra el efecto.
  - *Valles que se explican y se arreglan:* `explainValley` / `suggestValleyFixes`
    (`valley.ts`); la tarjeta `ValleyCard` aparece al pasar sobre un valle de la franja
    (`onOverviewHover`) o con el playhead dentro de uno, ilumina los pagos que lo cavan
    (`getClipHighlight`) y aplica arreglos de un clic.
  - *Futuros (ramas):* `Futures` (`apps/web/src/finance/futures.ts`) guarda cada versión como
    documento + sesión del playlist (`core.saveSession/loadSession`: cada futuro con su undo).
    "Bifurcar aquí", comparar (fantasma bajo la curva), cambiar con transición animada,
    mantener **Q** para asomarse al otro futuro, mantener **A** sobre un clip para ver el año sin él.
  - *La tarjeta como compás:* `CreditCardItem.paymentMode: "statement"` (totalero: paga el
    estado de cuenta completo, nunca intereses); cortes dibujados como marcas en el clip
    (`PlaylistClipContent.marks`); al cruzar el corte una compra muestra cuándo se paga.
  - *Escribir sobre el timeline:* "/" abre `CommandBar` (`command.ts`: "renta 8000 el 1"),
    vista previa en vivo en la franja, Enter crea; vacío ofrece el año mexicano
    (`suggestMexicanYear`: aguinaldo, Buen Fin, predial…) aceptable con Tab.
  - *Rec y persistencia:* el plan (todos los futuros + bitácora) se guarda en `localStorage`
    (`persistence.ts`). Al volver otro día, `rollForward` lo pone al día suponiendo que todo pasó
    como se planeó; `RecDialog` corrige ("no pasó", "otro monto", saldo real). Pegar un estado de
    cuenta sobre una tarjeta (`statement.ts`) actualiza su saldo o agrega compras futuras.
  - *Tu año en 60 segundos:* primera visita = ejemplo + banner; el onboarding arma el año del
    usuario con tres preguntas. La persistencia en servidor (`@slicex/db`) sigue dormida.
- **Lenguaje visual (2026-11-07):** UI calmada y de alto contraste, tema **claro y oscuro**
  (toggle en el header; primera visita sigue al sistema; elección en `localStorage`
  `slicex.theme`, `apps/web/src/theme.ts`). Tokens CSS en `globals.css`
  (`:root[data-theme=…]`) espejados en la paleta del canvas
  (`packages/canvas/src/playlist-renderer-pixi/palette.ts`, `LIGHT_PALETTE`/`DARK_PALETTE`);
  se cambian juntos. Fuente Inter (woff2 locales en `apps/web/src/assets/fonts/inter/`, OFL);
  el shell espera a la fuente antes de crear el renderer (Pixi rasteriza cada `Text` una vez).
  Regla de dos niveles (mes / días, píldora "Hoy", fines de semana sombreados) vía
  `PlaylistTimeAxis.bands()` + ticks `centered`/`emphasis`/`dim`; clips como tarjetas tintadas
  con barra de acento; headers con íconos (ojo / enfoque / candado) en vez de "M S L".
- **Estándar Soft UI (regla de implementación, 2026-11-08).** Toda UI nueva lo cumple:
  - **Cartas sobre página gris:** `--page-bg` gris suave; el contenido vive en tarjetas
    flotantes (`--radius-card`, `--shadow-card`, separadas `--gap-card`). Nada de franjas a
    todo lo ancho separadas por líneas finas. El header es UNA tarjeta (métricas + herramientas
    + acciones): un renglón en ventanas anchas (≥1800 px), dos en el resto (métricas arriba;
    herramientas a la izquierda y acciones a la derecha abajo), tres en teléfono.
  - **Controles secundarios = rellenos suaves** (`--surface-2`) sin contorno; una sola acción
    primaria rellena (`--ink`) por superficie. Radios `--radius-s/m/l` = 8/12/18 px.
  - **Controles donde y cuando actúan:** los íconos de cada track (ojo / enfoque / candado /
    asa) solo en la fila con hover o selección, o cuando su estado está activo; sin contadores
    permanentes (solo un chip con selección múltiple); un banner a la vez; la lectura del
    playhead (fecha · caja · deuda) vive en la celda vacía bajo "Caja", no en una barra.
  - **Todo alcanzable a cualquier ancho:** lo flotante (menús, popovers, menú contextual, barra
    "/") pasa por `apps/web/src/ui/fit-in-viewport.ts` (se recorre / se limita / hace scroll
    dentro de la ventana); las barras se desplazan de lado en vez de encimarse. Auditado en
    1920 / 1366 / 1024 / 768 / 390 px (ningún control fuera de pantalla, tapado, sin nombre
    accesible ni menor a 24 px).
- **Tracks infinitos y permanentes (como FL)**: el shell usa `virtualTracks` por defecto
  (filas "Track N" vacías siempre debajo). Las filas no se borran solas: el acomodo
  (`FinancialTrackLayout` en `apps/web/src/finance/mapping.ts`: filas, incluso vacías, y
  item → fila) se guarda por futuro en `slicex.plan.v1` y `createFinancialPlaylistState(doc, layout)`
  lo restaura; las filas vacías auto-nombradas al final no se guardan (son idénticas a las
  infinitas). Menús contextuales en español: "Nuevo … aquí" crea en esa fila y fecha
  (`bridge.addItem(item, { trackIndex })`); el menú de track no tiene "borrar track".
- **Agarrador de longitud**: el clip seleccionado muestra una barra vertical en el centro de
  la pantalla, dentro del clip (`getClipExtendHandle` en `playlist-core/presentation.ts`,
  compartido por renderer y hit-test). Arrastrarla mueve el final derecho (izquierda acorta,
  derecha alarga) aunque esté fuera de pantalla; un gesto = una entrada de undo. El host
  lo veta por clip (`clipExtend`; finanzas: no en eventos de un solo día).

### Lo que no está conectado todavía como flujo final de producto

- El documento financiero vive **solo en memoria**: no se persiste (Prisma / `/api/timelines` siguen
  sin cablear a la UI).
- `createDemoPlaylistState()` (demo musical) sigue existiendo en `@slicex/canvas` para sus tests,
  pero la app ya no la monta.

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

Colores: la paleta viva `COLORS` (`palette.ts`) se muta en sitio con `applyPlaylistTheme`;
`renderer.setTheme("light" | "dark")` la cambia e invalida una sola vez todas las capas
cacheadas (grid, máscara, nodos de clip, overview lane, píldora de arrastre). Nunca por frame.

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
