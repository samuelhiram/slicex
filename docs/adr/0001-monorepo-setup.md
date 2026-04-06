# ADR 0001 — Monorepo setup: pnpm workspaces + Turborepo

Date: 2026-04-05

Context
-------
We want a fast developer flow, good caching, and workspace-level scripts for a multi-package architecture.

Decision
--------
Use `pnpm` workspaces for package management and `turbo` (Turborepo) for task orchestration and caching.

Consequences
------------
- Fast install and workspace-local linking with `pnpm`.
- `turbo` provides incremental builds and caching for `dev`/`build` pipelines.
