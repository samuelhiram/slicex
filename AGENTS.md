# Reglas de ownership y workflow para colaboradores y agentes

Propósito
---------
Documentar las responsabilidades por capa y las reglas de colaboración para evitar deuda arquitectónica y mantener fronteras limpias entre paquetes.

Ownership por capa
------------------
- `@slicex/core`: dominio y lógica financiera (TypeScript puro, sin IO). Aquí vive la lógica que debe ser determinista y testeable.
- `@slicex/canvas`: renderer Pixi y adaptadores gráficos (sin fetch ni auth). Implementaciones gráficas y optimizaciones de render.
- `@slicex/contracts`: DTOs, validaciones y el `ErrorEnvelope` compartido (contratos entre capas).
- `@slicex/db`: Prisma schema, migraciones y el cliente Prisma singleton.
- `apps/web`: Next.js (App Router), routing HTTP, store (Zustand) y wiring de UI + adapters.

Principios y reglas básicas
--------------------------
- Una sola fuente de verdad por concepto: tipos y reglas de negocio en `@slicex/core`.
- Separación IO/negocio: IO (fetch, DB, auth) en `apps/*` o `@slicex/db`; `@slicex/core` no debe realizar IO.
- Evitar deep-imports entre paquetes. Usa la API pública del paquete (`@slicex/<paquete>`) en lugar de `@slicex/<paquete>/src/...`.

Prohibiciones (ejemplos)
-----------------------
- No usar imports del estilo `@slicex/core/utils/x` desde otras capas; importa `@slicex/core` únicamente.
- No ejecutar consultas Prisma fuera de `@slicex/db`.
- No implementar lógica financiera (cálculos, reglas de impuestos, etc.) dentro de componentes React.

Automatización y comprobaciones
-------------------------------
- El repositorio incluye `scripts/check-imports.mjs` que detecta imports profundos y viola la regla de ownership. Ejecutar:

```
pnpm -w run check:arch
```

- Para sincronizar/validar env local:

```
pnpm -w run check:env
```

- Las comprobaciones se agrupan en `check:fast` y se ejecutan en el hook `pre:commit` del monorepo.

Branching y convenciones de commits
----------------------------------
- Branches: `feature/<desc>`, `fix/<desc>`, `chore/<desc>`, `hotfix/<desc>`.
- Mensajes de commit: usar el formato `type(scope): short description`. Ej: `feat(core): add recurrence rule`.
- Abrir PR contra `main`. Todas las PRs deben pasar `check:fast` en la CI y tener al menos una revisión aprobatoria.

Proceso de PR y revisiones
--------------------------
- Antes de pedir revisión: ejecutar `pnpm -w install`, `pnpm -w run typecheck` y `pnpm -w run test:unit` localmente.
- Incluir pruebas unitarias para cambios de lógica y actualizar `@slicex/contracts` si se cambian DTOs.

Uso responsable de agentes/IA
----------------------------
- Si se usa generación de código asistida por IA: documentar exactamente qué se generó, por qué, y añadir tests que validen el comportamiento.
- No mergear cambios generados por IA sin revisión humana y sin pruebas que cubran los cambios.

Cómo añadir un nuevo paquete
---------------------------
1. Crear carpeta `packages/<nombre>` con `package.json` que use el scope `@slicex/<nombre>`.
2. Añadir `src/` y un `tsconfig.json` (extiende `tsconfig.base.json`).
3. Añadir tests en `tests/` y script `test` en su `package.json`.
4. Actualizar `pnpm-workspace.yaml` si es necesario (normalmente no, usa `packages/*`).
5. Registrar el ownership en este archivo si aplica a una capa ya existente.

Enforcement / CI
----------------
- La CI ejecuta `pnpm -w run check:arch`, `pnpm -w run typecheck` y `pnpm -w run test:unit` (ver `.github/workflows/ci.yml`).
- Si una comprobación falla, abrir una PR con la corrección y enlazar la salida de CI.

Contacto y propietarios
----------------------
- Owners por capa (ejemplo):
  - `@slicex/core` — equipo Core
  - `@slicex/canvas` — equipo Canvas
  - `@slicex/db` — equipo Infra/DB
  - `apps/web` — equipo Frontend

Mantener este documento actualizado: cuando cambie el ownership o se añada una regla, actualiza `AGENTS.md` y referencia los ADRs correspondientes.
