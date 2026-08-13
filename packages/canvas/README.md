# @slicex/canvas

Motor del playlist de SliceX: modelo, interacción y renderer Pixi. No hace IO de red — eso vive en
`apps/web` o en adapters.

El paquete está partido en tres capas con frontera dura, y esa separación es un requisito de
portabilidad (web → Android → iOS), no un gusto de estilo:

- **`playlist-core`** — modelo, geometría, estado, reducer, historial y la **presentación derivada**
  que consume el renderer. Sin Pixi, sin React.
- **`playlist-interaction`** — controller de gestos (pan, zoom, drag, resize, marquee, automation,
  scrollbars, slip, slice…), hit-testing y una implementación por herramienta de toolbar en
  `tools/`.
- **`playlist-renderer-pixi`** — dibujo por capas sobre Pixi 8. Sólo proyecta la presentación; no
  guarda verdad del modelo.

## Uso

```ts
import {
  createPlaylistCore,
  createDemoPlaylistState,
  createPlaylistInteractionController,
  createPlaylistRenderer,
} from "@slicex/canvas";

const core = createPlaylistCore(createDemoPlaylistState());
const renderer = createPlaylistRenderer(hostElement, core);
const controller = createPlaylistInteractionController(hostElement, core);
```

Ver [PlaylistShell.tsx](../../apps/web/src/components/PlaylistShell.tsx) para el montaje real.

## Reglas al tocar este paquete

**Leer [docs/performance-canon.md](../../docs/performance-canon.md) antes de escribir código aquí.**
Es una regla dura: cero allocations en steady-state render, el reducer no recrea estado sin cambio
real, y los budgets de [tests/perf-budget.spec.ts](tests/perf-budget.spec.ts) no se relajan para
hacer pasar una suite. Un budget que falla es un bug real.

El contrato de comportamiento frente a FL Studio vive en
[docs/fl-playlist-parity-spec.md](../../docs/fl-playlist-parity-spec.md).
