# Contributing to SliceX

Branching & commits

- Branches: `feature/<desc>`, `fix/<desc>`, `chore/<desc>`, `hotfix/<desc>`.
- Commit message format: `type(scope): short description` (e.g. `feat(core): add recurrence rule`).

Pre-PR checklist

1. Ejecuta `pnpm install`.
2. Ejecuta `pnpm -w run check:fast` (equivale a `check:arch` + `check:env`).
3. Ejecuta `pnpm -w run typecheck` y `pnpm -w run test:unit`.

Review

- Abre PR contra `main` (o la rama destino acordada). Asegúrate que la CI pase y añade reviewers.

Code generation via AI

- Document what the AI generated, add tests for generated code, and never merge without human review.
