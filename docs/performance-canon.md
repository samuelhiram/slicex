# SliceX — Performance Canon

> Esta es la **regla irrenunciable** para cualquier código que toque
> `@slicex/canvas/playlist-*`, el shell de React, o cualquier hot path
> de renderizado, interacción, o reducción de estado.
>
> Cualquier PR que rompa una regla aquí debe **arreglar el código**,
> **no la regla**. Si la regla parece equivocada, ábrela a debate
> explícito antes de merge — no la silencies.

## 1. Principios irrenunciables

1. **Cero allocations en steady-state render**. Cada frame del `rAF` debe
   reusar todo el trabajo del frame anterior. Crear objetos nuevos por
   frame es prohibido.
2. **Cero notifications cuando el estado no cambió**. Una acción UI que
   se invoca a 60 fps (hover, play tick, viewport size, scroll) **tiene
   que** ser idempotente en el reducer — `reducer(state, action) === state`
   cuando los datos efectivos no cambiaron. `dispatch` corta antes de
   `notify`.
3. **Viewport culling obligatorio**. Cualquier iteración sobre datasets
   sin tope (`state.clips`, `state.tracks`, `state.markers`) debe
   pre-filtrar por bounds visibles **antes** del map costoso.
4. **El reducer es la única forma de mutar `PlaylistState`.** Mutar refs
   directamente o construir state fuera del reducer está prohibido.
5. **Aritmética directa sobre iteración** cuando se puede saltar a la
   posición. Loops del tipo `while (acc < target) acc += step` están
   prohibidos cuando `target` puede ser arbitrariamente grande — usar
   `skip = Math.floor((target - origin) / step)` y arrancar desde ahí.
6. **Caché compartido por presentación.** Si el render necesita un mapa
   `id -> index`, construirlo una vez en `createPlaylistPresentation` y
   pasarlo. Nunca calcular el mapa por elemento.
7. **Subscribe selectivamente.** Si un componente React solo necesita
   `state.tool`, no provocar re-render cuando solo cambia `state.hover`.
   Usar `useState` setter con valor primitivo, o `useSyncExternalStore`
   con selector cuando aplique.

## 2. Anti-patrones prohibidos (con ejemplos)

### 2.1 Crear DisplayObjects de Pixi por frame

```ts
// ❌ PROHIBIDO
function renderNow() {
  for (const clip of clips) {
    const t = new Text({ text: clip.label, ... });   // alloc 60×/s
    layer.addChild(t);
  }
}
```

```ts
// ✅ OBLIGATORIO
// addText() en renderer-impl.ts usa un pool con cursor.
addText(layer, clip.label, x, y, { ... });
```

`new Text(`, `new Sprite(`, `new Graphics(`, `new Container(` **fuera del
`createPlaylistRenderer` init block** son anti-patrones automáticamente.

### 2.2 Acciones UI no idempotentes

```ts
// ❌ PROHIBIDO: aloca nuevo state aunque no cambie nada
case "SET_HOVER":
  return { ...state, hover: { ...action.hover } };
```

```ts
// ✅ OBLIGATORIO: short-circuit cuando equivale
case "SET_HOVER":
  if (hoversEqual(state.hover, action.hover)) return state;
  return { ...state, hover: { ...action.hover } };
```

Toda acción listada en sección 4 debajo tiene que pasar el test
`dispatchSpamDoesNotNotify` en `perf-budget.spec.ts`.

### 2.3 O(N) en hot path sin pre-filter

```ts
// ❌ PROHIBIDO: itera todos los clips, incluso los fuera de pantalla
function handlePointerMove(e) {
  for (const clip of state.clips) {
    if (hits(clip, e)) handle(clip);
  }
}
```

```ts
// ✅ OBLIGATORIO: usar la lista pre-culled de la presentación
function handlePointerMove(e) {
  for (const view of presentation.visibleClipViews) {
    if (hits(view.rect, e)) handle(view.clip);
  }
}
```

### 2.4 Loops virtuales sin skip aritmético

```ts
// ❌ PROHIBIDO: con scrollY=1M corre 14000 iteraciones por frame
let acc = realTracksEnd;
let index = realTracksCount;
while (acc < bottom) {
  if (acc + h >= top) emit(...);
  acc += metrics.trackHeight;
  index++;
}
```

```ts
// ✅ OBLIGATORIO
const skip = Math.max(0, Math.floor((top - realEnd) / virtualHeight));
let acc = realEnd + skip * virtualHeight;
let index = realCount + skip;
while (acc <= bottom) { ... }
```

### 2.5 `getMaxScrollY/X` retornando un cap finito sin razón

El timeline es infinito por diseño. El control de costo va por la
**presentación** (cull al viewport), no por **clampear el scroll**.
Volver a poner caps en geometry es regresión.

**Excepción declarada — eje Y con `virtualTracks: false`.** Un host cuyos
tracks son su propio modelo (`PlaylistCoreOptions.virtualTracks: false`,
p. ej. un track por categoría) no tiene filas virtuales debajo del último
track: no hay nada que revelar. Ahí, y sólo ahí, `core.updateViewport` /
`core.setViewportSize` limitan `scrollY` a `getRealTracksScrollLimit` (el
fondo del último track queda sobre el scrollbar horizontal) y la extensión
vertical del scrollbar cubre sólo los tracks reales. No es un control de
costo (el costo ya lo acota el cull de la presentación) sino UX: el espacio
vacío no es contenido. `getMaxScrollY` / `getMaxScrollX` **siguen siendo
infinitos** (lint + test), y con `virtualTracks` por defecto (true) el eje Y
sigue sin límite. El eje X no tiene excepción.

### 2.6 Suscriptores que disparan re-render por estado irrelevante

```ts
// ❌ PROHIBIDO: re-render cada notify aunque nada útil cambie
core.subscribe((state) => {
  setX(state);  // pasa el state entero
});
```

```ts
// ✅ OBLIGATORIO: extraer solo lo que el componente lee
core.subscribe((state) => {
  setTool(state.tool);
  setSnap(state.snap.mode);
});
```

React hace bailout con `Object.is`, pero **solo si pasas primitivos o
referencias estables**. Pasar `state` completo siempre cambia.

### 2.7 Construcción de Maps/Sets dentro de un loop

```ts
// ❌ PROHIBIDO
for (const clip of state.clips) {
  const selected = new Set(state.selection.clipIds);  // ❌ cada clip
  if (selected.has(clip.id)) ...
}
```

```ts
// ✅ OBLIGATORIO
const selected = new Set(state.selection.clipIds);
for (const clip of state.clips) {
  if (selected.has(clip.id)) ...
}
```

### 2.8 `cloneState` o `normalizeState` dentro de un `for`

`normalizeState` clona todo el `PlaylistState`. Llamarlo per-action es
correcto. Llamarlo per-clip dentro de un loop es regresión.

## 3. Patrones obligatorios

### 3.1 Pool de DisplayObjects

Cualquier DisplayObject que se cree con frecuencia variable durante el
render debe pasar por un pool keyed por Container. Ver `addText` /
`clearTextLayer` en `renderer-impl.ts`. El pool resetea el cursor en
cada frame y reusa los hijos del Container.

### 3.2 Idempotencia en reducer

Toda acción discriminada cuyo handler pueda producir el mismo `state`
input → output debe retornar `state` (la misma referencia). Lista
explícita (sección 4) lleva el contrato.

### 3.3 Pre-cull en presentación

`createPlaylistPresentation` construye un `TrackLayoutCache`
(`trackIndexById` + `trackTops` + `trackHeights`) una vez por
presentación, y `createClipViews` pre-filtra por bounds antes del map
costoso. Cualquier nueva colección visible (markers, automation
points, scenes futuros) debe seguir el mismo patrón.

### 3.4 Gesture coalescing por history

Un drag = una entrada de undo. El controller llama `beginGesture()` /
`endGesture()` alrededor del pointer-down/up. Acciones dispatchadas
entre ambos no se push-ean al historial individualmente. Cualquier
nuevo gesto que mute state debe hacer lo mismo.

Contrato del gesto (`PlaylistCore`):

- `endGesture()` push-ea **solo si** hubo al menos un dispatch undoable
  (fuera de `amend`) dentro del gesto. Selección, marquee, overlays,
  clipboard o viewport solos no crean entrada.
- El destino del undo es el present **justo antes del primer dispatch
  undoable** del gesto (`getGestureBase()`; `null` sin gesto abierto).
  Lo no-undoable previo (p. ej. la selección del click) queda fuera de
  la entrada, igual que si se hubiera dispatchado sin gesto.
- El controller abre el gesto **antes** de `tool.onPointerDown` y lo
  cierra en el acto si la tool no devuelve un drag que mute el doc. Así
  un pointer-down que ya crea/borra/mutea (paint, Shift clone-drag,
  Delete/Mute, doble click de Draw) + el drag + el `amend` del host en
  microtask son **una** entrada (R2-BRIDGE-1).

```ts
// ❌ PROHIBIDO: el dispatch creador queda en su propia entrada; un Ctrl+Z
// revierte solo el drag y deja el clip sin corregir (o un clon oculto)
const gesture = tool.onPointerDown(env); // core.createClip(...) → push
if (gesture) core.beginGesture();
```

```ts
// ✅ OBLIGATORIO
core.beginGesture();
const gesture = tool.onPointerDown(env);
if (!gesture || !gestureMutatesDoc(gesture)) core.endGesture();
```

### 3.5 rAF tick selectivo

El tick del `requestAnimationFrame` solo despacha cuando hay trabajo
real (`isRunning`, animación en curso). Si no hay trabajo, no llamar
acciones que disparen `notify` aunque sean idempotentes — es trabajo
nulo pero la JS engine paga el call.

### 3.6 Memoria estable en sesiones largas

Tras 60 segundos de play, el conteo de Text/Sprite/Graphics en cada
Container del renderer debe ser **constante**. No crece. Verificable
con `perf-budget.spec.ts` (sección 5).

### 3.8 Per-element factory + cached scene graph

Para colecciones visibles (clips, futuros nodos similares) **nunca**
hacer `Graphics.clear()` y re-emitir el batch entero por frame. El
batcher de Pixi v8 reusa el mesh GPU cuando solo cambia la transform
del Container, así que la regla es:

1. **Cada elemento es un `Container` propio** con sus `Graphics`/`Text`
   hijos.
2. **El dibujo va en coordenadas locales** (origen 0,0). La posición
   en pantalla se aplica con `container.x = ...; container.y = ...`.
3. **Un registry/factory cachea los nodos por id**. En cada frame el
   render hace `syncFrame(parent, views)`: para cada `view`, ensure
   un node (creando si no existe), set position, diff el hash visual,
   redibujar solo si cambió.
4. **Nodos que salen del viewport** se ocultan con `visible = false`,
   **no se destruyen**. El parented Container se reusa cuando vuelve.
5. **`Text` nunca se destruye** durante la sesión (canon §3.1 +
   TexturePool de Pixi v8). El registry lo orphana en su `destroy()`
   final.

Ejemplo canónico: `packages/canvas/src/playlist-renderer-pixi/
clip-node-registry.ts`. El lint `check-perf-patterns.mjs` permite
`new Container/Graphics/Text(` solo en archivos listados explícitamente
como factories — `renderer-impl.ts` (init one-shot) y los
`*-registry.ts` que implementan este patrón.

**Providers del host** (`PlaylistRendererCallbacks.getClipDetail` /
`getClipSparkline`): `syncFrame` los llama una vez por clip **visible** por
frame (sparkline: solo clips pattern). Contrato:

- Ambos son lookups O(1) sobre un índice que el host ya construyó. Nada de
  proyección/cálculo dentro del frame.
- `getClipDetail` devuelve un string estable; un string distinto redibuja
  ese clip (forma parte de `clipVisualHash`).
- `getClipSparkline` devuelve **la misma referencia de array** mientras las
  barras no cambian, y un array **nuevo** cuando cambian (nunca mutar en
  sitio un array ya devuelto). El body se redibuja si cambió el hash **o**
  si la referencia difiere de la última dibujada (`node.bars`), así que las
  barras pueden depender de cosas fuera del hash (p. ej. la posición del
  clip en un calendario) sin meter `clip.start` en el hash — un move puro
  sigue sin redibujar nada cuando no hay providers.

```ts
// ❌ PROHIBIDO: array nuevo en cada llamada → redibuja el clip cada frame
getClipSparkline: (id) => projection.barsFor(id).map(normalize),
```

```ts
// ✅ OBLIGATORIO: índice recalculado solo cuando cambian los datos; un
// array sin cambios elemento a elemento conserva la referencia previa.
getClipSparkline: (id) => sparkIndex.get(id) ?? null,
```

**Providers visuales (Ola 1).** Mismo contrato de identidad para todo lo que
el host dibuja a través del renderer: se llaman desde el render loop, son
lookups **O(1)** y devuelven **el mismo objeto** mientras sus datos no
cambian (referencia nueva = repintar; nunca mutar en sitio un objeto ya
devuelto). El canvas no interpreta el dominio: recibe beats, valores y tonos.

| Callback | Se llama | Repinta cuando |
|---|---|---|
| `getClipContent(clipId)` → `PlaylistClipContent` | 1×/frame por clip **visible** no-automation | cambia la referencia, `clip.start` o el zoom (px/beat) — el contenido vive en beats absolutos. Non-null gana al sparkline (que entonces ni se consulta). |
| `getOverviewData()` → `PlaylistOverviewData` | 1×/frame, sólo si `metrics.overviewLaneHeight > 0` | ver §3.14 |
| `getDragAnnotation()` → `PlaylistDragAnnotation` | 1×/frame, sólo mientras hay `state.tooltip` | cambia la referencia. Seguir al cursor es un transform del Container, no un repaint. |
| `getTrackMeta(trackId)` → `PlaylistTrackMeta` | 1×/frame por fila **real visible** (no overscan, no virtuales) | el header ya es inmediato; el string derivado (subtítulo truncado) se cachea por track y se recalcula sólo si cambia la referencia. |

`PlaylistStepSeries` (`initial` + `beats` ascendentes + `values`) es la
forma común de las curvas: el canvas la evalúa con búsqueda binaria
(`stepSeriesValueAt` / `sortedUpperBound`, O(log n), sin allocations) y la
recorre sólo en el rango visible (`walkVisibleSteps`). **Nunca** iterar una
serie entera por frame.

```ts
// ❌ PROHIBIDO: objeto nuevo por llamada → el lane se reconstruye cada frame
getOverviewData: () => ({ title: "Cash", primary: projection.cash(), ... }),
```

```ts
// ✅ OBLIGATORIO: construido una vez por cambio de datos, devuelto tal cual
getOverviewData: () => overviewCache,
```

### 3.14 Overview lane (`metrics.overviewLaneHeight`)

`overviewLaneHeight > 0` reserva una banda de esa altura **entre la regla
(`rulerHeight`) y el primer track**. Con 0 (default) el layout es
idéntico al histórico.

- **Una sola fuente de verdad para el inicio de los tracks:**
  `getTracksTop(metrics) = rulerHeight + overviewLaneHeight`. Todo consumidor
  del área de tracks pasa por ahí (tops de filas, `screenY ↔ track`,
  hit-test, extensión/scrollbar vertical, máscara del timeline, grid, línea
  de snap, ghost de drop, headers). `rulerHeight` a secas sólo describe la
  regla (ticks, markers, loop region, play marker). Prohibido volver a usar
  `metrics.rulerHeight` como "top de los tracks".
- **Interacción:** el lane se comporta como la regla (hit `ruler`: seek +
  scrub del playhead); su celda en la columna de headers es `chrome` inerte.
  Nada se hit-testea "a través" del lane (filas/clips scrolleados debajo).
- **Render — capa cacheada en tres niveles** (`layers/overview-lane.ts`,
  DisplayObjects creados en el init de `renderer-impl.ts`):
  1. *Frame* (fondos, línea de cero, umbrales punteados + labels, labels de
     escala, título): se reconstruye sólo si cambia la referencia de datos,
     `viewport.width` o la geometría del lane. Scroll y zoom **no** lo tocan.
  2. *Curvas* (secundaria, área+línea primaria por tono, baseline punteada,
     anotaciones): lo anterior + `scrollX` / `pxPerBeat`. Recorre sólo los
     steps visibles (búsqueda binaria del primero).
  3. *Dinámico* (línea del playhead + punto sobre la curva): se redibuja
     sólo si cambia x del playhead, y del punto o su tono (evaluación por
     búsqueda binaria, sin allocations).
  Hover, selección, playhead, `scrollY`, alto del viewport: **0 rebuilds**
  (test `perf-budget.spec.ts`).
- **Escala Y:** min/max **globales** de primary ∪ baseline ∪ umbrales ∪ 0
  (estable al scrollear), calculada una vez por referencia de datos — O(n)
  por cambio de datos, nunca por frame. La secundaria tiene escala propia.

### 3.10 rAF coalescing + dirty-layer caching en el renderer

`dispatch()` invoca `notify()` síncronamente; durante un pointermove
rápido o un tick activo, varios notifies pueden caer en el mismo frame
del browser. El renderer **no** debe pintar uno por notify — debe
coalescer todos los notifies del frame en un solo `renderNow()`.

Patrón canónico (ver `renderer-impl.ts`):
```ts
let renderFrameId = 0;
const requestRender = () => {
  if (renderFrameId !== 0 || destroyed) return;
  renderFrameId = requestAnimationFrame(() => {
    renderFrameId = 0;
    renderNow();
  });
};
core.subscribe(requestRender);
```

Adicionalmente, **layers cuyas dependencias no cambian frame-a-frame**
deben cachear su geometría:

- `timelineMask` depende solo de `viewport.width/height` y métricas de
  ruler/header. Se cachea por una key string; solo se redibuja al
  cambiar.
- `timelineGridGraphics` depende solo de `pxPerBeat`, `scrollX`,
  `viewport.width`, `sceneRect.height`, y la lista de ticks. Hover /
  selección / cualquier otra cosa **no** lo invalida.
- Overview lane: frame / curvas / dinámico con sus propias keys (§3.14),
  comparadas campo a campo (sin construir strings por frame).
- Pill de anotación del drag: se pinta una vez por referencia y sigue al
  tooltip moviendo su Container.

El patrón es: calcula un hash de las dependencies, comparalo con el
hash del frame anterior, salta `clear()` + re-emit si no cambió.

**Repintar sin notify del core.** Cuando cambian datos de un provider
(`getClipDetail` / `getClipSparkline` / `getClipContent` / `getOverviewData`
/ `getDragAnnotation` / `getTrackMeta`) pero `PlaylistState` no, el host
llama `renderer.invalidate()`. Entra por el mismo `requestRender`
coalescido: N invalidates + N notifies del mismo frame = 1 `renderNow()`,
y no arranca ningún tick (§3.11). Prohibido forzar un repaint despachando
una acción "dummy" al core (ensucia history/notify) o con un rAF propio.
El callback del rAF limpia `renderFrameId` **antes** de `renderNow()`: un
frame que cae antes de que Pixi esté listo no puede dejar el id colgado y
bloquear todos los renders siguientes.

### 3.11 rAF idle stop

Cualquier rAF tick que solo tenga sentido durante un estado activo
(playback, drag, animación en curso) **debe** suscribirse al flag que
lo activa y arrancar/parar el rAF en respuesta. NO mantener un tick
"durmiente" que llama acciones idempotentes 60 Hz — aunque sean no-op
en el reducer, el callback del rAF, la lectura de `performance.now()`
y la entrada al dispatch suman.

**Pixi no lleva ticker propio.** `Application.init` va siempre con
`autoStart: false` (lo enforce `check-perf-patterns`, regla
`pixi-idle-ticker`): el ticker por defecto de Pixi repinta TODO el stage
cada frame aunque nada cambie. Pintar es asunto de `requestRender` (§3.10).
Su `EventSystem` tampoco se usa (el controller es dueño del input): se
desconecta tras `init` (`renderer.events.setTargetElement(null)`), o escucha
cada `pointermove` del documento y mantiene un rAF que re-despacha un
`pointermove` falso cada 10 ms. En reposo el canvas hace 0 draw calls. (2026-11-08: ese repintado continuo,
bajo el fondo difuminado del editor, congeló Chrome en una máquina modesta.)

Ejemplo canónico: `PlaylistShell` se suscribe a
`state.playPosition.isRunning`. El tick que llama
`advancePlayPosition` solo arranca cuando `isRunning` pasa de false a
true, y se cancela cuando vuelve a false.

### 3.13 Identidad estable de `state.clips` / `state.tracks`

Una acción que no toca clips/tracks (hover, playhead, viewport, tool,
selección, overlays…) **conserva la referencia** de `state.clips` y
`state.tracks`. `PlaylistCore.dispatch` pasa el estado previo a
`normalizeState(reduced, metrics, previous)`, que reutiliza el array previo
cuando el reducer devolvió el mismo — sin clonar ni re-normalizar (la
normalización de un clip depende solo del clip + `metrics`, y el previo ya
está normalizado). Arrays que sí cambiaron se reconstruyen con objetos
nuevos, como siempre.

Consecuencias obligatorias:

- Los reducers que no tocan clips/tracks hacen `{ ...state, x }` — nunca
  `clips: state.clips.map(...)` "por si acaso".
- Los suscriptores pueden (y deben) cortar con
  `state.clips === lastClips && state.tracks === lastTracks` antes de
  cualquier trabajo O(N) (bridge financiero, inspector, caches).
- El state es inmutable (§1.4): dos entradas de history pueden compartir el
  mismo array; mutarlo en sitio corrompe el undo.

```ts
// ❌ PROHIBIDO: re-clona N clips en cada hover/tick (60 Hz × O(N) allocs)
const next = normalizeState(reduced, metrics);
```

```ts
// ✅ OBLIGATORIO
const next = normalizeState(reduced, metrics, previous);
```

### 3.9 Batch dispatch para gestures que generan N mutaciones por move

Si un gesture puede crear/borrar/modificar **N elementos en un solo
pointermove** (brush stroke, marquee delete, magic lasso), el handler
**debe** agrupar las N mutaciones en una sola acción discriminada
`*_BATCH` que el reducer ejecute en una pasada. Hacer `N` dispatches
seguidos resulta en `N` `notify()` y por tanto `N` renderNow — eso
mata el FPS aunque cada paso individual sea barato.

Ejemplo canónico: `core.createClips([...])` → `CREATE_CLIPS_BATCH` →
un único `notify()`. Mismo patrón aplica a futuros `DELETE_CLIPS_BATCH`,
`MOVE_CLIPS_BATCH`, etc.

### 3.12 Touch tracker — pinch / long-press / inertia (F8)

Cualquier feature de input táctil (pinch zoom, long-press, momentum
scroll) vive en `playlist-interaction/touch.ts`, fuera del flujo
principal del controller. El controller solo invoca 4 hooks
(`handlePointerDown` / `handlePointerMove` / `handlePointerUp` /
`handlePointerCancel`) que devuelven `true` cuando consumen el evento.

- El tracker **solo se activa** para `event.pointerType === "touch"`.
  Para mouse retorna `false` inmediato — cero costo en desktop.
- Pinch zoom usa `core.updateViewport`, que ya tiene el short-circuit
  §4. Pinch a 60Hz con dist constante no notifica.
- Long-press es un `setTimeout(500ms)`. Move > 6px o pointer up antes
  cancela el timer. Cero costo si no dispara.
- Inertia solo arranca cuando: gesto previo era `pan` o `scrollbar-*`,
  hubo muestras de velocidad en los últimos 60ms, y la velocidad media
  supera `SETTLE_EPSILON`. rAF dedicado que decae 0.95/frame y se
  detiene cuando |vx|+|vy| < SETTLE_EPSILON.
- Cualquier nuevo pointerdown llama `cancelInertia()` antes de procesar
  — un tap durante un flick lo para inmediatamente.

No mantener un tick "durmiente" para checar si hay flick. La velocidad
se sampleia en el handler de pointermove (cuando ya hay trabajo real).

### 3.7 Brush stroke pattern (Paint y futuros tools de "pintar arrastrando")

Cualquier tool que cree clips/cells por drag (Paint, futuros tools
similares) **debe** componer los primitivos de
`packages/canvas/src/playlist-interaction/brush.ts`:

- `buildBrushOcclusion(state, snapStep)` — seed O(N) en pointerdown que
  registra cada celda snapped que ya está cubierta por algún clip. La
  consulta `has()` y la mutación `add()` son O(1). El tool **nunca**
  debe re-escanear `state.clips` en cada pointermove para detectar
  colisiones — eso es regresión §2.3.
- `interpolateBrushPath(from, to, snapStep)` — devuelve la lista de
  celdas snapped a lo largo del segmento, ya deduplicadas. Garantiza
  que un pointermove rápido nunca salte celdas intermedias.
- `brushSnapStep(state, metrics)` — resuelve el step canónico para la
  brocha. Para modos no-grid (`none`, `events`) cae a 1 beat para que
  la interpolación siga funcionando.

El gesture asociado (e.g. `paint-drag`) **debe** persistir el
`BrushOcclusion` y el `snapStep` en su payload para que `pointermove`
no los recalcule. El controller dispatcha `CREATE_CLIP` por celda y
agrega el resultado al occlusion antes de la siguiente iteración.

Bug histórico que motivó el módulo: cuando paint pintaba más allá de
las `state.tracks` materializadas, el clip se creaba con `trackId`
virtual que el render filtraba como invisible. Ahora el reducer
`CREATE_CLIP` recibe `trackIndex` y materializa la track antes de
añadir el clip — anti-patrón estructuralmente imposible.

## 4. Lista canónica de acciones idempotentes

Las siguientes acciones se disparan a alta frecuencia (rAF, pointermove,
ResizeObserver) y **están obligadas a ser idempotentes en el reducer**:

- `ADVANCE_PLAY_POSITION`
- `SET_HOVER`
- `SET_PLAY_POSITION`
- `SET_PLAY_RUNNING`
- `SET_VIEWPORT_SIZE`
- `UPDATE_VIEWPORT`
- `SET_TOOL`
- `SET_SNAP_MODE`
- `SET_STRETCH_MODE`
- `SET_TRANSPORT_MODE`
- `SET_DRAG_PREVIEW` (F1/F3)
- `SET_SNAP_HINT` (F1/F3)
- `SET_TOOLTIP` (F1/F3)
- `MOVE_CLIPS` (cada pointermove de un clip-drag): misma `state` cuando
  ninguna track se materializa y cada update deja `max(0, start)` y el
  `trackId` destino iguales a los del clip. Si algo cambia, el array de
  clips se copia desde el primer clip que se mueve.
- `RESIZE_CLIP` (cada pointermove de un resize): misma `state` cuando
  `start`, `duration` y `contentOffset` resultantes no cambian (borde
  donde ya está, o ya clampeado a `minClipDuration` / 0).

Sin esto, cada pointermove por debajo de un paso de snap re-normalizaba
N clips y obligaba a todo suscriptor (bridge financiero: ~1.3 ms a 600
items) a un pase O(N) por un no-op (PERF2-3).

Cada vez que aparezca una nueva acción que se invoque ≥30Hz, agregarla
a esta lista y a los tests de `perf-budget.spec.ts`.

## 5. Budgets verificados en CI

`packages/canvas/tests/perf-budget.spec.ts` enforce:

| Métrica | Budget |
|---|---|
| `createPlaylistPresentation` con `scrollY=1_000_000` | < 50 ms |
| `createPlaylistPresentation` con 1000 clips | < 30 ms |
| `createPlaylistPresentation` con 1000 tracks | < 30 ms |
| `clipViews.length` con 1000 clips fuera del viewport | < 50 |
| `trackRows.length` con `scrollY=1_000_000` | < 40 |
| Notify rate sobre 1000 dispatches idempotentes | == 0 |
| `moveClips` / `resizeClip` a la posición actual × 500 en un drag (1000 clips) | 0 notifies, mismo `state.clips` |
| `dispatch` × 10000 con state estable | < 100 ms (10 µs/dispatch) |
| Brush path interpolación cubre todas las celdas snapped | sí, sin saltos |
| Paint en track virtual produce clip visible | sí, track materializada |
| `core.createClips([N])` dispara 1 notify, no N | 1 |
| Bulk createClips × 500 entries | < 30 ms |
| N notifies del mismo frame coalescen en 1 render | sí |
| rAF idle stop: tick cancelado al pausar play | sí |
| Mask / grid solo redibujan al cambiar sus deps | sí |
| hover / playhead / viewport conservan `state.clips` y `state.tracks` (1000 clips) | misma referencia |
| 1000 cambios de hover con 1000 clips | < 30 ms |
| Overview lane: rebuilds de geometría en 100 frames de hover / playhead / selección | == 0 |
| Overview lane: geometría emitida para una ventana visible de una serie de 1000 vs 100 000 steps | idéntica (O(log n + visibles)), < 1000 `lineTo` |
| Overview lane: 100 rebuilds por scroll (serie de 1000 y de 100 000 steps) | < 150 ms c/u (medido ≈ 26 ms aislado) |
| Clip content: redraws de body en 100 frames con referencias estables (1000 clips) | == 0 |

Estos números **no se tocan para que pasen los tests**. Si un test
falla, hay un bug de performance real que arreglar.

## 6. Enforcement automático

### 6.1 Lint estático (`scripts/check-perf-patterns.mjs`)

Corre en cada `pnpm -w run check:arch`. Detecta:

- `new (Text|Sprite|Graphics|Container)(` en archivos del renderer
  fuera del bloque `createPlaylistRenderer` (heurística por archivo).
- `case "SET_HOVER":` / `case "SET_PLAY_POSITION":` / etc. sin un
  `return state;` early dentro de los próximos 6 lines.
- `getMax(Scroll)?[XY]\s*=.*?[^I]nfinity` fuera de `geometry.ts` (los
  caps finitos son regresión).
- Loops `while.*?<.*?bottom\b` sin un `skip = Math.floor(` cercano.

Cualquier match es **error**, no warning. PR no merge sin verde.

### 6.2 Tests de budget

Listados en sección 5. Vitest run los corre como parte del suite normal.

### 6.3 Reload-stress de Playwright

`apps/web/tests/reload-stress.pw.ts` valida que el renderer monta limpio
11× consecutivos sin emisión de `console.error` ni `pageerror`. Captura
regresiones tipo TexturePool corruption y null-geometry.

## 7. Cuándo desactivar una regla

Casi nunca. Si necesitas:

- **Alocar un DisplayObject** durante render porque la cantidad cambia
  dinámicamente → ya tienes pool. Usalo.
- **Mantener una acción no-idempotente** porque "es trivial" → no. Si
  se invoca ≥30Hz, **es** idempotencia obligatoria.
- **Iterar todos los clips** porque "no son tantos" → no. Hoy puede
  haber 8 demo clips, mañana 5000 financiero. El cull es barato.

Si **realmente** debes desactivar, deja un comentario `// PERF-EXEMPT:
<razón>` en la línea, y abre un issue para justificarlo en review.
Cualquier `PERF-EXEMPT` se audita.

## 8. Cómo extender este canon

Cuando aparezca una nueva clase de bug de performance:

1. Reproducirlo con un test que falle.
2. Arreglarlo.
3. Documentar el anti-patrón aquí con código `❌` vs `✅`.
4. Agregar la regla automática a `scripts/check-perf-patterns.mjs` si
   es detectable estáticamente.
5. Agregar el budget al test si es medible.

No se elimina una regla. Se especializa o se rota a una nueva.
