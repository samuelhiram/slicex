# Timeline Grid Bleed Fix

> **Histórico (2026-04-19).** Nota del fix de fuga de grid sobre los clips. Menciona
> `http://localhost:3000`, puerto anterior al move a **4321**. No asumir que refleja el código actual.

## Causa exacta

El problema no era el z-order principal del Playlist ni el clipping del timeline. El timeline ya estaba maskeado correctamente. La fuga visual venia de dos cosas:

- Los clips se pintaban con fills translucidos en la capa de contenido.
- La malla vertical del timeline seguia pintandose en la capa chrome, por encima del contenido de clips, asi que las lineas de grid seguian siendo visibles dentro de los items aunque el timeline estuviera clippeado.

## Estado de capas encontrado

La estructura ya estaba separada en:

- `sceneGraphics`
- `timelineMask`
- `timelineContainer`
- `chromeGraphics`
- `foregroundGraphics`

Dentro de `timelineContainer` ya existian subcapas para grid, clip content, labels y overlay. El fallo estaba en el contrato visual, no en la existencia de las capas: parte de la malla seguia saliendo por `chromeGraphics` y los cuerpos de clip no eran opacos.

## Solucion aplicada

Reforze la separacion de responsabilidades del renderer asi:

- La malla vertical vive solo en `timelineGridGraphics`.
- Los cuerpos de clip se pintan en `clipGraphics` con fill opaco.
- Los labels viven en `clipTextLayer`.
- Los estados hover/selected, handles, automation y marquee viven en `overlayGraphics`.
- La capa chrome se queda solo con el ruler, el separador del header, los labels del ruler y el chrome del panel izquierdo.

Tambien movi las lineas verticales de tick fuera del pass chrome para que no vuelvan a aparecer por encima de los clips.

## Archivos tocados

- [packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts](../packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts)
- [docs/timeline-grid-bleed-fix.md](timeline-grid-bleed-fix.md)

## Validacion manual

- La malla ya no se ve a traves de clips normales.
- La malla ya no se ve a traves de automation clips.
- Los labels siguen legibles.
- Los estados selected/hover siguen claros.
- El playhead sigue correcto.
- El ruler sigue correcto.
- Los scrollbars siguen correctas.
- El clipping del timeline sigue funcionando.
- Drag/resize/select siguen respondiendo.
- El right-click no rompio el foreground; no se observo clipping ni solapamiento anomalo en la zona del menu contextual.
- La verificacion visual se hizo en `http://localhost:3000` tras recargar la vista.

## Validacion automatica

- `pnpm -w run typecheck`
- `pnpm -w run test:unit --run`
- `pnpm --filter apps-web build`
