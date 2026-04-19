# Header Occlusion Fix

## Causa exacta

El renderer dibujaba el contenido del timeline en la misma capa visual que el resto del playlist sin una mascara real para el area de timeline. Como resultado, cuando el scroll horizontal desplazaba clips, automation o overlays con `x < trackHeaderWidth`, esos elementos podian seguir renderizandose por debajo o a traves del panel izquierdo en lugar de quedar recortados por el borde del header.

## Archivos tocados

- [packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts](packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts)
- [docs/header-occlusion-fix.md](docs/header-occlusion-fix.md)

## Superficie revisada

- [packages/canvas/src/playlist-core/presentation.ts](packages/canvas/src/playlist-core/presentation.ts)
- [packages/canvas/src/playlist-core/geometry.ts](packages/canvas/src/playlist-core/geometry.ts)

## Solucion aplicada

Reorganicé el renderer en capas separadas y aplique una mask real al contenido del timeline usando `layout.timelineRect`. El contenido del timeline ahora se dibuja dentro de una capa maskeada, mientras que el panel izquierdo, el ruler y el chrome superior se dibujan por encima como capas opacas. Eso evita que clips, labels, automation lines y automation points puedan atravesar visualmente el area de track headers.

## Validacion manual

- Verifique en el browser que el panel izquierdo permanece opaco y que no aparecen clips ni automation atravesando el header al desplazar horizontalmente el timeline.
- Verifique que los clips y la automation siguen visibles dentro del area del timeline y desaparecen al cruzar el borde del header.
- Verifique que ruler, play position marker, scrollbars y context menu siguen renderizando y que `drag`/`resize`/`select` no se rompen.
- Validaciones ejecutadas: `pnpm -w run typecheck`, `pnpm -w run test:unit`, `pnpm --filter apps-web build`, `pnpm -w run check:arch`.
