# Resumen ejecutivo

SliceX es un monorepo modular diseñado para arrancar M1 con fronteras claras entre dominio, UI, y persistencia. El objetivo es proporcionar una base técnica reproducible y segura para construir funcionalidades financieras sin deuda arquitectónica.

Arquitectura y paquetes principales
---------------------------------
- `@slicex/core`: lógica de dominio y cálculos financieros (TypeScript puro, sin IO).
- `@slicex/canvas`: motor gráfico basado en Pixi, renderers y adaptadores para el editor.
- `@slicex/contracts`: DTOs, validaciones y el `ErrorEnvelope` usado por rutas y APIs.
- `@slicex/db`: Prisma schema, migraciones y cliente Prisma singleton.
- `apps/web`: Next.js App Router, route handlers, store (Zustand) y componentes UI.

Modelado de datos (timeline / tenancy)
--------------------------------------
- Los timelines se representan con metadatos en la tabla `timelines` y snapshots JSON en `timeline_revisions.document_json`.
- `head_revision_id` apunta a la revisión activa. Las revisiones permiten mantener historial y diffs sin bloquear lecturas.

Convenciones importantes
-----------------------
- No hacer deep-imports (`@slicex/<pkg>/...`) — usar la API pública del paquete.
- Prisma: todas las consultas y migraciones deben estar en `@slicex/db`.
- Separación de responsabilidades: `@slicex/core` no debe realizar IO.

Flujo de desarrollo local (quickstart)
------------------------------------
1. Instala dependencias:

```powershell
pnpm install
```

2. Genera Prisma client (si cambias schema):

```powershell
pnpm -w --filter @slicex/db prisma generate
```

3. Ejecuta el servidor de desarrollo (monorepo):

```powershell
pnpm dev
```

Comprobaciones y gates locales
------------------------------
- Arquitectura (deep-imports):

```powershell
pnpm -w run check:arch
```

- Entorno local básico (crea `.env.local` si no existe):

```powershell
pnpm -w run check:env
```

- Typecheck y tests:

```powershell
pnpm -w run typecheck
pnpm -w run test:unit
```

Variables de entorno relevantes
------------------------------
- `NEXT_PUBLIC_APP_URL` — URL pública local para la app (`http://localhost:3000`).
- Otras variables de integración (Sentry, Supabase) están esbozadas en `apps/web/src/lib/supabaseServer.ts` y `apps/web/src/instrumentation-client.ts`.

Prisma y migraciones
--------------------
- El schema Prisma está en `packages/db/prisma/schema.prisma`.
- Para desarrollar localmente: crear una base de datos local, ejecutar `pnpm -w --filter @slicex/db prisma migrate dev` y luego `pnpm -w --filter @slicex/db prisma generate`.

Testing y CI
------------
- Unit tests: Vitest (`pnpm -w run test:unit`).
- E2E: Playwright (`pnpm -w run test:e2e`).
- CI: ver `.github/workflows/ci.yml` — incluye checks de imports, typecheck y tests.

Dónde mirar para más detalles
-----------------------------
- ADRs y decisiones de arquitectura: `docs/adr/`.
- Scripts operativos y utilidades: `scripts/` (ej: `check-imports.mjs`, `sync-env.mjs`).
- Ownership y workflow: [AGENTS.md](AGENTS.md)

Notas operativas
----------------
- Si modificas `@slicex/contracts`, asegúrate de versionar los cambios y coordinar a los equipos consumidores.
- Antes de mergear PRs grandes, ejecutar `pnpm -w run check:fast` para evitar regresiones en ownership y env.

Este archivo es el resumen operativo del repo; mantenerlo breve y actualizado. Para cambios mayores, añadir un ADR en `docs/adr`.
