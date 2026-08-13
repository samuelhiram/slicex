# FL Playlist Parity Spec

Fuente: Image-Line FL Studio Playlist y Automation Clips, manual oficial.
Estado: cierre de Fase 8 (parity de comportamiento + visual SliceX).

## Ruler
- Click izquierdo en ruler: seek inmediato a tiempo bajo cursor.
- Drag desde ruler: scrub continuo del Play Position Marker.
- Labels de compas se generan desde `scrollX + zoom`, no desde ancho total.
- Grid sigue al ruler.
- Hover en ruler emite tooltip "bar.beat.tick" cerca del cursor (F3).

## Play Position Marker
- Estado real: `playlist-core.playPosition.time`.
- Renderer calcula `screenX = worldToScreenX(playPosition.time)`.
- Marker visible en ruler y linea vertical en tracks.
- Drag del marker actualiza tiempo real + emite tooltip B.B.T (F3).
- Pan/zoom recalcula pantalla desde estado; no hay drift.
- Space alterna avance demo con RAF, sin audio real.

## Clips
- Tracks multiproposito: audio, pattern y automation pueden vivir en cualquier track.
- Body: drag/move (mueve grupos completos cuando el clip pertenece a uno, F6).
- Title bar: label y resize valido.
- Resize left/right: ajusta start/duration con minimo, emite tooltip B.B.T (F3).
- Selection simple: click.
- Marquee: drag en vacio.
- Snap: activo por defecto; Alt lo ignora.
- Drag emite snap-indicator vertical (F3) y drop-ghost en destino (F3).
- Dot 3px en esquina superior derecha cuando el clip esta en un grupo y
  esta hovered (F6).
- Halo + stroke 2.5px en seleccion (F10).
- Clips pattern muestran sparkline interna (F9).

## Slip tool (S)
- LMB-drag dentro de un clip desliza el contenido interno (`contentOffset`)
  sin mover `start`/`duration`. Arrastrar a la derecha corre el contenido a
  la izquierda bajo la ventana del clip.
- El delta se mide en beats de contenido: un beat de pantalla equivale a
  `stretchRatio` beats de contenido (`offset -= deltaScreen * stretchRatio`).
- Tooltip "↻ offset" sigue al cursor durante el drag; el clip además pinta un
  badge ↻ persistente cuando `|offset| > 0`.
- Acepta hit en clip body, automation body o handles de resize.
- Track bloqueado: no-op. Un drag completo = una entrada de undo.

## Slice tool (C)
- LMB-drag dibuja una guía vertical (reusa el snap-indicator) en el punto de
  corte; tooltip B.B.T sigue al cursor.
- Al soltar, todo clip cuyo cuerpo cruza ese tiempo se parte en dos: la mitad
  izquierda conserva `start` y se trunca a `time - start`; la derecha es un
  clip nuevo con id fresco, `sourceId` heredado y `contentOffset` ajustado al
  punto de corte (`baseOffset + (time - start) * stretchRatio`).
- Snap activo por defecto; Alt lo ignora. El corte se ignora en `t ≤ 0` o si
  no cruza ningún clip. Tracks bloqueados se saltan.
- La tecla Insert reusa el mismo corte en el playhead.
- Un corte = una entrada de undo.

## Drag-to-create (Draw tool)
- LMB en empty con Draw tool: clip-create-drag.
- Clip se crea al cruzar `minClipDuration` past snapped start; movimientos
  siguientes ajustan el borde derecho (F4).
- Double-click empty: crea clip default-sized sin gesture (F4).

## Double-click clip
- Cualquier tool, doble click en clip: emite CustomEvent
  `playlist-clip-open` con `{ clipId }`. El shell React abre modal stub
  (F4). Hook para el editor financiero futuro.

## Eyedropper (Alt+click on clip)
- Alt + click LMB en clip: recolora la seleccion actual al color del clip
  clickeado. Sin seleccion, recolora el clip clickeado (F7).
- Alt + click en ruler/empty sigue siendo snap-bypass (no interfiere).

## Group / Ungroup
- Ctrl+G: groupSelection assigns un nuevo groupId a los clips seleccionados.
- Ctrl+Shift+G: ungroupSelection limpia los groupIds (F6).
- Drag de un clip agrupado: arrastra todos sus hermanos con el mismo delta
  (auto-expansion en `PlaylistCore.moveClips` + `expandSelectionToGroups`).
- Paste: regenera groupIds (un grupo pegado es sibling, no copia que arrastre
  al original).

## Arrow keys + End / Home
- Sin seleccion: ←→ mueve playhead.
- Con seleccion: ←→ nudge horizontal (Shift = ×4, Ctrl/Cmd = 1 bar), ↑↓
  nudge vertical de tracks (F5).
- Home: playhead a 0. End: playhead a contentEnd (F5).

## Automation Clips
- Tipo separado `automation`.
- Body muestra polilinea y puntos.
- Punto: click/drag mueve.
- Right click en body: agrega punto.
- Right click en punto: elimina punto si quedan minimo 2.
- Shift al mover punto: bloquea valor.
- Ctrl al mover punto: bloquea tiempo.
- Resize desde title bar/handles superiores.

## Viewport
- `scrollX`, `scrollY`, `pxPerBeat` viven en core.
- Wheel: scroll vertical.
- Shift+wheel: scroll horizontal.
- Ctrl+wheel: zoom horizontal anclado al cursor.
- Mouse medio + drag: pan X/Y.
- Scrollbar horizontal: drag mueve `scrollX` como camara virtual.
- Scrollbar vertical: drag mueve `scrollY` como camara virtual.
- Coordenadas screen nunca son verdad.

## Touch (F8)
- 2 dedos: pinch zoom anclado al midpoint (mismo math que Ctrl+wheel).
- Long-press (500ms, <6px move): abre context menu del hit.
- Flick pan/scroll: inertia decay 0.95/frame hasta SETTLE_EPSILON.
- Cualquier nuevo pointerdown cancela inertia.

## Track Headers
- Columna izquierda es panel opaco, no grid transparente.
- Cada header tiene fondo solido, texto legible, color strip y divisor alineado con track row.
- Header es zona interactiva propia.
- Right click en header abre menu contextual custom del track.
- Tracks reales sin clips muestran microtext "—" (F10).

## Tracklist Context Menu
- Abre en posicion del cursor.
- Click fuera cierra.
- Acciones: Delete track content, Delete selected clips on track, Rename track, Recolor track, Insert track below, Delete empty track.
- Delete selected aparece dirigido al track con seleccion.
- Clear borra contenido del track correcto.
- Menu vive en estado/interaccion; renderer solo dibuja.

## Recording pulse (F10)
- R hotkey toggles `transport.recording`.
- Mientras recording=true, el renderer dispara rAF dedicado que pinta una
  banda 2px en el borde superior con alpha breathing (0.5 ↔ 1).
- rAF se cancela cuando recording vuelve a false (canon §3.11).

## Hit-Testing
Prioridad:
1. Play Position Marker en ruler.
2. Menu contextual abierto.
3. Scrollbar H/V.
4. Track header.
5. Automation point.
6. Resize left/right.
7. Automation body.
8. Clip body/title.
9. Ruler.
10. Empty/marquee.

## Zonas
- `clip body`: mueve clip.
- `title bar`: selecciona/mueve; en automation habilita resize.
- `resize left`: borde izquierdo.
- `resize right`: borde derecho.
- `automation body`: agrega punto con right click.
- `automation point`: mueve/elimina punto.
- `ruler`: seek/scrub.
- `play position marker`: drag directo.
- `track header`: seleccion contextual del track.
- `scrollbar horizontal`: drag pan X.
- `scrollbar vertical`: drag pan Y.

## World vs Screen
- Tiempo/world: beats positivos.
- `worldToScreenX(time) = trackHeaderWidth + time * pxPerBeat - scrollX`.
- `screenToWorldX(x) = (x - trackHeaderWidth + scrollX) / pxPerBeat`.
- `trackToY(index) = rulerHeight + index * trackHeight - scrollY`.
- `yToTrack(y) = floor((y - rulerHeight + scrollY) / trackHeight)`.
- Guardar siempre tiempo/track; nunca screen como verdad.

## Virtualizacion
- Timeline no tiene ancho total principal.
- Renderer dibuja visible + overscan.
- Tracks no tienen limite visual.
- Tracks reales se materializan solo cuando un clip cae en track virtual.
- Filas virtuales se pintan bajo demanda.
- Scrollbars usan rango virtual movil; no representan documento finito rigido.

## Inspector (F11)
- Right-side rail, collapsed por defecto, toggle ◀/▶.
- Selección única: label / color / mute / contentOffset / stretchRatio /
  groupId (readonly + Ungroup).
- Multi-selección: contador + batch mute/unmute/group/ungroup.
- Suscripción granular: re-renders sólo cuando cambia la identity del
  clip enfocado o la lista de clipIds seleccionados.
