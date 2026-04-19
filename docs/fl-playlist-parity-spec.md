# FL Playlist Parity Spec

Fuente: Image-Line FL Studio Playlist y Automation Clips.

## Ruler
- Click izquierdo en ruler: seek inmediato a tiempo bajo cursor.
- Drag desde ruler: scrub continuo del Play Position Marker.
- Labels de compas se generan desde `scrollX + zoom`, no desde ancho total.
- Grid sigue al ruler.

## Play Position Marker
- Estado real: `playlist-core.playPosition.time`.
- Renderer calcula `screenX = worldToScreenX(playPosition.time)`.
- Marker visible en ruler y linea vertical en tracks.
- Drag del marker actualiza tiempo real.
- Pan/zoom recalcula pantalla desde estado; no hay drift.
- Space alterna avance demo con RAF, sin audio real.

## Clips
- Tracks multiproposito: audio, pattern y automation pueden vivir en cualquier track.
- Body: drag/move.
- Title bar: label y resize valido.
- Resize left/right: ajusta start/duration con minimo.
- Selection simple: click.
- Marquee: drag en vacio.
- Snap: activo por defecto; Alt lo ignora.

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

## Track Headers
- Columna izquierda es panel opaco, no grid transparente.
- Cada header tiene fondo solido, texto legible, color strip y divisor alineado con track row.
- Header es zona interactiva propia.
- Right click en header abre menu contextual custom del track.

## Tracklist Context Menu
- Abre en posicion del cursor.
- Click fuera cierra.
- Acciones: Delete track content, Delete selected clips on track, Rename track, Recolor track, Insert track below, Delete empty track.
- Delete selected aparece dirigido al track con seleccion.
- Clear borra contenido del track correcto.
- Menu vive en estado/interaccion; renderer solo dibuja.

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
