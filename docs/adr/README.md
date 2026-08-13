# ADRs

⚠️ **Ojo con la numeración.** Conviven **dos series** escritas por separado el mismo día
(2026-04-05) que reusan los números 0001–0004. No están renumeradas para no romper enlaces
existentes; usa el nombre completo del archivo al referenciarlas, nunca sólo el número.

## Serie larga (formato ADR completo, con fecha y contexto)

| Archivo | Decisión | Estado |
|---|---|---|
| [0001-monorepo-setup.md](0001-monorepo-setup.md) | Monorepo: pnpm workspaces + Turborepo | Vigente |
| [0002-ownership-boundaries.md](0002-ownership-boundaries.md) | Fronteras de ownership entre paquetes | Vigente — lo enforce `check-imports.mjs` |
| [0003-prisma-client.md](0003-prisma-client.md) | Cliente Prisma y migraciones | Vigente |
| [0004-renderer-separation.md](0004-renderer-separation.md) | Pixi fuera del dominio | Vigente — base de la separación `playlist-core` / `playlist-renderer-pixi` |

## Serie corta (one-liners)

| Archivo | Decisión | Estado |
|---|---|---|
| [0001-monorepo.md](0001-monorepo.md) | pnpm + Turborepo | Vigente (duplica a `0001-monorepo-setup.md`) |
| [0002-route-handlers.md](0002-route-handlers.md) | API REST como Route Handlers de Next | **Superseded** — hoy es un Worker Hono en `apps/web/worker/routes/` |
| [0003-prisma-package.md](0003-prisma-package.md) | Todo acceso DB vía `@slicex/db` | Vigente |
| [0004-timeline-snapshots.md](0004-timeline-snapshots.md) | Snapshot JSON en `timeline_revisions.document_json` | Vigente — el schema Prisma lo refleja |
| [0005-canvas-out-of-react.md](0005-canvas-out-of-react.md) | Pixi se actualiza por subscription, React sólo shell | Vigente — es la base del performance canon |

## Al añadir un ADR nuevo

Usar el siguiente número libre (**0006**) y el formato de la serie larga: título, fecha, contexto,
decisión, consecuencias. Registrar aquí el archivo y su estado.
