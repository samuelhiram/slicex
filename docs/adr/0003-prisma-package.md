## 0003 — Centralizar Prisma en `@slicex/db`

Decisión: todo acceso DB via `@slicex/db`. No crear `new PrismaClient()` fuera.
