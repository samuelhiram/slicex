# @slicex/canvas

Renderer and Pixi integration for SliceX editor. This package exposes a
renderer API, an interaction command controller, and a small React wrapper
for mounting the Pixi application.

It should not perform network IO; IO belongs to `apps/web` or adapters.

Usage:

```tsx
import {
	CanvasRenderer,
	createCanvasInteractionController,
} from "@slicex/canvas";
```
