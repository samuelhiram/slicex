# Índice de documentación

Estado por documento, revisado **2026-08-13**. Si un doc no está aquí, no existe.

## Fuentes de verdad

| Documento | Qué responde |
|---|---|
| [product-spec.md](product-spec.md) | **Qué es el producto.** Modelo financiero, mecánicas de tarjeta/MSI, visión. Documento primigenio. |
| [project-canon.md](project-canon.md) | **Qué es el repo hoy.** Snapshot técnico corto: arquitectura, estado real, dónde tocar primero. |
| [performance-canon.md](performance-canon.md) | **Regla dura** de performance para `playlist-*` y el shell React. Un budget que falla es un bug, no una tolerancia a ajustar. |
| [../AGENTS.md](../AGENTS.md) | Ownership por capa y reglas de colaboración. |

## Vigentes

| Documento | Qué responde |
|---|---|
| [fl-playlist-parity-spec.md](fl-playlist-parity-spec.md) | Contrato de paridad con FL Studio, gesto por gesto. Se actualiza con cada fase. |
| [playlist-manual-test.md](playlist-manual-test.md) | Guion de prueba manual del playlist en el navegador. |
| [frontend-canon.md](frontend-canon.md) | Canon visual/layout: shell full-bleed, sin cards, separación por líneas. |
| [playlist-action-plan.md](playlist-action-plan.md) | Plan original de fases 1–6 del playlist. Ya ejecutado; útil como registro de intención. |
| [adr/](adr/) | Decisiones de arquitectura — ver [adr/README.md](adr/README.md) (ojo: numeración solapada). |

## Históricos — no reflejan el estado actual

Todos llevan banner `> **Histórico**` en la cabecera. Describen problemas ya resueltos o auditorías
de un árbol de archivos que cambió. Sirven para entender **por qué** algo quedó como quedó, nunca
como referencia de código vivo.

| Documento | De qué época |
|---|---|
| [header-occlusion-fix.md](header-occlusion-fix.md) | Fix de máscara del timeline (2026-04-19). |
| [timeline-grid-bleed-fix.md](timeline-grid-bleed-fix.md) | Fix de fuga de grid sobre clips (2026-04-19). |
| [js-duplication-audit.md](js-duplication-audit.md) | Auditoría de mirrors `.js` en la era Next.js. |
| [js-dedup-plan.md](js-dedup-plan.md) | Plan de eliminación de esos mirrors. |
| [js-dedup-report.md](js-dedup-report.md) | Resultado. Hoy lo enforce `check-js-siblings.mjs`. |

También es histórica la mitad inferior de [../CONTEXT.md](../CONTEXT.md), bajo el encabezado
"Historial acumulado (archivo)".

## Criterio de mantenimiento

Cuando cambie la entrada principal del producto, el motor, las reglas de ownership, los comandos de
validación o el branch canónico: actualizar [project-canon.md](project-canon.md) y esta tabla. Si un
documento deja de reflejar el código, marcarlo como histórico con banner — no borrarlo en silencio.
