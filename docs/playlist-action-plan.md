# Playlist Action Plan

Fuente UX: FL Studio Playlist y Automation Clips, manual Image-Line.

> **Estado: fases 1–6 ejecutadas.** Este documento es el plan original; se conserva como registro de
> intención, no como lista de pendientes. El trabajo posterior (fases 7–8, hitos F1–F12: herramientas
> de toolbar, grupos, markers, touch, sparklines, inspector, slip/slice) está descrito en
> [fl-playlist-parity-spec.md](fl-playlist-parity-spec.md), que es el contrato vigente, y se prueba
> con [playlist-manual-test.md](playlist-manual-test.md).

## Fase 1 - Diagnostico y reemplazo controlado
- Actual sirve: `playlist-core`, `playlist-interaction`, `playlist-renderer-pixi`, `PlaylistShell`.
- Estorba: header izquierdo poco separado, sin menu tracklist, sin scrollbars virtuales.
- Ruta final: `apps/web/src/App.tsx` (era `src/app/page.tsx` cuando se escribió el plan, en la era Next.js).
- Salida: `localhost` abre el Playlist demo directo.

## Fase 2 - Core
- Mantener estado real en `packages/canvas/src/playlist-core`.
- Agregar `playPosition` formal.
- Exponer `worldToScreenX`, `screenToWorldX`, `trackToY`, `yToTrack`.
- Timeline positivo no acotado.
- Tracks virtuales y materializacion automatica al mover clips.
- Scroll model virtual H/V.
- Context menu state por track.
- Acciones: clear track, delete selected on track, rename, recolor, insert below, delete empty.
- Salida: modelo no depende de Pixi, React ni ancho fijo.

## Fase 3 - Interaccion
- Ajustar hit-testing por prioridad.
- Ruler: click seek.
- Play Position Marker: drag y seek continuo.
- Clips: select, marquee, drag, resize, cambio de track.
- Viewport: pan middle, Ctrl+wheel zoom anclado, scroll libre.
- Automation: mover/agregar/eliminar puntos; Alt sin snap, Shift vertical lock, Ctrl horizontal lock.
- Track header: right click abre menu custom.
- Scrollbars: drag H/V mueve camara virtual.
- Salida: gestos FL esenciales end-to-end.

## Fase 4 - Render Pixi
- Ruler dinamico por viewport.
- Grid dinamico por viewport.
- Tracks visibles + overscan, incluyendo virtuales.
- Track headers opacos y legibles.
- Clips visibles.
- Automation curves/puntos.
- Selection overlay.
- Play Position Marker y linea vertical.
- Scrollbars H/V visuales.
- Menu contextual custom dibujado por Pixi.
- Salida: renderer solo proyecta estado core.

## Fase 5 - Infinito visual
- Eliminar dependencia de `maxBeats`/`totalWidth`.
- Eliminar limite UX por `tracks.length`.
- Scroll horizontal como camara.
- Scroll vertical como camara.
- Crear tracks al soltar/arrastrar clips bajo la ultima track real.
- Scrollbars desacopladas de documento finito.
- Salida: derecha y abajo siguen visualmente sin topar.

## Fase 6 - Integracion final
- Demo data lista por defecto.
- `docs/fl-playlist-parity-spec.md` actualizado.
- `docs/playlist-manual-test.md` actualizado.
- Ejecutar `pnpm install`, `pnpm dev`, typecheck, checks y prueba manual/Playwright.
- Salida: app funcional inmediata.
