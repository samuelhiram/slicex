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

### 3.5 rAF tick selectivo

El tick del `requestAnimationFrame` solo despacha cuando hay trabajo
real (`isRunning`, animación en curso). Si no hay trabajo, no llamar
acciones que disparen `notify` aunque sean idempotentes — es trabajo
nulo pero la JS engine paga el call.

### 3.6 Memoria estable en sesiones largas

Tras 60 segundos de play, el conteo de Text/Sprite/Graphics en cada
Container del renderer debe ser **constante**. No crece. Verificable
con `perf-budget.spec.ts` (sección 5).

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
| `dispatch` × 10000 con state estable | < 100 ms (10 µs/dispatch) |

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
