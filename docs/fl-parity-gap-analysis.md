# FL Playlist — Análisis de huecos de interacción

Qué le falta al Playlist de SliceX para funcionar como una **UI interactiva** equivalente a la del
Playlist de FL Studio. Alcance estricto: interacción de usuario (mouse, teclado, touch, menús,
gestos). **Nada de procesamiento de audio.**

- Fuente FL: manual oficial de Image-Line (FL Studio online manual).
- Fuente SliceX: lectura directa del código en `master`, fecha **2026-08-13**.
- Contrato de paridad vigente: [fl-playlist-parity-spec.md](fl-playlist-parity-spec.md).

## Método y fiabilidad (léelo antes de usar las cifras)

506 interacciones documentadas en el manual oficial, auditadas contra el código por área, con una
pasada adversarial que intentó **refutar** cada hueco buscando la implementación en el repo.

Tras deduplicar: **382 huecos** — 9 bloqueantes, 52 de impacto alto, 321 de cola larga.

Limitaciones que hay que tener presentes:

- **52 entradas no recibieron veredicto explícito** en la pasada de refutación. Están contadas como
  huecos, así que el número real es algo menor.
- La clasificación mezcla *ausente*, *parcial* y *divergente a propósito*. Los bloqueantes y los de
  impacto alto sí fueron revisados uno por uno; la cola larga no.
- Algunas afirmaciones del manual dependen de **settings de FL** configurables por el usuario
  (undo alterno, right-click delete, typing-keyboard-to-piano). No son universales.

Lo verificado a mano — y por tanto lo que sostiene este documento — son los bugs de la sección 3 y
los cinco huecos estructurales de la sección 4.

## 1. Decisiones declaradas

Tomadas por el dueño del repo el 2026-08-13. No son deuda: son divergencias intencionales.

| # | Decisión | Consecuencia |
|---|---|---|
| D1 | **No se persigue la paridad literal de modificadores.** Prima la estabilidad en browser. | Los ~9 gestos de FL que dependen de distinguir Right-Alt / Right-Shift / Left-Shift se rebindean a combinaciones estables. El DOM no expone lateralidad en eventos de mouse, y en teclado LatAm Right-Alt **es AltGr** (llega como Ctrl+Alt), así que la paridad literal sería frágil por diseño. |
| D2 | **Merge queda fuera de alcance por ahora.** | Las 6 entradas de la familia Merge (`Merge pattern clips`, `Merge similar`, `Merge automation`, y sus entradas de menú) se aplazan. Se conserva `Ctrl+G` = **group** como está hoy, que colisiona con el `Ctrl+G` = *merge* de FL. Divergencia declarada, no bug. |
| D3 | **Arrangements es P0.** | Es el análogo directo de los "múltiples timelines clonables para simular escenarios" del [product-spec](product-spec.md). Sube por encima del resto de la cola larga. |

## 2. Viabilidad en browser (filtro de estabilidad — D1)

SliceX corre en una pestaña, no en un binario nativo. Antes de portar cualquier atajo hay que pasar
este filtro.

### Atajos que el navegador reserva y la página **no puede** cancelar

`Ctrl+T`, `Ctrl+N`, `Ctrl+W`, `Ctrl+Shift+T/N/W`, `Ctrl+Tab`, `F12` (Chrome). Un `preventDefault()`
no los recupera. Cualquier binding sobre ellos es código muerto.

> ✅ **Había uno vivo en el repo, ya corregido.** `Ctrl+T` estaba ligado a `addAutoNamedMarker()`:
> en Chrome, Firefox y Edge eso abre una pestaña nueva y el marker **nunca se creaba**. Rebindeado a
> **`Ctrl+M`**, libre en los tres.

### Cancelables, pero con coste

- `Ctrl+D` (bookmark), `Ctrl+B`, `Ctrl+G`, `Ctrl+P`, `Ctrl+S`, `Ctrl+F`: se recuperan con
  `preventDefault()`. Ya se hace y funciona.
- **`Alt` a secas** enfoca la barra de menú en Firefox/Edge. Se previene, pero conviene no colgar
  gestos críticos de `Alt` suelto.
- **AltGr en teclado LatAm** emite `ctrlKey && altKey` a la vez. Todo binding con `Alt` debe exigir
  `!event.ctrlKey` explícitamente, o se disparará al teclear `@`, `\`, `~`, `[`, `]`, `{`, `}`.
  Hoy varios bindings de `Alt` **no** lo comprueban.
- **Botón medio**: activa el auto-scroll de Windows. Se cancela en `pointerdown` + `auxclick`.
- **Doble clic derecho**: no existe como evento nativo. Habría que sintetizarlo con temporizador —
  por D1, **no se hace**.

### Regla derivada de D1

> Cuando un gesto de FL no sea expresable de forma estable en el DOM, se elige el equivalente más
> robusto y **se documenta como divergencia** en el parity spec. No se sintetizan gestos frágiles
> (doble clic derecho, lateralidad de modificadores, chords de tres botones) para simular paridad.

## 3. Bugs verificados (no son huecos de paridad)

> ✅ **Corregidos el 2026-08-13** (bloque F13). Se conservan documentados porque explican por qué
> el código quedó como quedó y qué propiedad vigila cada test nuevo. Cobertura en
> [`f13-stability.spec.ts`](../packages/canvas/tests/f13-stability.spec.ts).

### B1 — Cortar un Automation Clip destruye su envolvente

[`reducer.ts:1078-1081`](../packages/canvas/src/playlist-core/reducer.ts#L1078-L1081) acorta la
`duration` de la mitad izquierda pero **no toca `points`**. Después,
[`state-utils.ts:134`](../packages/canvas/src/playlist-core/state-utils.ts#L134) clampa cada
`point.time` a `[0, duration]`. Resultado: todos los puntos posteriores al corte se apelmazan contra
el borde derecho. Pérdida de datos silenciosa.

El test que había ([`slip-slice.spec.ts:155`](../packages/canvas/tests/slip-slice.spec.ts#L155))
sólo contaba ids nuevos, por eso pasaba en verde.

**Fix:** `splitAutomationPoints()` en `state-utils.ts` re-corta la envolvente en las dos mitades.
Cada lado materializa el punto del corte con el valor interpolado, la mitad derecha se rebasa a 0, y
los ids se reconstruyen por mitad (derivan del id del clip dueño, así que copiarlos los hacía
colisionar). Se expone también `automationValueAtTime()`, que hacía falta y que reutilizarán las
curvas de F17.

### B1b — Slice truncaba clips en tracks bloqueadas *(encontrado durante el fix)*

El wrapper filtraba las tracks bloqueadas al construir las mitades derechas, pero el reducer
re-derivaba el conjunto sólo desde `time` — así que un clip bloqueado que cruzara el corte **se
truncaba sin recibir mitad derecha**. Pérdida de contenido, en la capa que precisamente debe
protegerlo.

**Fix:** la acción `SLICE_CLIPS_AT_TIME` ahora lleva `clipIds` explícito y el reducer sólo toca esos.

### B2 — Con Draw/Paint, el clic derecho borra el Automation Clip entero

La guarda de borrado en
[`controller.ts:485-493`](../packages/canvas/src/playlist-interaction/controller.ts#L485-L493)
incluye `hit.kind === "automation-body"` entre sus objetivos y **precede** a la rama que añade un
control point (`:509-518`). Justo en los modos donde FL documenta el RMB como "añadir punto", aquí
destruye el clip.

**Fix:** los automation clips se excluyen **por tipo de clip, no por hit kind**. Filtrar sólo
`automation-body` dejaba vivas dos puertas: un RMB en la barra de título o en los 8 px de borde de
resize resuelve a `clip` / `resize-right` y borraba la envolvente igual. El barrido de borrado lleva
además `skipAutomation`, porque cruzar una curva a media pasada contradecía el gesto que el usuario
acababa de hacer. Borrar un automation clip sigue disponible por la Delete tool y el menú contextual.

### B2b — `normalizeState` destruía la envolvente al **redimensionar**, no sólo al cortar

La causa raíz que el primer fix no tocó. `normalizeState` corre en **cada dispatch** y su salida es
la que entra al historial, así que su `clamp(point.time, 0, duration)` no era una vista: acortar un
automation clip apilaba de forma permanente todos los puntos pasados del borde nuevo, y volver a
estirarlo **no los recuperaba**. Pasarse dos píxeles arrastrando un borde costaba la envolvente.

**Fix:** el clip es una **ventana** sobre su envolvente. `normalizeState` deja de clampear
`point.time` contra `duration` (sigue clampeando el *valor* a 0..1, que sí es el rango real del dato),
y la capa de presentación culla los puntos fuera de la ventana. Redimensionar es ahora reversible.

### B3 — El eyedropper secuestra `Alt` + arrastre

[`controller.ts:728-748`](../packages/canvas/src/playlist-interaction/controller.ts#L728-L748)
intercepta `Alt+LMB` sobre un clip y hace `return` antes de delegar a la herramienta activa. Eso
vuelve inalcanzable el gesto más citado del manual: **arrancar un arrastre con Alt ya pulsado para
mover sin snap**. La capacidad existe (pulsar Alt a mitad del arrastre sí funciona); es sólo el
binding.

**Fix:** el eyedropper sale del espacio de modificadores por completo y pasa a **hover + tecla `I`**.
Primero se probó `Alt+Shift+click`, y la revisión adversarial demostró que sólo cambiaba una víctima
por otra: `Alt+Shift+drag` es *clonar sin snap* en FL, y quedaba igual de muerto. Cualquier binding
de modificador+puntero en esta rama se traga un gesto de arrastre entero, porque hace `return` antes
del dispatch a la herramienta. Los tres gestos quedan libres y con test: `Alt+drag` mueve sin snap,
`Shift+drag` clona, `Alt+Shift+drag` clona sin snap.

### B3b — Paint estampaba encima de un clip existente con `Alt` *(consecuencia de liberar Alt)*

La rejilla de ocupación del pincel se indexa por **celda snappeada**, así que un click con `Alt`
(bypass de snap) cae entre celdas y reporta el sitio como libre: aparecía un clip duplicado montado
sobre el que ya estaba. **Fix:** Paint no estampa cuando el hit-test dice que hay un clip debajo.

## 4. Los cinco huecos estructurales

No son features sueltas. Cada uno es una puerta que, cerrada, deja sin sujeto a decenas de
interacciones derivadas.

### E1 — No hay gramática global de modificadores

En FL, `Ctrl` / `Alt` / `Shift` / RMB significan lo mismo **con cualquier herramienta activa**. En
SliceX cada tool los interpreta a su aire:

- `Ctrl+drag` = marquee sólo existe dentro de `select.ts:124`. Con Draw/Paint/Slice sigue creando o
  cortando.
- RMB = borrar sólo funciona con Draw/Paint/Mute, y **sólo si el pointerdown cae encima de un clip**:
  empezar en hueco y barrer no borra nada.
- `Shift` = clone-drag sólo con Select.

El efecto práctico: te obliga a viajar a la toolbar para cosas que en FL nunca cambian de
herramienta. **Sitio del fix:** una capa de overrides en `handlePointerDown` evaluada *antes* del
dispatch a la tool (hoy en `controller.ts:751-752`). Es la pieza más barata de todas y la que más
cambia la sensación.

### E2 — No existe selección temporal

`PlaylistSelection` es `{clipIds, automationPointIds}`. Grep de `timeSelection|timeRange|rangeSelection`:
**0 resultados en todo el repo**. Cualquier LMB en la regla entra directo a `play-position-drag` sin
mirar `ctrlKey`.

Sin un campo de rango quedan sin sujeto ~14 comandos: `Ctrl+drag` en la regla, `Ctrl+Ins` / `Ctrl+Del`
(ripple insert/delete), loop sobre la selección, `Ctrl+B` con intervalo de repetición, zoom-to-selection,
copy-move de rango, "Add two markers", select prev/next time. En FL, arrastrar en la regla es el verbo
más usado de todo el arreglo.

### E3 — La track no es una entidad seleccionable

El click en el header hace `setSelection({clipIds: [], ...})` — un *deselect all* encubierto
(`controller.ts:668-672`). Sin `trackSelection` quedan sin sujeto otros ~12 comandos, y como `groupId`
existe **sólo en clips**, tampoco hay jerarquía de tracks: ni group-with-above, ni plegar/desplegar,
ni mute/solo de grupo, ni clone track.

Detalle aprovechable: varias entradas que faltan en el menú del header son **cableado puro sobre
verbos que ya existen** — `Move up`/`Move down` (ya está `reorderTrack`, undoable) y `Mute all clips`
(ya está `setClipsMuted`). Esfuerzo S cada una.

### E4 — La cámara no sigue al playhead

El literal `scrollX` **no aparece ni una vez** en `playlist-core/state.ts`. Cuando el playhead sale
del encuadre, `isVisible` pasa a `false` y desaparece: lo persigues a mano. Tampoco hay `Shift+0`
para recentrar, ni presets de zoom (`Shift+1..5`, `PgUp/PgDn`), ni smart scrollbar (zoom arrastrando
el extremo del thumb), ni zoom vertical global, ni memoria del encuadre anterior.

Es lo primero que se nota a los diez segundos de reproducir.

### E5 — La automatización no tiene curvas

`PlaylistAutomationPoint` es `{id, time, value}`. Grep de `tension|curve|bezier|easing` en el modelo:
**0 resultados**. El renderer une los puntos con `lineTo` recto.

Eso elimina de golpe el tension handle, el Curve Type Menu con sus 11 tipos, el ajuste fino con Ctrl,
el reset con RMB, y los modos **Step** y **Slide**. También falta un evaluador `valueAtTime()`, sin el
cual no se puede insertar un punto "sin alterar el nivel".

### E6 *(añadido)* — No hay fuente de clip activa

Draw y Paint estampan una copia del **primer clip seleccionado**
([`clip-template.ts:15-27`](../packages/canvas/src/playlist-interaction/tools/clip-template.ts#L15-L27));
sin selección caen a una plantilla dura `#7aa6d8 / "Clip" / pattern` **sin `sourceId`**, así que cada
estampado nace con identidad propia — lo contrario del modelo de instancias de FL. Editar label o
color de una instancia tampoco propaga a sus hermanas.

Invierte el flujo mental: FL es "elijo qué colocar", SliceX es "edito lo que ya hay".

## 5. Bloqueantes (9)

| Operación | Gesto FL | Estado | Esf. | Capa |
|---|---|---|---|---|
| Draw: estampar el clip activo con un click simple | LMB sobre pista vacía | partial | S | inter |
| Marquee temporal con Ctrl desde cualquier tool | Ctrl + LMB drag | missing | S | inter |
| Smart scrollbar: zoom arrastrando el extremo del thumb | LMB drag sobre el borde del handle | missing | M | inter |
| Selección de rango de tiempo en la regla | Ctrl + drag en el bar-ruler | missing | M | core |
| Auto-scroll / la vista sigue al playhead | automático al reproducir | missing | M | core |
| Seleccionar track (Track Selector) | LMB en el selector del header | missing | M | core |
| Selector de clip activo (Clip source menu) | elegir fuente y estampar | partial | L | shell |
| Selección de región temporal por arrastre en el timeline | Ctrl + arrastre horizontal | missing | L | core |
| Arrastrar la tensión / curvatura entre dos puntos | LMB sobre el tension handle | missing | L | core |

## 6. Impacto alto (52) — extracto por esfuerzo

Los de esfuerzo **S** son los de mejor ratio: casi todos viven en `playlist-interaction` y no tocan el
modelo.

| Operación | Gesto FL | Estado | Esf. | Capa |
|---|---|---|---|---|
| RMB en cuerpo de Automation Clip lo borra *(bug B2)* | RMB → añadir control point | partial | S | inter |
| RMB = Delete universal (todas las tools, también desde vacío) | RMB / RMB + barrido | partial | S | inter |
| Bypass de snap con Alt al iniciar el arrastre *(bug B3)* | Alt + LMB drag | partial | S | inter |
| Draw: swap temporal a Paint con Shift | Shift + drag | missing | S | inter |
| Paint: selección con Ctrl | Ctrl + drag | missing | S | inter |
| Zoom in / out con Page Up / Page Down | PgUp / PgDn | missing | S | inter |
| Presets de zoom rápido | Shift+1 / 2 / 3 | missing | S | inter |
| Centrar la vista en el playhead | Shift+0 | missing | S | core |
| Reordenar pistas con la rueda sobre la etiqueta | Shift + wheel | partial | S | inter |
| Menú contextual de la regla: "Add marker" | RMB sobre la timeline | missing | S | inter |
| Botón Play/Pause en la barra del Playlist | LMB | missing | S | shell |
| Draw: colocar y reposicionar antes de soltar | LMB drag | partial | M | inter |
| Draw: arrastre vertical sobre varias tracks | LMB drag vertical | missing | M | inter |
| Paint: avance por longitud de clip, no por paso de snap | LMB drag | partial | M | inter |
| Zoom out total / toggle al encuadre anterior | Shift+4 | missing | M | core |
| Zoom sobre la selección | Shift+5 | missing | M | core |
| Zoom vertical global | drag sobre el control de altura | missing | M | core |
| Insert space / Delete space (ripple) | Ctrl+Ins / Ctrl+Del | missing | M | core |
| Cambiar la pista seleccionada con el teclado | Ctrl + ↑/↓ | missing | M | core |
| Selección múltiple de headers | Ctrl / Shift + click | missing | M | core |
| Plegar / desplegar un grupo desde el header | LMB en la flecha | missing | M | core |
| Menú header: Clone track | RMB header > Clone… | missing | M | core |
| Modo Step / modo Slide en automatización | botón del Clip Settings | missing | M | core |
| Herramienta Playback / "Play selected" (Y) | tecla Y + LMB en clip | missing | M | inter |
| Scroll táctil de dos dedos | 2-finger swipe | missing | M | inter |
| Curve Type Menu (11 tipos) | RMB sobre el punto derecho del segmento | missing | L | core |
| Editor de envolvente real (hoy es un modal stub) | doble click en el clip | partial | L | shell |

*(Lista completa de las 52 en el JSON del run; ver sección 10.)*

## 7. Cola larga (321) por familia

| Familia | Nº | Nota |
|---|---|---|
| Otros (gestos sueltos, hint bar, cursores, misc) | 118 | Incluye la hint bar como contrato global, que hoy no existe |
| Selección y portapapeles | 53 | La mayoría cuelga de E2 (selección temporal) |
| Automatización: curvas, tipos, transformaciones | 41 | Cuelga de E5; flip/scale/normalize/smooth son triviales una vez haya un verbo batch sobre `points[]` |
| Zoom, scroll y encuadre | 19 | Cuelga de E4 |
| Markers y transporte | 19 | Los 9 kinds de marker están modelados pero **ninguno hace nada**: loop no rebota, skip no salta, pause no detiene |
| Menú del Playlist y submenús | 17 | No existe el menú; los comandos que sí existen no son descubribles salvo por atajo |
| Menú del header de track | 14 | Varias son cableado puro (ver E3) |
| Audio clip (fades, gain, reverse, chop, stretch) | 13 | Requieren campos nuevos en `PlaylistClip`. **Fuera de alcance** hasta decidir si el clip financiero tiene análogos |
| Color, nombres y metadata | 13 | Hoy renombrar usa `window.prompt` y recolorear abre el color picker del SO |
| Merge / Consolidate / Quantize | 6 | **Aplazado por D2** |
| Performance mode / live triggering | 3 | Sub-auditado. Propuesta: declararlo **no-objetivo** explícitamente |
| Picker Panel | 3 | Cuelga de E6 |
| Arrangements | 2 | **Sub-auditado y es P0 (D3)** — necesita su propia pasada de spec |

## 8. Ruta recomendada

`Arrangements` es P0 por decisión (D3), pero necesita una pasada de spec propia antes de
implementarse: el audit sólo produjo 2 entradas para toda la familia. Mientras tanto, el bloque de
bugs + gramática es barato y de-riesga todo lo demás.

### ✅ F13 — Estabilidad (completado 2026-08-13)

1. ✅ **B1** — `splitAutomationPoints()` re-corta la envolvente conservando la forma.
2. ✅ **B1b** — el reducer ya no trunca clips en tracks bloqueadas.
3. ✅ **B2** — automation clips excluidos del borrado por RMB **por tipo**, incluido el barrido.
4. ✅ **B2b** — `normalizeState` deja de clampear `point.time`: redimensionar es reversible.
5. ✅ **B3** — eyedropper a **hover + `I`**, liberando `Alt+drag`, `Shift+drag` y `Alt+Shift+drag`.
6. ✅ **B3b** — Paint no estampa encima de un clip existente.
7. ✅ **`Ctrl+T` → `Ctrl+M`**.
8. ✅ **Auditoría de bindings `Alt` frente a AltGr** — sin cambios necesarios: todos los bindings de
   teclado ya exigían `!cmd` (`cmd = ctrlKey || metaKey`), y AltGr llega como `Ctrl+Alt`.

Además se corrigieron, en el mismo bloque, cuatro defectos de los propios helpers nuevos que sacó la
revisión adversarial: ids de la mitad izquierda renumerados (repuntaban una selección viva),
escalones verticales (dos puntos en el mismo `time`) que perdían el punto post-salto, envolventes
vacías que se convertían en una línea plana, y el desfase de la mitad derecha codificado dos veces
(`contentOffset` + puntos rebasados).

Resultado: **334 tests en verde** (eran 314), `check:arch` y `typecheck` limpios.

> **Método.** El bloque se revisó con una pasada adversarial de 23 agentes sobre el diff. Encontró 13
> hallazgos confirmados, de los cuales 6 eran regresiones introducidas por el primer intento de fix.
> Sin esa pasada, `Alt+Shift+drag` y el resize destructivo se habrían dado por corregidos.

### F14 — Spec de Arrangements (P0)

Pasada de manual + diseño de modelo antes de escribir código: qué estado es *per-arrangement*
(clips, markers, ¿alturas de track?) vs global, crear/clonar/renombrar/borrar, copiar contenido entre
arrangements, selector en el shell. Encaja directo con "timelines clonables" del product-spec, así que
la spec debe escribirse contra **ese** documento, no contra FL.

### F15 — Gramática y cámara

Capa de overrides globales (E1), Draw/Paint como en FL (E6 parcial), follow-playhead + presets de zoom
+ smart scrollbar (E4), rueda por zona, transporte visible, menú de la regla, nudge ligado al snap
activo. ~20 cambios, casi todos S, en `playlist-interaction`. Es lo que más sensación FL compra por
unidad de esfuerzo.

### F16 — Estructura del documento

`timeSelection` (E2) y `trackSelection` (E3) en el modelo, con todo lo que cuelga de cada uno. Fuente
activa + Picker Panel (E6 completo). Markers vivos: loop que rebota, skip que salta, time-signature que
afecta regla/grilla/snap.

### F17 — Automatización y superficies

Modelo de curva + tensión (E5), modos Step/Slide, puntos como ciudadanos completos (multi-selección,
menú contextual, hint bar), transformaciones batch de envolvente, Playlist Menu, color selector propio,
renombrado inline, drag & drop de archivos.

## 9. Lo que ya está a la par (y no es poco)

- **Historial**: undo/redo multinivel `past/present/future`, `maxDepth` 200, con tests. Es *mejor* que
  el toggle de FL — divergencia deseable, conviene documentarla.
- **Gestos de clip**: drag, resize, stretch resize, marquee aditivo, grupos que se mueven en bloque,
  clone-drag con `sourceId` heredado, make unique, select all similar.
- **Slip y Slice**: `contentOffset` escalado por `stretchRatio` con badge ↻; slice con guía vertical,
  tooltip B.B.T, corte en release y bypass de snap con Alt. Ambos con tests.
- **Hit-test por capas** con handles de 8 px, y los handles de Automation Clip restringidos a la
  franja del título — exactamente la restricción de FL.
- **Lock de track**: no es cosmético, veta de verdad en `moveClips`, `resizeClip`, `deleteClips`,
  `createClip`, `cloneClipsInPlace` y `removeSelected`.
- **Portapapeles**: copy/cut/paste preservando offsets relativos de tiempo y pista, paste posicional,
  duplicate right.
- **Automation points**: add/move/remove con **lock de eje** (Ctrl fija tiempo, Shift fija valor) —
  paridad exacta con FL.
- **Snap**: los 16 modos de FL declarados y expuestos en su orden. *(Con matices: `line` no es
  adaptativo al zoom y `cell`/`main` están aplanados a beat.)*
- **Track headers**: M/S/L funcionales, reorder por handle, resize por divisor con clamp.
- **Viewport**: pan con MMB, zoom anclado al cursor, scrollbars con thumb y page-jump, culling.
- **Touch**: pinch zoom, long-press e inercia — que FL ni siquiera cubre en su manual.
- **Extras propios**: eyedropper, pulso de grabación, halo de selección, sparkline de patrón,
  inspector de selección.

## 10. Trazabilidad

El run completo (506 interacciones con evidencia `file:line`, veredictos de refutación y las 52
entradas de impacto alto sin recortar) vive en el journal del workflow
`fl-playlist-interaction-gap-audit`. Si se pierde, se regenera: 18 agentes, 6 áreas, ~30 min.

## 11. Ambigüedades declaradas del manual oficial

1. **Snap "Line" adaptativo**: el manual dice que se adapta al zoom pero no da la fórmula. Propuesta:
   el mayor step cuyo ancho en px supere un umbral (~12 px).
2. **"Si no hay selección, se aplica a todo"**: FL lo documenta para Delete, `Ctrl+B` y Shift+flechas.
   Es semántica destructiva y sorprendente. SliceX ya diverge; **recomendación: mantener la
   divergencia** y anotarla, no "arreglarla".
3. **Atajos numéricos desnudos** (zoom con 5/6, reverse con 9, transpose con 7/8): dependen de que
   *typing keyboard to piano keyboard* esté apagado en FL. No son universales.
4. **Chop, zero-crossing, fades, gain/pan, reverse, transpose**: dependen de datos de audio que el
   modelo no tiene. Fuera de alcance hasta que haya decisión de producto.
