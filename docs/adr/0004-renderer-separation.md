# ADR 0004 — Renderer separation (Pixi outside domain)

Date: 2026-04-05

Context
-------
Rendering concerns (performance, lifecycle, headless testing) differ from deterministic business logic.

Decision
--------
Keep rendering code and Pixi integration in `@slicex/canvas`. `@slicex/core` remains IO-free and deterministic.

Consequences
------------
- Easier testing of domain logic without graphics dependencies.
- Renderer can be replaced or optimized independently.
