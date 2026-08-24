# Playlist Manual Test

Fuente UX: FL Studio Playlist y Automation Clips, manual Image-Line.

## Setup
- `pnpm install`
- `pnpm dev`
- Abrir `http://localhost:4321`
- Ver Playlist demo directo.

## Clips
- Clip body: arrastrar horizontal.
- Clip body: mover entre tracks.
- Borde izquierdo: resize.
- Borde derecho: resize.
- Drag en vacio: marquee selection.
- Right click clip: menu contextual.
- Doble click clip: abre modal stub "Clip details" (F4).
- Doble click en area vacia (Draw tool): crea clip default.

## Viewport
- Wheel: scroll vertical.
- Shift + wheel: scroll horizontal.
- Ctrl + wheel: zoom anclado al cursor.
- Mouse medio + drag: pan.
- Scrollbar horizontal: drag navega derecha/izquierda.
- Scrollbar vertical: drag navega arriba/abajo.

## Ruler & Play position
- Ruler click: mueve Play Position Marker.
- Marker drag: scrub.
- Pan/zoom: marker queda alineado.
- Space: marker avanza/pausa sin audio.
- Hover ruler: tooltip "bar.beat.tick" flotante (F3).
- Marker drag: tooltip sigue cursor con B.B.T (F3).

## Automation Clips
- Automation point: mover.
- Shift + drag point: bloquea vertical.
- Ctrl + drag point: bloquea horizontal.
- Alt + drag/resize: ignora snap.
- Right click automation body: agrega punto.
- Right click punto: elimina punto.
- Automation title/handles: resize.

## Track headers
- Track headers: opacos, solidos, legibles.
- Right click track header: menu custom.
- Menu: Delete track content limpia track correcto.
- Menu: Delete selected clips on track borra seleccion del track.
- Menu: Rename track cambia label.
- Menu: Recolor track cambia color.
- Menu: Insert track below inserta fila.
- Menu: Delete empty track elimina fila vacia.
- Tracks reales sin clips muestran microtexto "—" en el header (F10).

## Virtualizacion
- Scroll abajo: aparecen tracks vacias.
- Drag clip bajo ultima track real: crea track.
- Scroll derecha: timeline sigue sin borde visible.
- Renderer pinta viewport + overscan.
- Estado real vive en `playlist-core`.

## F3 — Overlays visuales
- Drag de clip: tooltip "B.B.T" flotante cerca del cursor.
- Drag de clip: ghost outline en destino snapped (mas visible con snap=events).
- Drag de clip: linea vertical fina marca proximo snap point.
- Alt + drag: linea snap se oculta (snap bypass).
- Release: tooltip, ghost y snap line desaparecen.

## F4 — Draw tool: drag-to-create + dblclick
- Draw tool (P): drag desde area vacia → clip se crea cuando cruzas
  minClipDuration; ancho sigue al cursor.
- Draw tool + double-click en vacio: crea clip default sin gesture.
- Cualquier tool + double-click en clip existente: abre modal stub.

## F5 — Arrow keys + End
- Sin selección + ←→: mueve playhead 1 beat por tecla.
- Selección + ←→: nudge horizontal de la selección (Shift = ×4 step,
  Ctrl/Cmd = 1 bar).
- Selección + ↑↓: cambia track de la selección (clamp en track 0).
- Home: playhead a t=0.
- End: playhead al final del ultimo clip.

## F6 — Group / Ungroup clips
- Selecciona 2+ clips + Ctrl+G: les asigna mismo groupId.
- Ctrl+Shift+G: limpia groupIds de la selección.
- Hover sobre clip agrupado: dot 3px en esquina superior derecha (accent).
- Drag de un clip agrupado: arrastra todos sus hermanos con el mismo delta.
- Paste de grupo: nuevo groupId (no comparte con original).
- Inspector: muestra groupId y boton Ungroup en seleccion única.

## F7 — Eyedropper (hover + I)
- Cursor sobre un clip + tecla **I**: recolora la seleccion actual al color de
  ese clip (o el clip bajo el cursor si no hay seleccion).
- **F13:** el eyedropper salio del espacio de modificadores. Verificar que los
  tres gestos de arrastre quedaron libres, con snap en "beat":
  - Alt + drag: mueve el clip **sin snap** (posicion fraccionaria).
  - Shift + drag: clona.
  - Alt + Shift + drag: clona **sin snap**.
- Alt + click en ruler/empty sigue siendo snap-bypass (no interfiere).
- Redimensionar un automation clip hacia dentro y volver a estirarlo **debe
  restaurar los puntos**: el clip es una ventana sobre la envolvente.

## F8 — Touch refinement
- Pinch zoom (2 dedos): pxPerBeat escala anclado al midpoint.
- Long-press (~500ms con < 6px de movimiento): abre context menu segun
  el hit (clip / track / marker / background).
- Flick pan: scroll inertia con momentum decay 0.95/frame.
- Cualquier tap nuevo cancela inertia.

## F9 — Pattern clip sparkline
- Clips type=pattern con width≥60 y height≥18: muestran 8-19 barritas
  pseudo-aleatorias deterministas (hash del clip.id).
- Las barras son visuales — el motor financiero futuro puede sustituir
  con datos reales via `setSparklineProvider`.

## F10 — Recording pulse + halo + empty cue
- R (recording): borde superior del playlist pulsa entre alpha 0.5 y 1.
- Clip seleccionado: outer-glow halo 1px alpha 0.35 + stroke interior
  2.5px en accent (más visible que el outline normal).
- Tracks reales sin clips: microtext "—" en header.

## F11 — Inspector panel
- Toggle ◀/▶ en el borde derecho abre/cierra el panel.
- Selección única: editar label (debounced 60ms), color, mute, slip
  (contentOffset), stretch ratio, ver/ungroup groupId.
- Multi-selección: contador + acciones batch (mute / unmute / group /
  ungroup).
- Cambios se reflejan en vivo en el canvas.

## Slip / Slice tools
- Slip (S): arrastrar dentro de un clip desliza su contenido; aparece tooltip
  "↻ offset" siguiendo el cursor y el badge ↻ en el clip. Arrastrar derecha
  baja el offset, izquierda lo sube. Un drag = un undo.
- Slice (C): arrastrar muestra una línea vertical de corte + tooltip B.B.T; al
  soltar parte en dos cada clip que cruce ese tiempo. La mitad derecha es un
  clip nuevo contiguo. Alt ignora snap.
- Slice en `t ≤ 0` o fuera de todo clip: no hace nada.
- Insert: corta todos los clips visibles en el playhead (mismo corte).
- Undo restaura el clip original tanto para slip como para slice.

## Tools & snap
- Toolbar (Select/Draw/Paint/Delete/Mute/Slip/Slice/Zoom): hotkeys
  E/P/B/D/T/S/C/Z.
- Snap dropdown: 15 modos (line/cell/none/events/sixth-step…bar).
- Backspace: toggle snap "none" ↔ último modo.

## Marker hotkeys
- Alt+T: marker generico en playhead.
- Alt+Shift+T: marker time-signature en playhead.
- Ctrl+M: marker auto-nombrado. **F13:** era Ctrl+T, que el navegador reserva
  para "nueva pestana" y no es cancelable — el marker nunca se creaba.

## Transport hotkeys
- L: toggle song / pattern mode.
- R: toggle recording (pulse visible).
- Shift+M: toggle stretch mode.
- Insert: slice todos los clips visibles en playhead.

## Selección / clipboard
- Ctrl+A: select all clips.
- Ctrl+D: deselect.
- Shift+I: invert.
- Alt+M / Shift+Alt+M: mute / unmute selection.
- Ctrl+C / Ctrl+X / Ctrl+V: copy / cut / paste.
- Ctrl+B: duplicate right.
- Shift+C: select all clips sharing source.
- Backspace / Delete: remove selection.
- Ctrl+Z / Ctrl+Y (o Ctrl+Shift+Z): undo / redo.
