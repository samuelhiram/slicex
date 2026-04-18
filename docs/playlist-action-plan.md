# Playlist Action Plan

Fuente: FL Studio Playlist y Automation Clips, Image-Line manual.

## Fase 1 - Base limpia
- Reemplazar la pantalla inicial de `apps/web/src/app/page.tsx`.
- Montar un canvas Pixi único desde `apps/web/src/components/PlaylistShell.tsx`.
- Mantener código viejo si no estorba tests; no usarlo en la ruta default.
- Salida: `localhost` abre directo el Playlist demo.

## Fase 2 - Core
- Crear `packages/canvas/src/playlist-core/*`.
- Definir viewport, tracks, clips, automation clips, puntos, selección, snap.
- Implementar tiempo-px, track-y, hit geometry base y mutations puras.
- Salida: estado real vive fuera de Pixi/React.

## Fase 3 - Interacción
- Crear `packages/canvas/src/playlist-interaction/*`.
- Resolver hover, drag clip, resize left/right, cambio de track, marquee, pan, zoom.
- Editar puntos: mover, agregar, eliminar. Modifiers: Alt sin snap, Shift bloquea vertical, Ctrl bloquea horizontal.
- Salida: interacción end-to-end sobre `playlist-core`.

## Fase 4 - Render Pixi
- Crear `packages/canvas/src/playlist-renderer-pixi/*`.
- Pintar grid, ruler, tracks, clips, title bars, handles, overlays, automation curves y puntos.
- Salida: renderer solo pinta estado.

## Fase 5 - Integración final
- Exportar módulos desde `packages/canvas/src/index.ts`.
- Ajustar CSS para pantalla principal.
- Crear `docs/playlist-manual-test.md`.
- Ejecutar `pnpm install`, typecheck y `pnpm dev`.
- Salida: app lista en localhost con demo interactiva.
