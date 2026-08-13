## 0002 — Route Handlers en Next App Router

> ⚠️ **Superseded (2026-05, migración a Cloudflare).** Next.js ya no está en el repo. La API REST
> vive hoy en un Worker Hono: `apps/web/worker/index.ts` monta las rutas de
> `apps/web/worker/routes/` (`health.ts`, `timelines.ts`), servidas por el mismo Cloudflare Worker
> que sirve la SPA (`run_worker_first: ["/api/*"]` en `wrangler.jsonc`).
> La decisión que sigue vigente es la forma del contrato — API REST mínima bajo `/api/*` — no el
> mecanismo. Se conserva como registro.

Decisión: exponer API REST mínima como Route Handlers dentro de `apps/web/src/app/api/*`.
