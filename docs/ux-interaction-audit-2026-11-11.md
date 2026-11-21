> **Auditoría 2026-11-11.** UX/UI y arquitectura de interacción. Estado auditado: `origin/feat/financial-engine-mvp` @ `52f28d6` (código = `e91939e`). Complementa, y no repite, [ui-ux-audit-2026-11.md](ui-ux-audit-2026-11.md) (2026-11-10, centrada en estabilidad, persistencia y motor). Las rutas `archivo:línea` corresponden a ese commit.

# Auditoría de UX/UI y arquitectura de interacción de SliceX

> **Estado de implementación (2026-11-11, sin commitear sobre `feat/financial-engine-mvp`).** 58 de 64 entradas hechas y 6 parciales; ninguna sin tocar. Gates: `check:arch` 0/0/0 · `typecheck` 0 · `vitest run` **1341 tests / 87 archivos** en verde (antes 1113), budgets de rendimiento intactos.
>
> - **Primitivos nuevos:**
>   - `apps/web/src/ui/use-overlay.ts`: `useOverlay`, `useRestoreFocus` y la pila de Escape.
>   - `apps/web/src/ui/announcer.tsx`: región `role="status"` y aviso con Deshacer.
>   - `apps/web/src/finance/components/EffectLine.tsx`: `useLivePreviewEffect` y `<EffectLine>`.
>   - `apps/web/src/finance/undo-step.ts`: agrupa varias escrituras en un solo paso de deshacer.
>   - `apps/web/src/finance/summary.ts`: veredicto y exclusiones.
>   - `apps/web/src/finance/editor-readback.ts`: readback del editor por tipo.
>   - `packages/core/src/finance/amortization.ts`: cálculo del pago de un préstamo.
> - **Parciales:**
>   - **UX-04:** falta la vista Lista y probar con un lector de pantalla real.
>   - **UX-10:** los rellenos de tipos distintos siguen cerca de 1.00:1 por el tinte del 13 %; los tipos se distinguen por signo y forma del acento. Subir esa diferencia es una decisión de diseño.
>   - **UX-11:** falta animar o anunciar el cambio de tramo de la escala.
>   - **UX-17:** falta mostrar el imán en la pastilla de fecha del arrastre.
>   - **UX-29:** la densidad baja se elige al montar; cambiarla en caliente depende de P2-19. Rec por debajo de 480 px no se verificó con filas.
>   - **UX-34:** "¿Cuándo es tu próximo pago?" del onboarding sigue siendo una fecha completa.
> - **Pendientes menores:**
>   - **UX-41:** ancho de la etiqueta en px.
>   - **UX-43:** lint de glosario.
>   - **UX-48:** "Exportar o respaldar" no existe todavía (P0-7).
>   - **UX-54:** el nombre no se pide al crear un futuro, y "Renombrar" sigue con `window.prompt`.
>   - **UX-55:** propone un abono único hoy, no un pago mensual.
>   - **UX-06:** los arreglos que retrasan una deuda se marcan, pero se siguen ofreciendo; falta una bandera "flexible".
>   - **UX-05:** un abono a tarjeta con fecha futura no se modela.
> - **Decisión abierta (motor):** hoy el primer abono de un MSI cae en el primer día de pago posterior a la fecha de compra, no en el que deriva del corte. Si la compra cae entre el corte y el pago, la vida real cobra un mes después. Cambiarlo toca `events.ts`/`payoff.ts`.
> - **P0-1** de la auditoría anterior (persistencia de la exclusión de una línea) **no** se tocó. UX-03 solo la hace visible.

**Fecha:** 2026-11-11 · **Branch:** `feat/financial-engine-mvp` · **Alcance:** shell, formularios, flujos de conciliación y simulación, canvas, y accesibilidad y sistema de diseño transversales.
**Resultado:** 79 hallazgos verificados en 5 áreas, que agrupados por causa quedan en **64 entradas**: 4 críticas, 25 altas, 31 medias y 4 bajas. Se descartó 1 falso positivo (ver Método).

---

## Resumen ejecutivo

- **La interfaz sigue la estructura del motor, no la decisión de la persona.**
  - El encabezado muestra seis cifras con el mismo peso, en el orden de los campos del documento. La frase que contesta "¿me alcanza?" ya está calculada, pero vive en un tooltip.
  - Los formularios imponen "Empieza / Termina" a tipos donde no significa nada (MSI, tarjeta). El préstamo empieza por "Pago".
  - Las líneas de evento se llaman nueve veces "Línea de evento".
- **Hay 4 problemas críticos, y 3 producen cifras falsas sin aviso:**
  - Una tarjeta nueva con solo el saldo nunca se paga (UX-01).
  - Rec duplica una corrección de caja (UX-02).
  - Silenciar o hacer "Solo" cambia "Deuda hoy" y "Al horizonte" sin declararlo (UX-03).
  - El cuarto es de accesibilidad: con teclado o lector no se puede leer, editar ni borrar ningún objeto (UX-04).
- **Lo simulado y lo real no se distinguen.**
  - Existen silencio, solo, futuros, "Escenario", el cabezal fuera de hoy y las teclas Q/A. Ninguno marca las cifras como hipótesis.
  - "Escenario" incluso edita el plan real, y "Soltar base" no deshace nada (UX-21).
- **La consecuencia se ve de forma desigual.**
  - La barra "/" muestra el efecto en caja antes de confirmar. El editor, Rec, los arreglos del valle y la avalancha no.
  - Después de Guardar o Aplicar, ninguna superficie confirma qué cambió, ofrece Deshacer ni lo anuncia al lector de pantalla.
- **Tres caminos para el mismo dato, con semánticas distintas:**
  - "Mi saldo real de hoy": el encabezado lo fija, Rec suma una diferencia y "/" lo convierte en gasto.
  - El día de pago se pide con tres controles.
  - Hay dos parsers de fechas y montos.
  - El editor y "/" calculan primeros abonos distintos para el mismo MSI.
- **La herencia DAW llega sin filtro.**
  - Cortar parte todas las líneas a la vez y deja insignias "↻42".
  - Borrar y Cortar son modos persistentes, sin salida con Esc y con el cursor `not-allowed`.
  - "Silenciar", "Solo", los atajos E/P/T/D y "Cortar" chocan con "fecha de corte".
- **Hay funciones que solo existen como gesto, hover o tecla mantenida.** Son la búsqueda de objetivo de deudas, "tu año sin esto" (A), asomarse a otro futuro (Q), la información de un clip y reordenar líneas. Esto choca con el siguiente target (táctil) y con WCAG 2.5.7 y 2.1.1.
- **Lo sólido** está en la lista "Lo que está sólido (no tocar)", al final:
  - El readback en lenguaje llano del editor.
  - La vista previa de "/".
  - El fantasma de la curva durante el arrastre.
  - Los menús de la cabecera (patrón APG correcto).
  - Diálogos con `aria-modal` y fondo `inert`, sin trampas de teclado.
  - Texto AA en ambos temas y en el canvas.
  - Ningún control DOM bajo 24 px.

---

## Cómo leer este documento

- **Severidad**:
  - **crítica:** impide una tarea principal, induce una decisión financiera equivocada sin aviso, o bloquea teclado o lector en un flujo principal (WCAG A).
  - **alta:** fricción fuerte o error probable en una tarea frecuente, o un fallo AA en un flujo principal.
  - **media:** fricción en una tarea secundaria, una inconsistencia que obliga a reaprender, o un fallo AA en una superficie secundaria.
  - **baja:** pulido con un impacto funcional real pero pequeño.
- **Prioridad**: ola y orden sugerido. La ola 1 hace que las cifras digan la verdad. La ola 2 hace visibles el estado, el modo y la consecuencia. La ola 3 cubre captura, lenguaje y accesibilidad estructural. La ola 4, pulido. Dentro de cada ola, el número de la entrada es el orden sugerido.
- **Esfuerzo**: S (< ½ día) · M (1–3 días) · L (> 3 días).
- **Origen**: id del hallazgo en los informes de área (A shell · B formularios · C flujos · D canvas · E accesibilidad y sistema) y su relación con la auditoría del 2026-11-10 (`Pn-m`).
- **Confianza**: casi todo está *confirmado con sonda* (Playwright con mouse y teclado reales sobre la app). Lo que solo se leyó en código se indica.
- Todas las recomendaciones respetan [frontend-canon.md](frontend-canon.md) (Mantine Form + Zod con controles propios) y [performance-canon.md](performance-canon.md): nada se calcula por frame, por `pointermove` ni por hover.

## Mapa por dimensión

| Dimensión | Entradas |
|---|---|
| 1 · Arquitectura de información | UX-08, UX-12, UX-14, UX-15, UX-24, UX-44, UX-47, UX-48, UX-61 |
| 2 · Diseño de interacción | UX-03, UX-06, UX-09, UX-13, UX-16, UX-17, UX-19, UX-20, UX-21, UX-25, UX-38, UX-39, UX-50, UX-53, UX-54 |
| 3 · Formularios y captura | UX-01, UX-02, UX-05, UX-07, UX-08, UX-12, UX-18, UX-22, UX-23, UX-30–UX-37, UX-51 |
| 4 · Jerarquía visual y composición | UX-10, UX-11, UX-14, UX-15, UX-40, UX-41, UX-42, UX-59 |
| 5 · Consistencia del sistema | UX-05, UX-27, UX-32, UX-33, UX-34, UX-35, UX-43, UX-52, UX-62, UX-63 |
| 6 · Accesibilidad y adaptabilidad | UX-04, UX-26, UX-27, UX-28, UX-29, UX-56–UX-60, UX-63, UX-64 |
| 7 · Eficiencia cognitiva y operativa | UX-02, UX-20, UX-22, UX-44, UX-45, UX-46, UX-49, UX-55 |

---

## Ola 1 · Que las cifras digan la verdad

### UX-01 · Una tarjeta nueva con solo el saldo nunca se paga, y la proyección no lo refleja
**Severidad:** crítica · **Prioridad:** Ola 1, #1 · **Esfuerzo:** S · **Origen:** B-01 (nueva)
- **Ubicación:** editor → "Nuevo → Tarjeta" (modo "Pago fijo cada mes").
- **Problema:** el borrador trae `Pago mínimo = 0` y "Pago planeado (opcional)" vacío. El motor paga `paymentAmount ?? minimumPayment`, o sea $0 al mes. No hay aviso ni vista previa de la liquidación.
- **Evidencia:**
  - Código: `packages/core/src/finance/items.ts:141`, `packages/core/src/finance/types.ts:124`, `apps/web/src/finance/components/FinancialEditorModal.tsx:1158-1170` y `apps/web/src/finance/visuals.ts:384` (con pago 0 se omite "tu pago no cubre el interés").
  - Sonda: tarjeta de $20,000 al 60 % con lo demás por defecto. "Deuda hoy" sube $20,000, pero "Mínimo proyectado" (−$1,292) y "Al horizonte" ($95,708) quedan **idénticos**. La única señal es "No se liquida", en gris, en la cabecera de la línea.
- **Impacto:** es la captura más natural ("tengo la Banamex con 20 mil"). La caja supone que nunca se paga una deuda al 60 %, y la curva, el mínimo y el horizonte salen inflados.
- **Principio afectado:** Nielsen #5 Prevención de errores; #1 Visibilidad del estado; valor por defecto peligroso.
- **Recomendación:** con saldo > 0 en modo fijo, el campo "¿Cuánto pagas al mes?" pasa a ser obligatorio (o se elige totalero), con el error en el campo. Debajo, una línea viva con la estimación del core: "Libre en jul 2028 · intereses ≈ $X", o "Con $0 al mes no se liquida".
- **Criterio de aceptación:** guardar una tarjeta con saldo > 0 y pago efectivo 0 exige un pago o una confirmación explícita, y la fecha de liquidación se ve antes de Guardar.

### UX-02 · Rec suma el "Saldo real hoy" como diferencia y duplica una corrección previa del encabezado
**Severidad:** crítica · **Prioridad:** Ola 1, #2 · **Esfuerzo:** S · **Origen:** C-01 (nueva)
- **Ubicación:** diálogo Rec ("Pon tu año al día") junto con la cifra editable "Liquidez hoy".
- **Problema:** `applyRecCorrections` suma (saldo escrito − saldo supuesto al cargar) a la caja **actual**. Si la persona ya corrigió "Liquidez hoy", que es lo que sugiere su ayuda, la diferencia entra dos veces. El diálogo promete lo contrario: "Si lo escribes, manda sobre todo lo demás". Las filas "No pasó" y "Otro monto" usan el mismo mecanismo de delta (leído en código).
- **Evidencia:**
  - Código: `apps/web/src/finance/bootstrap.ts:97-100` y `apps/web/src/finance/components/RecDialog.tsx:213-216`.
  - Sonda: caja supuesta $5,708 → encabezado corregido a $11,400 → Rec con "Saldo real hoy = 11,400" → **"Liquidez hoy" = $17,092**, y se autoguarda.
- **Impacto:** la caja de hoy queda inflada $5,692 justo en la cifra que la persona vino a corregir. Toda la proyección sale optimista sin aviso.
- **Principio afectado:** Nielsen #5; #1; la acción contradice el texto que la explica.
- **Recomendación:**
  - Con `cashOverride`, fijar la caja como valor absoluto (`bridge.setInitialCash(cashOverride)`).
  - Las filas aplican delta solo cuando no hay saldo real escrito.
  - Tests: "encabezado 11,400 + Rec 11,400 ⇒ 11,400" y "Rec 11,400 sin edición previa ⇒ 11,400".
- **Criterio de aceptación:** después de Guardar con "Saldo real hoy = X", "Liquidez hoy" vale X sin importar las ediciones previas.

### UX-03 · Silenciar o hacer "Solo" cambia las cifras del encabezado sin declararlo
**Severidad:** crítica · **Prioridad:** Ola 1, #3 (junto con P0-1) · **Esfuerzo:** M · **Origen:** D-01 (amplía P0-1 y P2-7)
- **Ubicación:** íconos ojo y enfoque de la cabecera de línea, herramienta Silenciar y menú del objeto, frente a la barra de resumen.
- **Problema:**
  - Excluir es una simulación ("¿y si esto no pasara?"), pero el encabezado la presenta como realidad.
  - "Deuda hoy" es un dato de hoy y aun así excluye la deuda silenciada.
  - Ninguna cifra indica que hay objetos fuera del cálculo. La única señal es el rayado del clip, que puede estar fuera de la vista.
  - El estado persiste (P0-1).
- **Evidencia:**
  - Código: `apps/web/src/finance/components/FinancialSummaryBar.tsx:202-204` (`projection.initialDebt` solo suma lo habilitado) y `apps/web/src/finance/visuals.ts:452,463`.
  - Sonda: un clic en el ojo de "Nu" lleva "Deuda hoy" de $149,510 a **$119,441**, "Al horizonte" de $95,708 a **$131,708**, el mínimo de −$1,292 a $1,708 y las alertas de 2 a 1. Sigue así tras recargar.
  - Sonda: "Solo" sobre Nu deja "Deuda hoy" en **$30,069**.
- **Impacto:** la persona decide con una deuda $30k menor o una caja $36k mayor, y días después no recuerda que silenció algo.
- **Principio afectado:** Nielsen #1; #5; patrón de "filtros activos" en tableros.
- **Recomendación:**
  - Si hay algo excluido, un chip persistente en la barra: "Sin 2 objetos · Ver · Reactivar todo".
  - Las métricas afectadas llevan la marca "(simulación)".
  - "Deuda hoy" siempre es la deuda real; la cifra sin el objeto va aparte ("Sin Nu: $119,441").
  - Solo y silencio de línea usan el mismo chip.
- **Criterio de aceptación:** con cualquier exclusión, la barra lo dice sin hacer scroll, "Deuda hoy" coincide con la suma real de saldos y el chip sobrevive a una recarga.

### UX-04 · Con teclado o lector de pantalla no se puede leer, editar ni borrar un objeto
**Severidad:** crítica · **Prioridad:** Ola 1, #4 (paso intermedio) · **Esfuerzo:** M (intermedio) / L (vista Lista) · **Origen:** E-01 (amplía P2-23, P2-24 y P2-26; sube de alta a crítica con esta escala)
- **Ubicación:** canvas (`role="application"`) y lectura del cursor de tiempo.
- **Problema:** con teclado se puede **crear** (Nuevo → editor), pero no se puede:
  - seleccionar un objeto;
  - abrirlo (Enter en el canvas no hace nada);
  - borrar uno solo (solo Ctrl+A + Supr, que borra todo);
  - abrir su menú (Shift+F10 o la tecla Menú no hacen nada);
  - saber qué hay: el canvas es un nodo vacío y la lectura del día tiene `aria-live="off"`.

  Además, el `aria-label` del canvas describe solo gestos de ratón.
- **Evidencia:**
  - Código: `apps/web/src/components/PlaylistShell.tsx:1193-1200`, `apps/web/src/finance/components/PlayheadReadout.tsx:31-37` y `packages/canvas/src/playlist-interaction/controller.ts:1982-2254`, `:2002`, `:2067`.
  - Sondas: árbol ARIA con el canvas vacío; "Enter en canvas → editores abiertos: 0".
- **Impacto:** quien no usa ratón puede agregar objetos pero no corregirlos. Con lector de pantalla, la persona no sabe qué contiene su plan.
- **Principio afectado:** WCAG 2.2 2.1.1 Teclado (A), 1.1.1 y 1.3.1 (A), 4.1.2 (A); Nielsen #7.
- **Recomendación** (sin esperar la vista Lista de P2-23):
  - Foco itinerante entre objetos dentro del host del canvas (Alt+←/→ en orden de fecha). Enter abre el editor y Shift+F10 o la tecla Menú abren el menú del objeto.
  - Una región `polite` que anuncie "Renta · −$8,000 · 1 dic · línea 2".
  - Lectura del día en `polite` solo cuando el cambio viene del teclado, con debounce como `LiveRange`.
  - `aria-label` con teclas, no con gestos.
  - Se calcula con el día entero, nunca por frame.
- **Criterio de aceptación:** un e2e solo con teclado abre "Sueldo", cambia su monto, guarda y borra "Gasto"; el lector anuncia el objeto enfocado y la caja del día al pulsar →.

### UX-05 · La barra "/" convierte frases de conciliación en gastos
**Severidad:** alta · **Prioridad:** Ola 1, #5 · **Esfuerzo:** M · **Origen:** C-03 (amplía P0-15, P2-12 y P0-3)
- **Ubicación:** barra "/" (`CommandBar` + `parseCommand`).
- **Problema:** la barra solo sabe crear objetos, y lo que no reconoce lo trata como "Gasto". Enter agrega aunque el tipo se haya supuesto:
  - "tengo 11400 en el banco" → Gasto de $11,400 (Mín −$1,292 → −$12,692).
  - "pagué la tarjeta nu 3000" → Gasto de $3,000. La caja baja, pero la deuda de Nu no, y su pago planeado sigue: se cuenta dos veces.
  - "gasté 300 en uber ayer" → "Sin efecto en tu caja". Con Enter se agrega igual, con fecha anterior al plan: el canvas dibuja "−$300" junto a Hoy, pero la liquidez no cambia.

  "Supuse: tipo" va en gris de 12 px, mientras el efecto va en rojo y negritas.
- **Evidencia:** `apps/web/src/finance/command.ts:17` ("nothing recognised → expense"), `:1217`; `apps/web/src/finance/components/CommandBar.tsx:97-101` (Enter no revisa `assumed`) y `:150-152`. Sondas `p05-command`, `p10-cmd-past`.
- **Impacto:** quien usa "/" para decir su saldo resta $11,400 a su plan. Quien registra un gasto de ayer queda con la caja $300 alta.
- **Principio afectado:** Nielsen #5; #9 Ayudar a reconocer y corregir errores; #2 Coincidencia con el mundo real.
- **Recomendación:**
  - Intención "saldo de hoy" ("tengo / me quedan / saldo / en el banco" + monto): vista previa "Liquidez hoy $12,000 → $11,400", y Enter llama a `setInitialCash` (deshacible).
  - Fecha anterior a hoy: "Ya pasó: tu liquidez de hoy ya debería incluirlo", con [Descontarlo de mi liquidez] / [Anotarlo igual].
  - "Pagué / abono a la tarjeta X": proponer que baje el saldo de la tarjeta.
  - Con el tipo supuesto, Enter no agrega: mostrar chips [Gasto] [Ingreso] [Es mi saldo], y "Supuse" con tono de aviso.
- **Criterio de aceptación:** ninguna de estas frases termina en un Gasto sin una elección explícita, y las frases de saldo cambian "Liquidez hoy".

### UX-06 · Los arreglos del valle no muestran su costo: el primero paga un préstamo 11 días tarde cada mes y lo pinta de verde
**Severidad:** alta · **Prioridad:** Ola 1, #6 · **Esfuerzo:** M · **Origen:** C-06 (amplía P2-1 y P1-4)
- **Ubicación:** tarjeta del valle (`ValleyCard`), lista "Arreglos".
- **Problema:**
  - En el valle del 27 nov, el arreglo n.º 1 es "Mover Préstamo personal al último día de cada mes · **Recuperas tu reserva**". En la vida real eso es pagar tarde cada mes (moratorios, buró), y no se menciona.
  - "Pagar el mínimo de Nu" no muestra el costo en intereses.
  - "mínimo $X" (el punto más bajo de caja) choca con "pago mínimo" en el mismo renglón.
  - No hay vista previa al pasar o enfocar un arreglo; al aplicar, la tarjeta desaparece sin confirmación ni Deshacer.
  - Los 3 botones son primarios rellenos.
- **Evidencia:** `packages/core/src/finance/valley.ts:344-361` (mueve el día mensual de **gastos y préstamos**) y `:365-377`; `apps/web/src/finance/components/ValleyCard.tsx:126-137`; `apps/web/src/finance/financial-bridge.ts:626-628` (`replaceItem` directo) frente a `:702` (`setPreview`, que ya usa "/"). Sonda `p02-valley`.
- **Impacto:** un clic convierte en plan una práctica que en la realidad cuesta dinero, presentada como la mejor opción.
- **Principio afectado:** Nielsen #1; #5; #3 Control y libertad.
- **Recomendación:**
  1. Todo arreglo que retrasa un pago de deuda lleva la advertencia "Pagarías 11 días después de tu fecha de pago: puede generar intereses moratorios", o se propone solo si el objeto está marcado como flexible.
  2. Cada arreglo muestra "horizonte ±$X"; "Pagar el mínimo" muestra además los intereses extra.
  3. "Tu punto más bajo: $X" en lugar de "mínimo $X".
  4. Vista previa al pasar o enfocar con `setPreview({kind:"document"})`, calculada de forma diferida (P1-4).
  5. Tras Aplicar: "Préstamo personal: ahora el último día de cada mes · Deshacer".
  6. Un solo primario relleno.
- **Criterio de aceptación:** ningún arreglo que retrasa un pago de deuda aparece sin advertencia, y todos dejan ver su efecto antes y después.

### UX-07 · MSI: "Termina: Nunca" contradice "Meses", y una fecha de fin recorta los abonos sin aviso
**Severidad:** alta · **Prioridad:** Ola 1, #7 · **Esfuerzo:** S · **Origen:** B-02 (nueva)
- **Ubicación:** editor → "Nuevo → MSI", bloque "Cuándo".
- **Problema:** el MSI hereda el "Termina" genérico de la recurrencia. Un 6 MSI nuevo aparece con "◉ Nunca". Si la persona "corrige" eso con una fecha anterior al último abono, el motor deja de cobrar en esa fecha y el resto nunca sale de la caja, sin error ni aviso.
- **Evidencia:** `apps/web/src/finance/components/FinancialEditorModal.tsx:752` y `:916-1009`; `packages/core/src/finance/payoff.ts:313` (`intersectWindow`). Sonda: "Tele 12 MSI" de $12,000 con fin al 11/02/2027 se guarda; "Al horizonte" baja solo $3,000 (3 abonos) en vez de $12,000.
- **Impacto:** el control sugiere que el MSI es indefinido, y una corrección bienintencionada deja $9,000 de deuda fuera de la caja.
- **Principio afectado:** Nielsen #2; #5; #4 (dos fuentes de verdad para el fin).
- **Recomendación:** en MSI, quitar "Termina" y mostrar el fin calculado, de solo lectura: "Último abono: 26 oct 2027 (12 de 12)". Si se conserva la ventana, validar `endDate ≥ último abono` con un error en el campo.
- **Criterio de aceptación:** un MSI no se puede guardar con menos abonos que "Meses − Pagados" y nunca muestra "Nunca".

### UX-08 · Préstamo: el formulario sigue el modelo ("Pago") y no cruza saldo, pago y plazo
**Severidad:** alta · **Prioridad:** Ola 1, #8 · **Esfuerzo:** M · **Origen:** B-06 (amplía P0-11 y P2-15)
- **Ubicación:** editor → "Nuevo → Préstamo".
- **Problema:**
  - El orden es Pago → Saldo (opcional) → Tasa (opcional) → Cuándo, con "Termina" por defecto en 13 pagos.
  - No se puede derivar el pago desde monto, tasa y plazo, y saldo, pago y plazo se contradicen sin aviso.
  - La tasa no afecta la proyección (es informativa) y el formulario no lo dice.
- **Evidencia:** `apps/web/src/finance/components/FinancialEditorModal.tsx:1104-1121`; `packages/core/src/finance/payoff.ts:295` ("annualRate is informative"). Sonda: saldo 10,000, pago 1,500 → readback "13 pagos" = $19,500 contra un saldo de $10,000, sin ninguna pista.
- **Impacto:** el error es probable: la persona llena pago y saldo y deja el plazo por defecto. Quien escribe una tasa cree que el plan incluye intereses.
- **Principio afectado:** Nielsen #2; #5; #6 Reconocer antes que recordar (cálculo mental del pago).
- **Recomendación:**
  - Ordenar por la decisión: "¿Cuánto debes hoy?", "¿Cuánto pagas?", "¿Cuántos pagos te faltan?".
  - Un botón "Calcular pago" (amortización como función pura en `@slicex/core`).
  - Verificación viva: "13 × $1,500 = $19,500, más que tu saldo → liquidas en 7 pagos · [Ajustar a 7]".
  - Una pista en la tasa: "Solo ordena tus deudas; tu pago ya incluye intereses".
- **Criterio de aceptación:** una combinación incoherente muestra un aviso con acción de ajuste antes de guardar, y el readback dice saldo, total y fecha de liquidación.

### UX-09 · "Cortar" parte todos los objetos de todas las líneas que cruzan esa fecha y deja una insignia "↻42"
**Severidad:** alta · **Prioridad:** Ola 1, #9 · **Esfuerzo:** M · **Origen:** D-02 (nueva; P2-2 cita Insert, no el alcance multilínea)
- **Ubicación:** herramienta Cortar (C) y tecla Insert.
- **Problema:**
  - Un clic con Cortar sobre "Sueldo" parte también "Préstamo personal", que está en otra línea. No hay vista previa de qué se partirá.
  - Las mitades derechas muestran "↻42" (offset de contenido en días, sin sentido financiero).
  - Es el comportamiento documentado de paridad con FL ([fl-playlist-parity-spec.md](fl-playlist-parity-spec.md) §"Slice tool"). El problema es que el host financiero lo hereda sin filtrar.
- **Evidencia:** `packages/canvas/src/playlist-core/state.ts:794-806` (candidatos = todo clip que cruza `time`); `packages/canvas/src/playlist-interaction/controller.ts:1853-1866`; `packages/canvas/src/playlist-renderer-pixi/clip-node-registry.ts:805-826` (insignia). Sonda: de 7 objetos a 9.
- **Impacto:** la estructura de objetos que la persona no tocó cambia en silencio. Después edita "Sueldo" sin saber que ahora hay dos.
- **Principio afectado:** Nielsen #1; #5; #2.
- **Recomendación:**
  - En el host financiero, Cortar parte solo el clip bajo el puntero, o la selección. "Cortar todo en esta fecha" queda detrás de un modificador (Shift), sin perder capacidad.
  - Durante el gesto, resaltar lo que se partirá: "Partir Sueldo el 23 dic: desde ahí puedes cambiar el monto".
  - Ocultar las insignias ↻/× en hosts sin semántica de slip o stretch (opción del renderer leída una vez).
- **Criterio de aceptación:** cortar sobre Sueldo crea exactamente un objeto nuevo, el tooltip lo nombra y no aparece "↻" en ningún clip financiero.

### UX-10 · Ingreso y MSI se ven idénticos, y el MSI y la compra con tarjeta no llevan "−"
**Severidad:** alta · **Prioridad:** Ola 1, #10 · **Esfuerzo:** S · **Origen:** D-04 (amplía P3-2)
- **Ubicación:** relleno, acento y texto de los clips.
- **Problema:**
  - El tipo se comunica sobre todo por color, y el verde del ingreso (`#1f9d55`) y el verde azulado del MSI (`#0d9b8a`) dan rellenos de **1.001:1** entre sí.
  - El texto del MSI ("$1,500/mes · 3/12") y el de la compra ("$X → Nu") son las únicas salidas de dinero sin "−". En la demo, "Sueldo" y "Laptop 12 MSI" se leen como dos ingresos.
  - Las marcas de pago de MSI, ingreso y compra quedan a 2.59–3.01:1 contra su relleno.
- **Evidencia:** `apps/web/src/finance/labels.ts:19-26`; `apps/web/src/finance/visuals.ts:356-361` y `:396-404`. Sonda `p8-contrast` (ratios calculados desde `palette.ts`).
- **Impacto:** un pago mensual se puede leer como entrada. Con deuteranopía la confusión aumenta.
- **Principio afectado:** WCAG 2.2 1.4.1 Uso del color (A); 1.4.11 Contraste no textual (AA); Nielsen #4.
- **Recomendación:**
  - Toda salida empieza con "−" ("−$1,500/mes · pago 3 de 12", "−$800 con Nu").
  - Separar el tono del MSI del ingreso (por ejemplo, la familia de su tarjeta) y agregar una marca de forma en el acento.
  - Acentos y marcas ≥ 3:1, con un test de ratios desde `palette.ts`.
- **Criterio de aceptación:** en una captura en escala de grises cada tipo se distingue por texto o glifo, y ningún par de rellenos de tipos distintos queda por debajo de 1.1:1.

### UX-11 · El carril Caja no se puede leer: escala no lineal sin guías, línea de deuda sin nombre y reescala tras cada edición
**Severidad:** alta · **Prioridad:** Ola 1, #11 · **Esfuerzo:** S–M · **Origen:** D-03 + A-09 + D-12 (nuevas)
- **Ubicación:** carril "Caja" (overview lane) y su celda de lectura.
- **Problema:**
  - **Escala sin guías.** La escala Y es simétrico-logarítmica (`symlog`, constante = reserva), y solo se rotulan los extremos ($96k / −$1.3k). Leída contra ellos, una altura de $20,208 parece unos **$47k**.
  - **Línea de deuda anónima.** La línea gris es la deuda total, con escala propia, sin leyenda, sin rótulo y sin valor en el tooltip. En la celda, "Cash" está oculto y se lee en inglés.
  - **Reescala tras cada edición.** Una edición lejana baja el máximo de $96k a $47k, y la curva de nov–mar, sin cambios reales, se dibuja 7–12 px **más arriba**: el año parece mejorar cuando "Al horizonte" cayó $72,000.
- **Evidencia:** `apps/web/src/finance/visuals.ts:153-165`; `packages/canvas/src/playlist-renderer-pixi/layers/overview-lane.ts:121-157`, `:423-431`, `:606-613`; `apps/web/src/finance/components/PlayheadReadout.tsx:40`. Sondas `p7-symlog` (píxeles medidos) y `p5-rescale`.
- **Impacto:** la curva es la lectura principal del producto. La persona sobreestima su colchón, no sabe qué es la línea gris, y la comparación "antes / después" a ojo se invierte.
- **Principio afectado:** Nielsen #2; #6; #1; integridad gráfica (eje no lineal sin rotular); WCAG 1.3.1.
- **Recomendación:**
  - 3–4 guías tenues rotuladas con valores redondos ($0, reserva, $10k, $50k…) según la escala vigente, en la capa *Frame* y una vez por referencia de datos (perf-canon §3.14).
  - Leyenda "▬ Caja · ┄ Deuda" en la celda, y "Deuda $X" en el tooltip.
  - Máximo fijado a pasos redondos con histéresis, animando y destacando el rótulo cuando cambia.
  - "Caja" en español para el lector.
- **Criterio de aceptación:** cualquier punto se lee con ±10 % de error usando las guías, la línea gris se identifica sin hover, y una edición que no altera el tramo visible no mueve la curva más de 1 px salvo un cambio de tramo anunciado.

### UX-12 · El onboarding crea un plan que rompe la reserva desde el primer día por sus valores por defecto
**Severidad:** alta · **Prioridad:** Ola 1, #12 · **Esfuerzo:** M · **Origen:** B-04 (amplía P2-14 y P2-8)
- **Ubicación:** onboarding "Tu año en 60 segundos" → "Crear mi año".
- **Problema:**
  - El colchón vacío vale "un pago", y es fácil que sea mayor que la caja de hoy.
  - "Agregar el año mexicano" viene marcado y agrega 5 objetos con montos y fechas inventados, sin mostrarlos. La etiqueta nombra 4 y omite "Regalos de Navidad".
  - No hay resumen antes de crear.
- **Evidencia:** `apps/web/src/finance/components/Onboarding.tsx:258` (`reserve: … ?? payValue`), `:206` (`withSuggestions: true`), `:398`. Sonda: caja $12,000 y sueldo $20,000 → reserva $20,000 + 5 sugerencias. La primera pantalla dice "Mínimo proyectado $10,000" en rojo y "Rompes tu reserva… Lo cavan: Buen Fin −$2,000".
- **Impacto:** lo primero que ve la persona de "su" año es una alarma causada por datos que no escribió ("Regreso a clases" sin tener hijos). Eso le resta confianza a todas las cifras.
- **Principio afectado:** Nielsen #1; #3; #5 (valores por defecto que inventan datos).
- **Recomendación:**
  - Paso de resumen editable antes de crear: "Caja hoy $12,000 · cobras $20,000 cada mes · colchón $20,000 ⚠ más que tu caja · Sugerencias: ☑ Aguinaldo +$10,000 (20 dic)…", con casilla y monto por sugerencia.
  - Colchón vacío = `min(un pago, caja)`, mostrado en el campo.
- **Criterio de aceptación:** ningún objeto entra al plan sin que su monto y su fecha se hayan mostrado, y los valores por defecto por sí solos no generan un valle el primer día sin aviso previo.

### UX-13 · El efecto del gesto solo mide caja: liquidar una deuda antes sale en rojo
**Severidad:** alta · **Prioridad:** Ola 1, #13 · **Esfuerzo:** S–M · **Origen:** D-07 (nueva)
- **Ubicación:** píldora de efecto durante los arrastres, sobre todo la búsqueda de objetivo de tarjetas y préstamos.
- **Problema:**
  - La píldora compara solo el mínimo y la caja final, aunque `summarizeProjection` ya trae `finalDebt`. Al acercar el fin de "Nu" dice "Libre en ago 2027 · pagas $4,371/mes · Mín −$1,292 → −$2,663 · horizonte −$7,834" en **rojo**, sin la deuda ni los intereses ahorrados.
  - El tooltip ("hasta 23 sep 2027") y la píldora ("Libre en ago 2027") dan dos fechas sin explicar cuál es la meta y cuál el resultado.
  - Al acortar un recurrente no se dice cuántos pagos se pierden.
- **Evidencia:** `apps/web/src/finance/visuals.ts:172-203`; `apps/web/src/finance/financial-bridge.ts:496-499`; `packages/core/src/finance/scenario.ts:37-44`. Sondas `p16-goalseek`, `p4-extend`.
- **Impacto:** sesga contra la decisión que el producto quiere facilitar (pagar antes la deuda cara).
- **Principio afectado:** Nielsen #1; #2; diseño centrado en la decisión.
- **Recomendación:**
  - En gestos sobre deudas: "deuda al horizonte −$X · intereses −$Y", con la proyección que el bridge ya cachea por revisión.
  - El tono refleja el neto (caja + deuda).
  - "Meta: 23 sep → Libre en ago (antes jul 2028)".
  - En recurrentes: "16 pagos (antes 24)".
- **Criterio de aceptación:** en la búsqueda de objetivo se ven el ahorro y la fecha anterior, y si el neto mejora la píldora no queda en tono negativo.

---

## Ola 2 · Estado, modo y consecuencia visibles

### UX-14 · El encabezado no responde primero "¿me alcanza?": seis cifras con el mismo peso y la respuesta en un tooltip
**Severidad:** alta · **Prioridad:** Ola 2, #14 · **Esfuerzo:** M · **Origen:** A-01 (nueva)
- **Ubicación:** `FinancialSummaryBar` (Liquidez hoy · Reserva mínima · Deuda hoy · Próximo pago · Mínimo proyectado · Al horizonte · alertas).
- **Problema:**
  - Las seis cifras miden 14 px/600; solo cambia el color si son negativas. El orden es el del documento (dos datos de entrada y luego cuatro resultados), y la cifra decisiva queda en 5.º lugar.
  - La frase "El 27 nov te faltarían $1,292…" ya está calculada, pero solo aparece en la ayuda tras 350 ms de hover.
  - Las alertas están separadas de la cifra que califican.
  - "Reserva mínima" y "Mínimo proyectado" casi se llaman igual.
- **Evidencia:** `apps/web/src/finance/components/FinancialSummaryBar.tsx:142-153`, `:176-273`; `apps/web/src/styles/globals.css:1058-1064`, `:1183-1202`. Sonda `p1-overview` (todas a 14 px/600).
- **Impacto:** para su pregunta principal, la persona combina seis números. "Al horizonte $95,708" en tinta normal da una falsa tranquilidad aunque haya un valle en rojo en 16 días.
- **Principio afectado:** Nielsen #8 (jerarquía y relevancia); #6; #1.
- **Recomendación:**
  - Un **veredicto** en texto como primer elemento: "Te alcanza hasta el 26 nov · el 27 nov te faltan $1,292", o "Te alcanza todo el año · mínimo $6,208 el 15 mar". Debe ser clicable (lleva al día) y absorber el conteo de alertas.
  - "Liquidez hoy · Reserva" agrupadas como punto de partida editable.
  - Deuda, Próximo pago y Al horizonte como contexto secundario.
  - "Tu punto más bajo" en lugar de "Mínimo proyectado".
- **Criterio de aceptación:** a 1280×720, el primer elemento, y el de mayor cuerpo, dice si alcanza y la primera fecha en que no.

### UX-15 · En laptops se recortan justo las cifras que deciden; con un segundo futuro "Mínimo proyectado" desaparece
**Severidad:** alta · **Prioridad:** Ola 2, #15 · **Esfuerzo:** M · **Origen:** A-02 (nueva)
- **Ubicación:** tira de métricas del encabezado (`.fin-summary__metrics`).
- **Problema:** cuando falta espacio, la tira se desplaza de lado con la barra oculta y un desvanecido, y las últimas cifras en verse son justo las de resultado. El botón de futuros crece al bifurcar (33 → 150–189 px). Nada indica que hay más cifras.
- **Evidencia:** `apps/web/src/styles/globals.css:948-965`, `:3362-3364`; `apps/web/src/finance/components/FuturesMenu.tsx:71-100`. Fracción visible medida por las sondas `p5-states` y `p6-fork-strip`:

  | Ancho | Plan principal | Con 2 futuros |
  |---|---|---|
  | 1440 | Al horizonte 0.98 | Al horizonte 0.36 |
  | 1280 | Al horizonte 0.72 | **Mínimo 0.62**, Al horizonte **0** |
  | 1200 | Al horizonte 0.13 | **Mínimo 0**, Al horizonte 0 |

- **Impacto:** en el ancho de laptop más común, quien explora un escenario pierde la cifra que compara.
- **Principio afectado:** Nielsen #1; #6; WCAG 2.2 1.4.10 Reflow.
- **Recomendación:**
  - Ceder espacio por prioridad de decisión: el veredicto (UX-14) nunca se recorta, y el contexto se pliega en "Más ▾" o en un segundo renglón.
  - Mostrar un control visible "Ver más cifras" cuando haya desborde.
  - Limitar el ancho del botón de futuros.
- **Criterio de aceptación:** a 1200, 1280 y 1366 px, con 1 y con 3 futuros, la cifra decisiva se ve completa y el resto está visible o a un clic.

### UX-16 · La herramienta activa casi no se distingue, y Borrar y Cortar son modos persistentes sin salida con Esc
**Severidad:** alta · **Prioridad:** Ola 2, #16 · **Esfuerzo:** S–M · **Origen:** A-03 + D-06 (amplían P2-1, P2-3 y P2-20)
- **Ubicación:** barra de herramientas y cursor sobre el lienzo.
- **Problema:**
  - **Indicador.** El estado activo mide **1.09:1** en claro y 1.23:1 en oscuro frente al grupo. Las etiquetas están ocultas en todos los anchos; el nombre solo existe en `title`, que no existe en táctil.
  - **Cursores.** Borrar usa `not-allowed` ("no puedes"), aunque un clic borra. Dibujar y Cortar comparten `crosshair`.
  - **Modos persistentes.** Esc no vuelve a Seleccionar (no hay ningún manejo de Escape en el controlador). Con Borrar, cada clic posterior borra, y un solo trazo borró 2 objetos sin aviso.
- **Evidencia:** `apps/web/src/styles/globals.css:357-393`, `:3459-3467`; `packages/canvas/src/playlist-interaction/tools/delete.ts:5-33`; `packages/canvas/src/playlist-interaction/controller.ts:1982-2257`. Sondas `p4-interact`, `p5-states`, `p9-mute-delete-slice`.
- **Impacto:** error de modo clásico: la persona hace clic para "ver" un objeto y lo pierde, y el autosave lo persiste.
- **Principio afectado:** WCAG 2.2 1.4.11 (AA); Nielsen #1; #3; #5; #6.
- **Recomendación:**
  - Indicador activo ≥ 3:1 en los dos temas, y la etiqueta de la herramienta activa siempre visible.
  - Con una herramienta distinta de Seleccionar, una pastilla en el lienzo: "Borrar · clic en un objeto lo elimina · Esc para salir".
  - Esc vuelve a Seleccionar.
  - El arrastre de Borrar resalta lo que tocará y, al soltar, muestra "Borrados 2 · Deshacer".
  - Cursores propios por herramienta.
- **Criterio de aceptación:** la sonda mide ≥ 3:1, hay un texto visible del modo fuera de la barra, y Esc devuelve a Seleccionar.

### UX-17 · "Día" parece un selector de vista, pero es el imán de ajuste: "Semana" mueve los pagos al día de la semana del plan
**Severidad:** alta · **Prioridad:** Ola 2, #17 · **Esfuerzo:** S · **Origen:** A-04 (nueva; relacionada con P2-2)
- **Ubicación:** select "Ajustar a" (Día · Semana · Quincena · Libre) frente al select "Rango visible" (Semana · 2 sem · Mes…).
- **Problema:** "Ajustar a" está oculto por debajo de 1800 px, y solo se ve "Día" con un ícono en U. "Día / Semana" es la convención de calendario para cambiar de **vista**, y el control vecino usa las mismas palabras. Elegir "Semana" no cambia nada visible, pero el siguiente arrastre cae en una rejilla de 7 días anclada al inicio del plan.
- **Evidencia:** `apps/web/src/components/PlaylistShell.tsx:135-141`, `:671-703`; `apps/web/src/styles/globals.css:512-522`. Sonda `p7-snap`: el mismo arrastre deja el 26 nov con "Día" y el **25 nov (miércoles)** con "Semana".
- **Impacto:** quien busca "ver por semana" deja activo, sin saberlo, un ajuste que corre fechas de pago.
- **Principio afectado:** Nielsen #2; #4 (el mismo término con dos significados en controles vecinos); #5.
- **Recomendación:**
  - Etiqueta visible en todo ancho ("Imán: Día") con un ícono de imán.
  - Opciones que no choquen con el rango: "Cada día", "Inicio de semana", "Quincena (15 y fin de mes)", "Sin imán".
  - Mostrar el ajuste en la pastilla de fecha del arrastre cuando no sea "Día".
- **Criterio de aceptación:** a 1280 px el control muestra un nombre de ajuste visible y ninguna opción repite una etiqueta del selector de rango.

### UX-18 · "Liquidez hoy" y "Reserva" no se ven editables, el error no se muestra y Enter revierte en silencio
**Severidad:** alta · **Prioridad:** Ola 2, #18 · **Esfuerzo:** S · **Origen:** A-05 (amplía P2-10)
- **Ubicación:** edición en línea del encabezado (`InlineNumberInput`).
- **Problema:**
  - En reposo, los dos campos se ven idénticos a las cifras de solo lectura.
  - Con una entrada inválida ("12 mil", como se habla en México), el campo se pone rojo, pero el mensaje solo está en `.fin-sr-only`. Enter devuelve $12,000 sin explicación.
  - "12.000" se guarda como **$12** sin eco: aparecen 6 alertas y el mínimo baja a −$13,280. En es-MX el punto es decimal, así que es correcto, pero una base que cambia 1000× merece confirmación.
- **Evidencia:** `apps/web/src/finance/components/FinancialUi.tsx:142-148` (descarte silencioso) y `:188-192`; `apps/web/src/styles/globals.css:1086-1116`. Sondas `p4-interact`, `p5-states`.
- **Impacto:** quien quiere corregir su saldo no sabe que puede hacer clic en la cifra, o lo intenta y "no pasa nada".
- **Principio afectado:** WCAG 2.2 3.3.1 Identificación de errores (A); 3.3.3 (AA); Nielsen #9; #5.
- **Recomendación:**
  - Affordance de editable en reposo (subrayado discontinuo o lápiz).
  - Error visible anclado al campo, con sugerencia; Enter con error no cierra.
  - Eco con deshacer para cambios grandes de la base: "Liquidez hoy: $12,000 → $12 · Deshacer".
  - Parser compartido con "/" (UX-35).
- **Criterio de aceptación:** "12 mil" se acepta o muestra un mensaje visible sin perder lo escrito, y en reposo los campos editables se distinguen de "Deuda hoy" sin hover.
- **Nota:** el trabajo local sin commitear del 2026-11-11 (`InlineNumberInput` con `useField`) ya cubre la mitad: conserva el valor inválido en rojo con su motivo hasta corregirlo o pulsar Escape. Falta que el mensaje sea texto visible y no solo `title`.

### UX-19 · Estar en un futuro alternativo casi no se nota
**Severidad:** alta · **Prioridad:** Ola 2, #19 · **Esfuerzo:** S–M · **Origen:** A-06 (amplía P0-8)
- **Ubicación:** botón de futuros, cifras del encabezado y carril "Caja".
- **Problema:** al bifurcar, lo único que nombra la rama es `.fin-futures__name`. Entre 1200 y 1439 px se trunca ("Rama des…") y su nombre accesible queda "Rama desde 11 nov 2". En el plan principal el botón es solo un ícono. Las cifras, el título "Caja" y la lectura no cambian según el futuro.
- **Evidencia:** `apps/web/src/finance/components/FuturesMenu.tsx:71-100`; `apps/web/src/styles/globals.css:3428-3447`; `apps/web/src/finance/visuals.ts:153`. Sonda `p6-fork-strip` (`nameClipped: true` a 1366, 1280 y 1200).
- **Impacto:** la persona edita o aplica arreglos en la rama creyendo que es su plan real (Rec corrige solo el futuro activo, P0-8).
- **Principio afectado:** Nielsen #1; #5.
- **Recomendación:**
  - Fuera del plan principal, una franja persistente: "Estás en **Rama desde 11 nov** (hipótesis) · Volver al plan principal". El veredicto (UX-14) dice "en esta rama".
  - El nombre del futuro activo no se trunca por debajo de ~20 caracteres.
  - En el plan principal se ve la palabra "Futuros".
- **Criterio de aceptación:** de 1200 a 1920 px, el nombre completo del futuro activo se ve sin hover y el regreso al principal está a un clic.

### UX-20 · Entre futuros no hay comparación en cifras: solo un fantasma y mantener Q
**Severidad:** alta · **Prioridad:** Ola 2, #20 · **Esfuerzo:** M · **Origen:** C-05 (nueva; P2-7 cubre incoherencias de Q)
- **Ubicación:** menú de futuros, encabezado y asomarse con Q.
- **Problema:** tras bifurcar y agregar una laptop, el encabezado solo muestra el futuro activo. El menú lista nombres sin cifras, y "Comparar" dibuja un fantasma. La única diferencia numérica es la pastilla de **mantener Q**, que exige una tecla física, no existe en táctil y solo se menciona dentro del menú.
- **Evidencia:** `apps/web/src/finance/components/FuturesMenu.tsx:139-150`, `:214-217`; `apps/web/src/components/PlaylistShell.tsx:1102-1108`, `:1223-1230`. Sonda `p04-futures`.
- **Impacto:** "¿me conviene comprar la laptop?" obliga a memorizar cifras entre futuros. En el teléfono no se puede.
- **Principio afectado:** Nielsen #6; #7; patrón de comparación lado a lado.
- **Recomendación:**
  - En cada fila del menú: "Al horizonte $X · mínimo $Y · Δ contra el activo".
  - Al comparar, un chip en el carril: "vs Plan principal: horizonte −$25,000".
  - Un botón "Asomarte" (≥ 44 px en táctil) equivalente a Q.
  - Resúmenes cacheados una vez por revisión de cada documento.
- **Criterio de aceptación:** con dos futuros, la diferencia de horizonte y de mínimo se lee sin teclado y sin cambiar de futuro.

### UX-21 · "Escenario" simula editando el plan real: "Soltar base" no revierte nada
**Severidad:** alta · **Prioridad:** Ola 2, #21 · **Esfuerzo:** M · **Origen:** C-04 (nueva)
- **Ubicación:** panel Análisis → "Escenario" (Fijar / Re-fijar / Soltar base).
- **Problema:**
  - El modelo es "fija la proyección y luego mutea o edita clips": se simula **modificando el plan**. "Soltar base" quita la comparación y los cambios se quedan guardados.
  - La nota pide silenciar líneas cuyas cabeceras quedan **debajo del propio panel**.
  - Duplica "Futuros" con otro modelo mental y otro vocabulario.
- **Evidencia:** `apps/web/src/finance/components/ScenarioPanel.tsx:129-150`; `apps/web/src/finance/components/FinancialSidePanel.tsx:21-24`. Sonda `p03-analysis`: Fijar base → "laptop 25000 hoy" → Soltar base; "Al horizonte" queda en $70,708 y la laptop sigue en `localStorage`.
- **Impacto:** la persona cree que está probando y cambia su plan.
- **Principio afectado:** Nielsen #3; #4; #2.
- **Recomendación:**
  - Convertir "Escenario" en la vista numérica de comparación entre futuros ("Comparar con: [Plan principal ▾]").
  - "Probar cambios" crea un futuro temporal y al terminar ofrece [Quedarme con los cambios] / [Descartar].
  - Si se conserva el anclaje: "Volver a la base" en una sola entrada de undo.
- **Criterio de aceptación:** tras "Descartar" o "Volver a la base", el horizonte y el plan guardado son idénticos a los de antes.

### UX-22 · Rec pide el saldo real sin decir cuánto supone la app ni qué va a cambiar, y no confirma al guardar
**Severidad:** alta · **Prioridad:** Ola 2, #22 · **Esfuerzo:** M · **Origen:** C-02 (nueva; el rendimiento de la tabla es P1-5)
- **Ubicación:** diálogo Rec y su cierre.
- **Problema:** el diálogo dice "supusimos que todo pasó como lo planeaste", pero nunca muestra la cifra supuesta. Marcar "No pasó" o escribir el saldo no muestra el resultado. Tras Guardar desaparece sin confirmación ni Deshacer, y aparece otro banner.
- **Evidencia:** `apps/web/src/finance/components/RecDialog.tsx:137-140`, `:201-217`; `apps/web/src/components/PlaylistShell.tsx:1154-1163`, `:1232`. Sonda `p06-rec` ("dialog shows any resulting cash? false").
- **Impacto:** para saber si su banco difiere, la persona tiene que recordar una cifra que la app no le enseña, y después no sabe si quedó registrado.
- **Principio afectado:** Nielsen #1; #6; #5.
- **Recomendación:**
  - Encabezado: "Hoy SliceX supone que tienes $5,708 (4 movimientos desde el 28 oct)".
  - Pie con resultado vivo: "$5,708 → $11,400 (ajuste +$5,692)", calculado con `rollForward` de forma diferida.
  - Tras Guardar, `role="status"`: "Registrado · caja hoy $11,400 · Deshacer".
- **Criterio de aceptación:** el diálogo muestra la caja supuesta y la resultante antes de Guardar, y al guardar hay una confirmación con Deshacer que se anuncia.

### UX-23 · El editor no muestra qué le hace el objeto a tu caja antes de guardar, y la barra "/" sí
**Severidad:** alta · **Prioridad:** Ola 2, #23 · **Esfuerzo:** M · **Origen:** B-03 (nueva; amplía la técnica de P1-10)
- **Ubicación:** editor (crear y editar), todos los tipos.
- **Problema:** el editor describe el calendario ("Pagas $500 una sola vez…"), pero no el efecto en el mínimo, el valle ni el horizonte. "/" sí lo hace con la misma API (`setPreview({kind:"add"})` + `getPreviewEffect()`).
- **Evidencia:** `apps/web/src/finance/components/CommandBar.tsx:52-57`, `:159-163` frente a `apps/web/src/finance/components/FinancialEditorModal.tsx:1010-1012`; `apps/web/src/finance/bridge-api.ts:35-49`. Sonda `p8-slash`: la misma renta en "/" muestra "Mín −$1,292 → −$58,792"; en el editor, nada.
- **Impacto:** simular antes de comprometerse, la tarea central del producto, no se puede hacer en la superficie de captura completa. UX-01, UX-07 y UX-08 llegan al plan sin verse.
- **Principio afectado:** Nielsen #1; #5; #4.
- **Recomendación:** bajo el readback, la línea "Tu caja: mínimo −$1,292 → −$X (27 nov) · al horizonte −$Y", con `setPreview` (crear: `add`; editar: `document`), usando `useDeferredValue` o un debounce de ~150 ms y una clave sin `name`. La vista previa se limpia al cerrar.
- **Criterio de aceptación:** cambiar monto, frecuencia o fecha actualiza la línea en ≤ 200 ms tras dejar de teclear, y "Cancelar" deja el carril sin vista previa.

### UX-24 · El onboarding no pregunta por deudas, y después "Compra con tarjeta" es un callejón sin salida
**Severidad:** alta · **Prioridad:** Ola 2, #24 · **Esfuerzo:** M · **Origen:** B-05 (nueva)
- **Ubicación:** onboarding; después, editor "Compra con tarjeta" o "MSI".
- **Problema:** el onboarding pide caja, sueldo, colchón y hasta 3 gastos fijos, sin forma de agregar más ni de capturar tarjetas, préstamos o MSI (el núcleo de [product-spec.md](product-spec.md) §4.3). Sin tarjetas, "Compra con tarjeta" dice "Agrega una con “+ Tarjeta”", pero ese botón no existe. Guardar queda deshabilitado y la única salida es perder el borrador.
- **Evidencia:** `apps/web/src/finance/components/FinancialEditorModal.tsx:393-403`; `apps/web/src/finance/components/Onboarding.tsx:63-67`. Sonda `p3-onboarding`: 0 botones "+ Tarjeta".
- **Impacto:** el plan real arranca sin los egresos más pesados, y la primera compra con tarjeta se atora.
- **Principio afectado:** Nielsen #2 (el texto nombra un control inexistente); #3; #7.
- **Recomendación:**
  - Bloque opcional en el onboarding: "¿Tienes tarjetas o préstamos?" (nombre, saldo, pago al mes, día), más "+ otra fila" en gastos.
  - En `CardSelect` sin tarjetas, "Crear tarjeta…" como sub-paso que vuelve al borrador con la tarjeta ya seleccionada.
- **Criterio de aceptación:** desde un plan sin tarjetas se registra una compra con tarjeta sin perder lo escrito, y ningún texto nombra un control inexistente.

### UX-25 · Pasar el cursor o tocar un objeto no muestra su información
**Severidad:** alta · **Prioridad:** Ola 2, #25 · **Esfuerzo:** M · **Origen:** D-05 (nueva; P2-20 trata el hover del DOM)
- **Ubicación:** clips del canvas, con cualquier zoom.
- **Problema:** fuera de la regla, el hover borra el tooltip. Con el zoom por defecto, "Pago Tarjeta Plata" queda en "Pago T…" y se pierde qué tarjeta es. En "Año", los eventos únicos son bloques rosas sin texto. En táctil no hay alternativa.
- **Evidencia:** `packages/canvas/src/playlist-interaction/controller.ts:1309-1327`; `packages/canvas/src/playlist-renderer-pixi/clip-node-registry.ts:264-277` (truncado por caracteres). Sondas `p3-drag`, `p10-zoom`.
- **Impacto:** responder "¿qué es esto y cuánto?" cuesta un doble clic y cerrar el editor. No se pueden comparar dos "Pago T…".
- **Principio afectado:** Nielsen #6; #7; WCAG 2.2 1.4.13 (si se agrega, debe poder descartarse y mantenerse visible).
- **Recomendación:**
  - Tarjeta de hover a ~350 ms (el ritmo de `MetricHelp`): nombre completo, tipo, monto, cadencia en palabras, próximo pago y fin o "Libre en…".
  - En táctil, la misma tarjeta al seleccionar con un toque.
  - El texto se calcula una vez por (revisión, clip) y se pinta por la vía de `setTooltip` (perf-canon §3.10).
  - Al truncar, conservar el monto y usar elipsis media ("Pago T… Plata").
- **Criterio de aceptación:** en "Año", el hover sobre cualquier evento muestra nombre y monto; en táctil lo muestra un toque; Esc la cierra.

### UX-26 · Las consecuencias financieras no se anuncian, y la tarjeta del valle queda a 22 Tabs de quien la abrió
**Severidad:** alta · **Prioridad:** Ola 2, #26 · **Esfuerzo:** S · **Origen:** E-04 + A-11 + C-15 (amplían P2-1, P2-25 y P2-27)
- **Ubicación:** chip de alertas, "Mínimo proyectado", "Próximo pago", tarjeta del valle, banners y vista previa del estado de cuenta.
- **Problema:**
  - **Nada se anuncia.** "Aplicar" en el valle (2 alertas → "Sin alertas") y bajar "Liquidez hoy" (0 → 4 alertas) no llegan a ninguna región viva. El único anuncio de la sesión fue el rango visible.
  - **No hay región estable.** El chip es `<button>` o `<span role="status">` según el conteo, así que la región se monta y desmonta.
  - **Los saltos no se ven con teclado.** Saltar desde "Mínimo proyectado" o desde una alerta mueve el cursor en silencio (`aria-live="off"`). La tarjeta del valle aparece después del canvas: de "Mínimo proyectado" a "Aplicar" hay **22 Tabs**.
  - **Causas sin nombre accesible.** Cada alerta dice "27 nov Liquidez proyectada −$1,292"; la causa solo vive en `title`.
- **Evidencia:** `apps/web/src/finance/components/FinancialSummaryBar.tsx:526-557`, `:580-584`; `apps/web/src/finance/components/PlayheadReadout.tsx:31-37`; `apps/web/src/finance/components/ValleyCard.tsx:64-68`; `apps/web/src/finance/components/StatementDialog.tsx:171-186`; `apps/web/src/components/PlaylistShell.tsx:1216-1283`. Sondas `s12` (MutationObserver) y `p02-valley`.
- **Impacto:** quien usa lector puede guardar un gasto que lo deja en rojo sin enterarse, aunque en pantalla el chip se ponga rojo.
- **Principio afectado:** WCAG 2.2 4.1.3 Mensajes de estado (AA); 2.4.3 Orden del foco (A); Nielsen #1.
- **Recomendación:**
  - Una sola región `role="status"` persistente en el shell, que el bridge actualiza **al cerrar un commit** (Guardar, Aplicar, soltar gesto, Rec), nunca por `pointermove`. Ejemplo: "Guardado. Tu punto más bajo: −$1,292 el 27 nov · 3 alertas".
  - El chip de alertas siempre es `<button>`.
  - Al saltar desde el encabezado o una alerta, el foco va al título de la tarjeta del valle (con regreso al cerrarla).
  - Alertas con nombre completo: "27 nov: −$1,292, lo causa BBVA. Ver arreglos".
- **Criterio de aceptación:** la sonda registra un anuncio tras "Aplicar" y tras editar "Liquidez hoy", y "Aplicar" queda a 3 Tabs o menos de "Mínimo proyectado".

### UX-27 · Abrir o cerrar superficies pierde el foco en 9 de 14 casos, y cada una tiene su propio contrato de cierre
**Severidad:** alta · **Prioridad:** Ola 2, #27 · **Esfuerzo:** M · **Origen:** E-03 + E-10 (agrupan como causa raíz P0-20, P2-3, P2-4, P2-13 y P2-27)
- **Ubicación:** Análisis, Inspector, onboarding, calendario del editor, tarjeta del valle, Rec, estado de cuenta, barra "/" y menú contextual.
- **Problema:**
  - **El foco cae a `<body>`** al abrir o cerrar Análisis e Inspector (el botón con el foco se desmonta), al pulsar Escape en onboarding, calendario, Rec y estado de cuenta, y al pulsar "Aplicar" en el valle.
  - **La barra "/"** devuelve el foco al canvas, no a quien la abrió.
  - **Escape** no cierra Análisis, Inspector ni la tarjeta del valle.
  - **Clic fuera** cierra los menús, descarta los diálogos sin preguntar y no hace nada en "/".
  - **Recetas distintas:** hay tres formas de manejar Escape (`useDismiss`, `keydown` en `window` por diálogo y `onKeyDown` local), y la restauración de foco existe solo dentro del editor.
- **Evidencia:** `apps/web/src/ui/use-dismiss.ts:33-63`; `apps/web/src/finance/components/FinancialSidePanel.tsx:25-60`; `apps/web/src/components/PlaylistInspector.tsx:81-106`; `apps/web/src/finance/components/Onboarding.tsx:224-229`; `apps/web/src/finance/components/DateField.tsx:182-188`, `:269`; `apps/web/src/finance/components/RecDialog.tsx:97-101`; `apps/web/src/finance/components/StatementDialog.tsx:76-80`; `apps/web/src/finance/components/CommandBar.tsx:69`; `apps/web/src/finance/components/FinancialEditorModal.tsx:475-493`, `:582-591`. Sondas `s3`, `s12`, `s13`, `s16` (tabla "Restauración de foco" del informe E).
- **Impacto:** cada pérdida reinicia el recorrido: volver a "Empezar" cuesta 26 Tabs. Además, no se puede aprender una regla de cierre.
- **Principio afectado:** WCAG 2.2 2.4.3 (A); APG Dialog ("on close, focus returns to the invoking element"); Nielsen #4; #3.
- **Recomendación:**
  - Un solo `useOverlay({ kind, initialFocus, restoreFocus, closeOnEscape, closeOnOutside })` en `apps/web/src/ui/`, sobre `useDismiss` y un `useRestoreFocus` extraído del editor.
  - Una **pila de Escape**: solo cierra la superficie de arriba.
  - "Clic fuera = cerrar" solo para menús y popovers; los modales con cambios preguntan antes de descartar.
  - Análisis e Inspector usan un mismo botón con `aria-expanded`.
- **Criterio de aceptación:** ninguna apertura o cierre deja `document.activeElement === body`, y ningún componente de `finance/components` registra su propio `keydown` de Escape.

### UX-28 · Funciones que solo existen como gesto, hover o tecla mantenida
**Severidad:** alta · **Prioridad:** Ola 2, #28 · **Esfuerzo:** M · **Origen:** E-02 + D-16 (complementan P2-17)
- **Ubicación:** canvas (borde derecho de deudas, agarradera y divisor de línea, cuerpo del clip) y la tecla A.
- **Problema:**
  - **Búsqueda de objetivo** ("¿cuánto pago para quedar libre en X?"): el código dice "Only inside a user pointer gesture (never for editor saves)".
  - **"Tu año sin esto"** exige cursor sobre el clip y mantener A; el menú del objeto no lo ofrece.
  - **Reordenar líneas, mover un objeto a otra línea y cambiar el alto de línea** solo se pueden hacer arrastrando (agarradera de 16 px, divisor de 5 px).
- **Evidencia:** `apps/web/src/finance/financial-bridge.ts:1101`, `:1140-1150`; `apps/web/src/components/PlaylistShell.tsx:281-405` (menús), `:1110-1117` (A); `packages/canvas/src/playlist-core/presentation.ts:585-596`. Sonda `s11`.
- **Impacto:** la mecánica estrella de deudas de la Ola 2 y la simulación más directa quedan fuera para teclado, switch, voz, motricidad fina y táctil. En táctil la única salida es Silenciar, que sí cambia el plan (UX-03).
- **Principio afectado:** WCAG 2.2 2.5.7 Movimientos de arrastre (AA); 2.1.1 (A); 2.5.1; Nielsen #7.
- **Recomendación:**
  - En el editor de préstamos y tarjetas: "Quiero liquidarla el [fecha]" → `solveDebtPayment` → "Pago necesario $X/mes · libre en…", con el mismo texto que la píldora.
  - Menú del objeto: "Ver mi año sin esto" (alternancia con "Listo"/Esc, reutilizando `startPeek`/`endPeek`).
  - Menú de línea: "Subir / Bajar línea" y "Altura".
  - Editor: un select "Línea de evento".
- **Criterio de aceptación:** cada operación de la lista se completa con clics sueltos y con teclado, sin `pointermove` con el botón pulsado, y "tu año sin esto" funciona desde el long-press sin cambiar el plan guardado.

### UX-29 · Con zoom del 200–400 % o a 320–360 px el marco fijo se come el plan y los diálogos se salen
**Severidad:** alta · **Prioridad:** Ola 2, #29 · **Esfuerzo:** M · **Origen:** A-07 + E-08 + C-16 (amplían P2-18, P2-19 y P2-21)
- **Ubicación:** layout del shell, banners, diálogos y menú de futuros.
- **Problema:**
  - A 640×360 (1280×720 al 200 %), el encabezado mide 158 px (44 %), el escenario 184 px, y el banner tapa la primera línea: se ve media línea del plan.
  - A 320×256 (400 %), el encabezado ocupa el **62 %**, el escenario 80 px, y el banner se encima sobre la navegación.
  - `body { overflow: hidden }`: lo que no cabe se pierde.
  - A 320 px, el editor y el onboarding se salen 23 px y el menú de futuros 8 px. A 360 px, los selects de Rec quedan cortados (x 274–374 con el diálogo terminando en 355).
- **Evidencia:** `apps/web/src/finance/shell-metrics.ts:19-23`; `apps/web/src/styles/globals.css:155-168`, `:280-286`, `:791-793`, `:2552-2554`, `:2911-2922`, `:2970-2989`, `:3206`, `:3287-3310`. Sondas `p12-zoom200`, `s7`, `s8`, `p08-mobile`.
- **Impacto:** una persona con baja visión ve el encabezado, la curva y ningún objeto financiero. En el teléfono no ve qué está corrigiendo en Rec.
- **Principio afectado:** WCAG 2.2 1.4.10 Reflow (AA) y 1.4.4 (AA); el lienzo 2-D está exento, el marco no. Nielsen #8.
- **Recomendación:**
  - Con alto ≤ 500 px: encabezado de un renglón (veredicto + Nuevo + "Más"), carril Caja plegable a ~40 px y banners en el flujo, sin superponerse. Requiere métricas del core cambiables en caliente (P2-19), sin remontar core, bridge ni futuros.
  - `min-width: min(320px, 100%)` en los flotantes.
  - Rec en bloques bajo 480 px.
- **Criterio de aceptación:** a 640×360 con el banner visible se ven al menos 3 líneas completas, y a 320 px ningún control queda fuera sin desplazamiento posible.

---

## Ola 3 · Captura, lenguaje y accesibilidad estructural

### UX-30 · El editor llena los montos con valores inventados; el onboarding hace lo contrario
**Severidad:** media · **Prioridad:** Ola 3, #30 · **Esfuerzo:** S · **Origen:** B-10 (nueva)
- **Ubicación:** editor en modo crear, todos los tipos.
- **Problema:** los borradores traen valores reales, no ejemplos: Ingreso $1,000/mes, Gasto $500, Préstamo $1,000 × 13, Tarjeta al 60 % con mínimo $0, Compra $1,000 cargada a la **primera tarjeta del plan**, MSI $6,000 a 6. Se guardan tal cual. El onboarding, en cambio, deja los campos vacíos con ejemplos.
- **Evidencia:** `packages/core/src/finance/items.ts:111-160`; `apps/web/src/finance/financial-bridge.ts:827-841`. Sonda `p1` ("Compra con tarjeta" preselecciona Nu entre Nu y BBVA).
- **Impacto:** se guardan montos que nadie decidió y compras cargadas a la tarjeta equivocada. UX-01 es el caso grave de este patrón.
- **Principio afectado:** Nielsen #5; #4.
- **Recomendación:** en crear, montos vacíos y obligatorios ("Escribe el monto"). Con 2 tarjetas o más, "Selecciona…" sin preselección. Conservar las inferencias legítimas (fecha = cursor, nombre por tipo).
- **Criterio de aceptación:** Guardar un borrador sin tocar los montos pide el monto en lugar de guardar $500 o $1,000.

### UX-31 · "Tipo" es el 2.º campo y cambiarlo, incluso con las flechas, reinicia monto y frecuencia
**Severidad:** media · **Prioridad:** Ola 3, #31 · **Esfuerzo:** S · **Origen:** B-08 (amplía P2-13)
- **Ubicación:** select "Tipo" del editor.
- **Problema:** el tipo ya se eligió en "Nuevo", pero ocupa una fila y una parada de Tab. `switchKind` rehace el objeto con los valores por defecto del tipo nuevo y `KindFields` se remonta. En Chrome de Windows, ↑/↓ sobre el select cerrado cambian el tipo en cada tecla.
- **Evidencia:** `apps/web/src/finance/components/FinancialEditorModal.tsx:153-204`, `:835-852`. Sonda `p5-edit-kind`: Gasto 8,000 "Cada mes" → Tarjeta → Gasto = **500 · Una vez**.
- **Impacto:** quien solo mira las opciones pierde lo que capturó, en silencio.
- **Principio afectado:** Nielsen #3; #5; la pregunta de estructura va antes que "¿cuánto?".
- **Recomendación:**
  - En crear, el tipo en el título con "Cambiar tipo…" secundario.
  - En editar, convertir con confirmación (P2-13).
  - Un borrador por tipo, para que volver restaure lo capturado.
- **Criterio de aceptación:** Gasto → Tarjeta → Gasto conserva 8,000 y "Cada mes".

### UX-32 · Dos estrategias de error opuestas, y el resumen nombra campos que no se ven
**Severidad:** media · **Prioridad:** Ola 3, #32 · **Esfuerzo:** S · **Origen:** B-12 (amplía P2-27)
- **Ubicación:** editor y onboarding.
- **Problema:**
  - El editor valida en cada tecla y deshabilita "Guardar", que entonces no recibe foco. El onboarding valida al enviar y deja el foco en el botón, no en el campo inválido.
  - El resumen dice "**Empieza**: fecha inválida." cuando el campo se llama "Fecha".
  - Un monto vacío dice "escribe un número".
- **Evidencia:** `apps/web/src/finance/components/FinancialEditorModal.tsx:1054`; `apps/web/src/finance/item-schema.ts:64`; `apps/web/src/finance/components/Onboarding.tsx:237`. Sondas `p2`, `p3`.
- **Impacto:** se aprenden dos comportamientos para lo mismo, y con teclado no se llega al campo que falla.
- **Principio afectado:** Nielsen #4; #9; WCAG 2.2 3.3.1 / 3.3.3.
- **Recomendación:**
  - Validar al salir del campo y al enviar, con "Guardar" siempre habilitado.
  - Al fallar, enfocar el primer `[aria-invalid=true]` (`onSubmit(…, onValidationFailure)`).
  - `fieldLabel` con la etiqueta visible, y "Escribe el monto" para el monto vacío.
- **Criterio de aceptación:** enviar con errores en cualquiera de los dos deja el foco en el primer campo inválido, y el resumen nombra esa etiqueta exacta.

### UX-33 · Tarjeta y MSI sin readback; "/" y el editor calculan primeros abonos distintos
**Severidad:** media · **Prioridad:** Ola 3, #33 · **Esfuerzo:** M · **Origen:** B-07 (nueva)
- **Ubicación:** editor (tipos Tarjeta y MSI) y barra "/".
- **Problema:**
  - `ScheduleReadback` solo existe para tipos con frecuencia: en tarjeta no hay una frase "cortas el 11, pagas el 21; primer pago 21 nov", y en MSI no se ven el primer ni el último abono.
  - Para el mismo MSI, el editor propone "Empieza = hoy" (abono el 26 nov) y "/" supone el mes siguiente (abono el 26 dic).
  - En totalero siguen visibles "Tasa anual" y "Pago mínimo", que el motor ignora.
- **Evidencia:** `apps/web/src/finance/components/FinancialEditorModal.tsx:1010`; `packages/core/src/finance/payoff.ts:313-322`; `apps/web/src/finance/command.ts:38-40`, `:1259`; `packages/core/src/finance/types.ts:146-148`. Sondas `p1`, `p8`.
- **Impacto:** el dato clave (cuándo sale el dinero) no se confirma, y dos caminos dan cajas distintas.
- **Principio afectado:** Nielsen #1; #4; #2.
- **Recomendación:**
  - Readback por tipo (tarjeta: corte, pago y próximo pago; MSI: primer y último abono).
  - "Fecha de compra" en lugar de "Empieza" en MSI y compra.
  - Una sola convención de primer abono, derivada de corte y pago, compartida por "/" y el editor.
  - Atenuar tasa y mínimo en totalero.
- **Criterio de aceptación:** cada tipo muestra la fecha del próximo movimiento de caja antes de guardar, y "/" y el editor dan el mismo primer abono para la misma compra.

### UX-34 · El día de pago se captura de tres formas, y el editor muestra un "Empieza" que no es día de pago
**Severidad:** media · **Prioridad:** Ola 3, #34 · **Esfuerzo:** M · **Origen:** B-09 (nueva)
- **Ubicación:** onboarding, editor de recurrentes y editor de tarjeta.
- **Problema:** el mismo dato ("¿qué día del mes?") se pide como texto "día" (onboarding), como números "Día de corte / Día de pago" (tarjeta) y como fecha completa en "Empieza" (recurrentes). El sueldo creado con "próximo pago 25/11" se abre con "Empieza 11/11/2026", fecha en la que no hay ningún cobro.
- **Evidencia:** `apps/web/src/finance/components/Onboarding.tsx:107-117`, `:377-384`; `apps/web/src/finance/components/FinancialEditorModal.tsx:895-914`. Sonda `p10-onb-to-editor`.
- **Impacto:** para "renta el día 1" hay que teclear una fecha completa y entender que su día es el de pago. Al revisar, el campo contradice el calendario.
- **Principio afectado:** Nielsen #4; #2; #6.
- **Recomendación:** en recurrentes mensuales, un control "Día de pago: [1–31 | último día]" y "Primer pago" (la primera ocurrencia real) en lugar de "Empieza". El mismo control de día en los tres formularios.
- **Criterio de aceptación:** el sueldo del onboarding abre con "Primer cobro 25/11/2026 · Día 25".

### UX-35 · El editor, el onboarding y el encabezado no entienden lo que "/" sí entiende
**Severidad:** media · **Prioridad:** Ola 3, #35 · **Esfuerzo:** S · **Origen:** B-14 (nueva, compatible con P2-10)
- **Ubicación:** `DateField` (editor y "¿Cuándo es tu próximo pago?") y campos de monto, incluido `InlineNumberInput`.
- **Problema:** `parseDateInput` rechaza "15", "el 15", "hoy", "mañana" y "fin de mes". `parseNumberInput` rechaza "12 mil". La barra "/" acepta todo eso. En el onboarding, la respuesta natural "el 15" da "No reconocida".
- **Evidencia:** `apps/web/src/finance/format.ts:143`, `:296-379`; `apps/web/src/finance/command.ts:23-26`. Sondas `p2`, `p8`.
- **Impacto:** hay que reaprender qué escribir en cada superficie, justo en el primer contacto.
- **Principio afectado:** Nielsen #4; #2; #7.
- **Recomendación:** `parseDateInput` acepta día suelto y las palabras relativas (con un parámetro `today`, sigue siendo pura). `parseNumberInput` acepta "mil" y "k". Los helpers se comparten con `command.ts`.
- **Criterio de aceptación:** esas cadenas dan el mismo valor en el editor, el onboarding, el encabezado y "/".

### UX-36 · "Guardar" queda fuera de vista en laptops comunes: el pie del diálogo no es fijo
**Severidad:** media · **Prioridad:** Ola 3, #36 · **Esfuerzo:** S · **Origen:** B-11 (amplía P2-21)
- **Ubicación:** editor y onboarding a 1280×720, 1366×768 y 360×740.
- **Problema:** el modal hace scroll entero y el pie "Cancelar / Guardar" es estático. En Préstamo, con 960 px de contenido, "Guardar" cae en y=951 a 1280×720, y queda oculto a 1366×768 y a 360×740.
- **Evidencia:** `apps/web/src/styles/globals.css:794`, `:2263-2270`, `:3068-3072`. Sondas `p4-layout`, `p7-360`.
- **Impacto:** no se ven la acción principal ni el readback, que es la mejor defensa contra errores.
- **Principio afectado:** Nielsen #1; #8; WCAG 1.4.10.
- **Recomendación:** cabecera y pie `position: sticky` dentro del modal, con scroll solo en el cuerpo. En el onboarding, el nombre a todo el ancho por debajo de 480 px.
- **Criterio de aceptación:** "Guardar" y "Crear mi año" son visibles sin scroll en los tres viewports, para todos los tipos.

### UX-37 · "Termina" cambia de opción con solo pasar el foco, y el readback se anuncia en cada tecla
**Severidad:** media · **Prioridad:** Ola 3, #37 · **Esfuerzo:** S · **Origen:** B-13 (amplía P2-27; la parte de radiogroup está en UX-57)
- **Ubicación:** editor, bloque "Cuándo".
- **Problema:** pasar con Tab por "Número de pagos" (`onFocus`) cambia la opción marcada de "El" a "Después de". El readback (`role="status"`) se reanuncia completo en cada tecla, con estados intermedios engañosos ("desde el mar 15 dic **2020**"). Teclear un monto y una fecha produjo 12 anuncios.
- **Evidencia:** `apps/web/src/finance/components/FinancialEditorModal.tsx:354`, `:951`, `:997`. Sondas `p1`, `p9-live`.
- **Impacto:** el estado cambia sin que la persona actúe, y con lector de pantalla el formulario "habla" sin parar.
- **Principio afectado:** WCAG 2.2 3.2.1 Al recibir el foco (A); 4.1.3 (AA).
- **Recomendación:** cambiar el modo de "Termina" solo al teclear o elegir. Anunciar el readback con debounce (~600 ms) o al salir del campo, nunca con una fecha parcial.
- **Criterio de aceptación:** Tab no altera "Termina", y teclear un monto produce un solo anuncio.

### UX-38 · Con un objeto seleccionado, ← → cambian su fecha, pero la ayuda dice que mueven el cabezal
**Severidad:** media · **Prioridad:** Ola 3, #38 · **Esfuerzo:** S · **Origen:** D-09 (amplía P2-14)
- **Ubicación:** teclado sobre el canvas y ayuda "Cómo moverte".
- **Problema:** la ayuda solo documenta "← → Mueve el día del playhead". Después de un clic en un clip, las flechas mueven su fecha sin píldora ni tooltip. En la sonda, 3 × → llevaron "Gasto" del 24 al 27 nov sin ninguna señal.
- **Evidencia:** `packages/canvas/src/playlist-interaction/controller.ts:2163-2193`; `apps/web/src/finance/components/NavControls.tsx:217`. Sonda `p11-keys-level`.
- **Impacto:** la persona cree que navega y está editando su plan.
- **Principio afectado:** Nielsen #1; #4; #5.
- **Recomendación:** cada empuje con teclado muestra 1.5 s la píldora del arrastre ("Gasto: 24 nov → 27 nov · Mín…"), y la ayuda documenta ambos comportamientos. Opcional: Alt+flechas para mover fechas.
- **Criterio de aceptación:** cada empuje muestra la fecha antes y después.

### UX-39 · "Monto con la mano": una zona invisible de 5 px convierte un arrastre horizontal en cambio de monto
**Severidad:** media · **Prioridad:** Ola 3, #39 · **Esfuerzo:** S · **Origen:** D-08 (nueva)
- **Ubicación:** borde superior de cualquier clip.
- **Problema:** presionar en el borde superior (5 px) entra en modo monto. Ahí solo cuenta el eje Y, con ganancia exponencial (48 px = +49 %), sin paso fino y con un asa que solo se ve con hover. Un arrastre de 120 px a la derecha con 2–3 px de temblor dejó el monto en $2,050 (antes $2,000) y la fecha sin cambio.
- **Evidencia:** `packages/canvas/src/playlist-interaction/hit-test.ts:105-106`, `:289-297`; `apps/web/src/finance/financial-bridge.ts:134`, `:175-179`, `:563-600`. Sondas `p11-keys-level`, `p3-drag`.
- **Impacto:** cambios de monto involuntarios en un gesto frecuente.
- **Principio afectado:** Nielsen #5; WCAG 2.2 2.5.8.
- **Recomendación:** bloqueo de eje (si en los primeros 6 px domina |dx|, el gesto pasa a ser mover). Activar el monto solo desde el asa visible, de ≥ 24 px en `pointer: coarse`. Tooltip "−$2,050 (antes $2,000)", y Shift para paso fino.
- **Criterio de aceptación:** un arrastre mayormente horizontal mueve la fecha y no altera el monto.

### UX-40 · Cifras dentro de los clips sin unidad, y textos que siguen al cabezal sin decir de qué fecha hablan
**Severidad:** media · **Prioridad:** Ola 3, #40 · **Esfuerzo:** S · **Origen:** D-14 (nueva)
- **Ubicación:** texto de detalle de tarjetas, MSI y recurrentes.
- **Problema:** "Debes $30,069 · 83 % de tu pago es interés · **99.9 %**" (el último es la tasa, sin rótulo). "3/12" va sin "pagos". "/quinc" es una abreviatura inventada. Con el cabezal en el 2 mar, el clip dice "Debes $25,513" mientras el encabezado dice "Deuda hoy $149,510".
- **Evidencia:** `apps/web/src/finance/visuals.ts:381`, `:394`, `:404`; `apps/web/src/finance/labels.ts:46-53`; `apps/web/src/finance/financial-bridge.ts:417-432`. Sonda `p12-playhead`.
- **Impacto:** hay cifras que adivinar y dos "deudas" en pantalla sin explicación.
- **Principio afectado:** Nielsen #2; #4.
- **Recomendación:** "tasa 99.9 %", "pago 3 de 12" y "/quincena". Con el cabezal fuera de hoy: "Al 2 mar: debes $25,513", o un chip "Viendo el 2 mar · Volver a hoy".
- **Criterio de aceptación:** ningún número de un clip queda sin unidad, y fuera de hoy se indica la fecha descrita.

### UX-41 · Los eventos de un día se dibujan como bloques de 7 días
**Severidad:** media · **Prioridad:** Ola 3, #41 · **Esfuerzo:** S (marca del día) / L (geometría en px) · **Origen:** D-13 (nueva; P0-18 trata sus asas)
- **Ubicación:** clips de frecuencia única.
- **Problema:** para que quepa el nombre, un pago de un día ocupa 7 días de geometría. En "Mes", "Gasto" (24 nov) parece durar del 24 al 30. Dos pagos a 3 días se pisan y abren un segundo carril. En "Año" son bloques de ~20 px sin texto.
- **Evidencia:** `apps/web/src/finance/mapping.ts:52-56` (`POINT_CLIP_DAYS = 7`). Sonda `p10-zoom`.
- **Impacto:** se lee mal cuándo sale el dinero justo en las vistas donde se planea la quincena.
- **Principio afectado:** Nielsen #2; integridad del eje temporal.
- **Recomendación:** una marca fuerte en el día real (la misma de los recurrentes) y el resto del bloque como etiqueta tenue, sin borde de duración. A medio plazo, ancho de etiqueta en px (evaluar `lanes.ts` y perf-canon §3.15).
- **Criterio de aceptación:** en "Mes" el día del pago se distingue sin hover.

### UX-42 · Los íconos de la cabecera de línea miden 16 px, no tienen nombre y desaparecen con el cursor encima
**Severidad:** media · **Prioridad:** Ola 3, #42 · **Esfuerzo:** S · **Origen:** D-11 (nueva)
- **Ubicación:** columna de cabeceras de línea (ojo, enfoque, candado).
- **Problema:** los íconos aparecen con hover en la fila, pero el hover sobre el propio botón cuenta como "sin hover" y los oculta: el cursor `pointer` queda sobre un hueco. Miden 16×16 px y no tienen tooltip, y el ojo no comunica "excluir de tus cifras" (UX-03).
- **Evidencia:** `packages/canvas/src/playlist-interaction/controller.ts:458-506`; `packages/canvas/src/playlist-renderer-pixi/layers/track-rows.ts:309`, `:340-343`; `packages/canvas/src/playlist-core/types.ts:548`. Sonda `p14-eye`.
- **Impacto:** se acciona un control que no se ve, y su efecto es el más delicado del producto.
- **Principio afectado:** WCAG 2.2 2.5.8 (con equivalente en el menú de línea); Nielsen #1; #6.
- **Recomendación:** los hits de botón cuentan como hover de su fila. Tooltip con nombre y efecto ("Excluir de tus cifras", "Ver solo esta línea", "Bloquear"), y área de hit ≥ 24 px sin cambiar el dibujo.
- **Criterio de aceptación:** el ícono sigue visible con el cursor encima y muestra su nombre.

### UX-43 · Herramientas, menús y atajos con vocabulario DAW, y "Cortar" choca con "fecha de corte"
**Severidad:** media · **Prioridad:** Ola 3, #43 · **Esfuerzo:** S · **Origen:** A-14 + D-15 (amplían P2-2 y P3-1)
- **Ubicación:** toolbar, menús de línea y de objeto, tooltips.
- **Problema:**
  - **Atajos de FL.** Los `title` dicen "Silenciar (T)", "Seleccionar (E)", "Dibujar (P)" y "Borrar (D)", que son mnemotecnias en inglés.
  - **Términos de mezcladora.** "Silenciar" y "Solo esta línea de evento" / "Quitar solo" no dicen que la cosa sale de la caja.
  - **Choques de vocabulario.** "Cortar" choca con "corte" (el término de tarjeta del editor, de "/" y de la píldora) y con el cortar del portapapeles.
  - **"Dibujar"** no hace nada con un clic simple en el vacío, y no avisa.
- **Evidencia:** `apps/web/src/components/PlaylistShell.tsx:147-200`, `:296-308`; `packages/canvas/src/playlist-interaction/controller.ts:98-107`; `apps/web/src/finance/item-schema.ts:57`; `apps/web/src/finance/components/FinancialEditorModal.tsx:905`. Sonda `p1-overview`.
- **Impacto:** aprender las herramientas exige traducir conceptos de audio, y "Silenciar" no se usa para simular o se usa sin entender su efecto.
- **Principio afectado:** Nielsen #2; #4; #6; brief de producto ("nada de estética DAW").
- **Recomendación:**
  - Conservar capacidades y teclas, con tooltip rico (nombre + efecto en dinero + tecla). Ejemplo: "Excluir (T): ¿y si no pasara? Lo saca de tus cifras sin borrarlo".
  - Renombrar: "Dividir" en lugar de Cortar, "Excluir" en lugar de Silenciar, "Ver solo esta línea / Ver todas".
  - Mostrar la letra junto al ícono en `pointer: fine`.
  - Agregar los términos al glosario y al lint de P3-1.
- **Criterio de aceptación:** ninguna etiqueta coincide con un término de los formularios, y cada herramienta describe su efecto financiero.

### UX-44 · Las cabeceras de línea no dicen qué hay en cada línea: nueve veces "Línea de evento"
**Severidad:** media · **Prioridad:** Ola 3, #44 · **Esfuerzo:** M · **Origen:** A-08 + D-17 (amplían P1-24)
- **Ubicación:** panel de cabeceras (216 px).
- **Problema:** por decisión de canon, toda línea sin nombre propio se llama "Línea de evento" o "Línea de eventos", a 13 px/600. Lo que identifica su contenido queda en un subtítulo gris de 11 px o en un clip fuera de vista. Cada cabecera lleva además un medidor de 3 px sin etiqueta, que se lee como un fader.
- **Evidencia:** `apps/web/src/finance/labels.ts:66-90`; `apps/web/src/finance/visuals.ts:458-483`; `packages/canvas/src/playlist-renderer-pixi/layers/track-rows.ts:138-176`, `:326-337`; [project-canon.md](project-canon.md) §2. Sonda `p8-rows`.
- **Impacto:** el 15 % del ancho repite el mismo texto, y para saber qué hay en una línea hay que desplazarse hasta su clip.
- **Principio afectado:** Nielsen #6; #8; #2.
- **Recomendación:** un título **derivado en vivo, nunca persistido**, a partir del contenido ("Sueldo"; "Pago Tarjeta Plata +1"). El nombre propio de la persona siempre gana. Enmendar [project-canon.md](project-canon.md) §2. El medidor lleva texto ("Peso en tu año") o se retira.
- **Criterio de aceptación:** en "Año" y desplazado 4 meses, cada línea no vacía nombra al menos uno de sus objetos.

### UX-45 · Los gestos que cambian dinero, la sintaxis de "/" y los atajos de simulación no se enseñan en ningún lado
**Severidad:** media · **Prioridad:** Ola 3, #45 · **Esfuerzo:** S · **Origen:** D-10 + C-11 (nuevas; P2-25 cubre la ARIA de "/")
- **Ubicación:** popover "?" ("Cómo moverte"), barra "/" y lienzo.
- **Problema:**
  - La ayuda lista 11 filas, todas de navegación. No dice que arrastrar cambia la fecha, que el borde derecho cambia el fin o calcula el pago de una deuda, que el borde superior cambia el monto, ni nada de Alt, Shift+arrastrar, doble clic, A, Q, "/" o pegar sobre una tarjeta.
  - En "/", el placeholder con ejemplos se reemplaza por un texto fantasma que parece ya escrito.
  - "ayuda", "deshacer" y "borra netflix" reciben el mismo "Escribe un monto".
- **Evidencia:** `apps/web/src/finance/components/NavControls.tsx:209-221`; `apps/web/src/finance/components/CommandBar.tsx:109-111`, `:122`, `:155-157`; `apps/web/src/components/PlaylistShell.tsx:1102-1131`. Sonda `p05-command`.
- **Impacto:** las capacidades diferenciales de la Ola 2 (monto con la mano, búsqueda de objetivo, A, Q) quedan para quien lea el código.
- **Principio afectado:** Nielsen #10 Ayuda y documentación; #6; #9.
- **Recomendación:**
  - Una sección "Editar con la mano" y otra "Atajos" en la misma ayuda, con la consecuencia financiera de cada gesto.
  - Una pista única la primera vez que se selecciona un objeto.
  - En "/", una línea fija de ejemplos y mensajes según la causa ("Desde aquí solo se agregan movimientos: selecciona el objeto y pulsa Supr").
- **Criterio de aceptación:** cada gesto con efecto en dinero y cada atajo aparecen en la ayuda, y los ejemplos se ven con la barra vacía.

### UX-46 · El rango visible casi nunca tiene nombre ("118 d") y el zoom vive en dos sitios
**Severidad:** media · **Prioridad:** Ola 3, #46 · **Esfuerzo:** S · **Origen:** A-13 (nueva)
- **Ubicación:** `NavControls` y herramienta "Zoom".
- **Problema:** el select de rango muestra "118 d", "51 d" o "11 d" según el ancho, y tras zoom "66 d" o "162 d"; "0" deja "Año", no "Todo". El zoom se reparte entre la herramienta (una lupa que se lee como "buscar"), el rango y los atajos. "Ver todo" tiene dos significados.
- **Evidencia:** `apps/web/src/finance/components/NavControls.tsx:23-30`, `:68-71`, `:128-145`; `apps/web/src/components/PlaylistShell.tsx:190-199`, `:1245-1249`. Sondas `p1-overview`, `p4-interact`.
- **Impacto:** "118 d" no le dice a nadie qué está viendo.
- **Principio afectado:** Nielsen #4; #2; #6.
- **Recomendación:** el rango en palabras ("≈ 2 meses" o "11 nov – 22 feb") con − / + junto a él. Conservar la herramienta Zoom con una lupa con "+". "0" selecciona "Todo". "Ver todos los gestos" en el banner.
- **Criterio de aceptación:** tras cualquier zoom el control muestra un rango legible sin la unidad "d".

### UX-47 · "Análisis" esconde dos herramientas de alto valor tras un nombre genérico y, al abrirse, tapa lo que necesitan
**Severidad:** media · **Prioridad:** Ola 3, #47 · **Esfuerzo:** S–M · **Origen:** A-12 (amplía P2-18; el Inspector es P0-4)
- **Ubicación:** pestaña "▸ Análisis" y `FinancialSidePanel`.
- **Problema:** la pestaña no dice que contiene la comparación de escenario y la estrategia de deudas. Al abrirse, el riel de 372 px se **superpone** desde x=6 y tapa las cabeceras de línea que su propio flujo pide usar. El Inspector usa el mismo glifo en sentido opuesto.
- **Evidencia:** `apps/web/src/finance/components/FinancialSidePanel.tsx:21-45`; `apps/web/src/styles/globals.css:1439-1452`, `:1534-1556`. Sonda `p4-interact`.
- **Impacto:** la estrategia de deudas depende de que alguien abra "Análisis" por curiosidad.
- **Principio afectado:** Nielsen #6; #2; #8.
- **Recomendación:** nombrarlo por tarea ("Comparar y pagar deudas"). Abrir **empujando** el escenario: el host se encoge y el `ResizeObserver` del renderer ya cubre el cambio, sin remontar.
- **Criterio de aceptación:** a 1280×720 con el riel abierto, las cabeceras siguen visibles y quedan ≥ 700 px de línea de tiempo.

### UX-48 · Las acciones globales del plan no tienen un lugar propio
**Severidad:** media · **Prioridad:** Ola 3, #48 · **Esfuerzo:** S · **Origen:** A-15 (amplía P2-8 y P2-9)
- **Ubicación:** arquitectura de información del shell.
- **Problema:** "Reiniciar con el año de ejemplo…" (borra todo) está dentro del menú de futuros. "Armar mi año" y "Revisar" (Rec) solo existen en banners que desaparecen. No hay un menú de plan.
- **Evidencia:** `apps/web/src/finance/components/FuturesMenu.tsx:195-212`; `apps/web/src/components/PlaylistShell.tsx:1255-1282`; `apps/web/src/finance/components/FinancialSummaryBar.tsx:169-172`.
- **Impacto:** una acción destructiva global vive en un menú de escenarios, y si se cierra un banner no hay forma de volver a su acción.
- **Principio afectado:** Nielsen #4; #3; #7.
- **Recomendación:** un menú de plan (en la marca: "Mi plan ▾") con Armar mi año, Revisar lo que pasó, Exportar o respaldar (P0-7), Reiniciar con el ejemplo y Tema. "Futuros" queda solo para futuros.
- **Criterio de aceptación:** cada acción global se alcanza en ≤ 2 clics desde un mismo lugar, con o sin banner.

### UX-49 · El banner de Rec dice que todo está bien, y su × significa "todo pasó así" de forma irreversible
**Severidad:** media · **Prioridad:** Ola 3, #49 · **Esfuerzo:** S · **Origen:** C-08 (amplía P2-9)
- **Ubicación:** banner de Rec al volver otro día.
- **Problema:** el banner afirma "**Tu año está al día.**", con "Revisar" como botón secundario, mientras el diálogo se titula "Pon tu año al día". La × (nombre accesible "Está bien así") acepta todo y elimina Rec de la sesión sin forma de reabrirlo. No dice cuántos movimientos ni cuánto dinero se supusieron.
- **Evidencia:** `apps/web/src/components/PlaylistShell.tsx:1261-1282` (`:1275`); `apps/web/src/finance/components/RecDialog.tsx:121`, `:126`.
- **Impacto:** la redacción invita a ignorarlo, y una caja supuesta queda sin revisar.
- **Principio afectado:** Nielsen #2; #4; #3.
- **Recomendación:** "Pasaron 14 días: supusimos 4 movimientos (−$6,292). ¿Lo revisas?". Primario "Revisar", secundario "Todo pasó así", y × = "Después" (Rec sigue pendiente). Entrada permanente en el menú de plan (UX-48).
- **Criterio de aceptación:** ninguna × acepta el Rec, y Rec se puede reabrir.

### UX-50 · La tarjeta del valle en hover muestra "Aplicar" pero desaparece al llevar el puntero al botón
**Severidad:** media · **Prioridad:** Ola 3, #50 · **Esfuerzo:** S · **Origen:** C-07 (nueva)
- **Ubicación:** tarjeta del valle en modo transitorio.
- **Problema:** al pasar sobre el valle aparece la tarjeta con 3 botones "Aplicar", pero al mover el puntero hacia ellos sale del carril y la tarjeta se desmonta. Fijarla exige un clic en el carril, que además **mueve el cursor de tiempo**.
- **Evidencia:** `apps/web/src/finance/components/ValleyCard.tsx:29-40`, `:143-145`. Sonda `p09-valley-hover`.
- **Impacto:** se ofrecen acciones inalcanzables, y fijarlas tiene un efecto colateral.
- **Principio afectado:** WCAG 2.2 1.4.13 Contenido con hover o foco (AA); Nielsen #6.
- **Recomendación:** la tarjeta cuenta como zona de hover, con una gracia de ~300 ms; o, en hover, solo la explicación más "Ver arreglos", que la fija sin mover el cursor. Escape la cierra.
- **Criterio de aceptación:** se puede llevar el puntero del valle a "Aplicar".

### UX-51 · "Pegar estado de cuenta…" desde el editor descarta en silencio lo que se estaba editando
**Severidad:** media · **Prioridad:** Ola 3, #51 · **Esfuerzo:** S · **Origen:** C-13 (nueva)
- **Ubicación:** editor de tarjeta → "Pegar estado de cuenta…".
- **Problema:** el botón vive en el pie, junto a Cancelar y Guardar. Al pulsarlo, el shell desmonta el editor sin guardar, y al cerrar el estado de cuenta no se vuelve al editor.
- **Evidencia:** `apps/web/src/finance/components/FinancialEditorModal.tsx:1032-1040`; `apps/web/src/components/PlaylistShell.tsx:1293-1296`. Sonda `p13-editor-to-statement`: "Nu" → "Nu Oro" → Pegar → Cancelar → sigue "Nu".
- **Impacto:** se pierden cambios sin aviso y el flujo se corta.
- **Principio afectado:** Nielsen #3; #5.
- **Recomendación:** si `isDirty`, pedir "Guarda o descarta tus cambios antes de pegar" (o guardar primero), y al cerrar el estado de cuenta volver al editor.
- **Criterio de aceptación:** ningún cambio del editor se pierde por abrir el estado de cuenta.

### UX-52 · Estado de cuenta: qué pasa con cada fila se indica solo con color, y los signos van al revés
**Severidad:** media · **Prioridad:** Ola 3, #52 · **Esfuerzo:** S · **Origen:** C-12 (nueva; P2-11 cubre el parser)
- **Ubicación:** vista previa de "Estado de cuenta".
- **Problema:** las filas futuras (se agregan como compras) se distinguen de las que suben el saldo **solo por el azul**. Las compras llevan "+" ("+$1,299") y los pagos "−", al revés que en Rec y en el canvas.
- **Evidencia:** `apps/web/src/finance/components/StatementDialog.tsx:160`, `:165`; `apps/web/src/styles/globals.css:3105-3107`. Sonda `p07-statement`.
- **Impacto:** sin color no se sabe qué fila hace qué, y un pago se lee como cargo.
- **Principio afectado:** WCAG 2.2 1.4.1 Uso del color (A, superficie secundaria); Nielsen #4.
- **Recomendación:** dos secciones con encabezado ("Ya los debes" / "Cargos futuros") o una columna "Se aplica a", y columnas "Cargo / Abono" en lugar de signos.
- **Criterio de aceptación:** la vista previa se entiende igual en escala de grises.

### UX-53 · La barra "/" tapa justo el carril Caja donde dibuja su vista previa
**Severidad:** media · **Prioridad:** Ola 3, #53 · **Esfuerzo:** S · **Origen:** C-10 (nueva)
- **Ubicación:** barra "/" sobre el escenario.
- **Problema:** anclada a 16 px del borde superior y de hasta 640 px de ancho, la barra queda sobre la regla y el centro del carril Caja, que es donde se dibuja el efecto en vivo. Vacía, con sugerencias, mide 376 px de alto.
- **Evidencia:** `apps/web/src/styles/globals.css:2695-2707`; `apps/web/src/finance/components/CommandBar.tsx:1-5`. Sondas `p03-analysis`, `p05-command`.
- **Impacto:** la curva que convencería a la persona queda oculta.
- **Principio afectado:** Nielsen #1.
- **Recomendación:** anclarla bajo el carril (`top: calc(var(--pl-ruler-h) + var(--pl-lane-h) + 8px)`) o al pie, y colapsar las sugerencias mientras se escribe.
- **Criterio de aceptación:** a 1280 y 1440 px, la barra abierta no se cruza con el carril.

### UX-54 · Futuros: nombres duplicados, una fecha de bifurcación sin efecto y ningún cierre de la decisión
**Severidad:** media · **Prioridad:** Ola 3, #54 · **Esfuerzo:** M · **Origen:** C-09 (amplía P2-22)
- **Ubicación:** menú de futuros.
- **Problema:**
  - Dos bifurcaciones el mismo día quedan como dos "Rama desde 11 nov".
  - "Bifurcar aquí · <fecha>" sugiere divergencia desde esa fecha, pero se copia el plan completo.
  - No hay "Quedarme con este futuro" ni "Descartar".
  - "Reiniciar…" convive con "Borrar este futuro".
  - El vocabulario es de git.
- **Evidencia:** `apps/web/src/finance/futures.ts:118-139`; `apps/web/src/finance/components/FuturesMenu.tsx:132-134`, `:155-166`, `:196-213`. Sonda `p14-futures-names`.
- **Impacto:** no se sabe qué futuro es cuál, y adoptar uno exige borrar el principal con `window.confirm`.
- **Principio afectado:** Nielsen #2; #6; #5.
- **Recomendación:** pedir el nombre al crear ("¿Qué quieres probar?") o numerar. "Probar otra versión de mi año". "Hacer este mi plan principal" y "Descartar este futuro". Sacar "Reiniciar…" del menú (UX-48).
- **Criterio de aceptación:** dos futuros nunca comparten nombre, y adoptar o descartar toma una acción.

### UX-55 · "Estrategia avalancha" solo informa: no se puede llevar a cabo ni se explica
**Severidad:** media · **Prioridad:** Ola 3, #55 · **Esfuerzo:** M · **Origen:** C-14 (amplía P0-13)
- **Ubicación:** Análisis → "Estrategia avalancha".
- **Problema:** la tabla y la línea "Disponible para extra: $0" no tienen ninguna acción. "Avalancha" no se explica. Con $0 no se dice por qué en términos de la persona, y no se conecta con el valle.
- **Evidencia:** `apps/web/src/finance/components/DebtStrategyPanel.tsx:55-63`, `:111-122`. Sonda `p03-analysis`.
- **Impacto:** el análisis no se convierte en decisión, y la persona tiene que traducirlo en ediciones.
- **Principio afectado:** Nielsen #7; #10; principio rector (diseñar alrededor de decisiones).
- **Recomendación:** "Subir pago de Nu a $X/mes" por deuda con extra > 0, con vista previa y bloqueado si rompe la reserva (P0-13). Una línea "Avalancha: el extra va primero a la tasa más alta". Con $0, la razón ("tu caja baja de la reserva el 27 nov").
- **Criterio de aceptación:** cada sugerencia de extra se aplica y deshace desde el panel.

### UX-56 · Encabezado: orden de foco distinto al visual, paradas de Tab vacías y ayuda que se lee dos veces y no se puede sobrevolar
**Severidad:** media · **Prioridad:** Ola 3, #56 · **Esfuerzo:** S · **Origen:** A-10 + E-05 (amplían P2-20)
- **Ubicación:** recorrido con Tab y lectura del shell; `MetricHelp`.
- **Problema:**
  - **Orden de Tab:** encabezado (1–17) → **lienzo (18)** → los controles que se ven encima del lienzo (19–23) → "Abrir inspector", abajo a la derecha (24), antes que "Análisis", arriba a la izquierda (25).
  - **Paradas vacías:** "Deuda hoy" y "Al horizonte" son `div tabIndex=0` sin acción.
  - **Ayuda duplicada:** las ayudas cerradas están en el flujo como `.fin-sr-only` (1,104 caracteres) y se leen intercaladas y otra vez al enfocar.
  - **Ayuda no sobrevolable:** el tooltip se cierra al ir hacia él (`pointer-events: none`).
  - **Sin landmarks:** no hay `<header>` y la región raíz se llama "Playlist".
- **Evidencia:** `apps/web/src/components/PlaylistShell.tsx:1166-1216`; `apps/web/src/finance/components/FinancialSummaryBar.tsx:201`, `:250-254`; `apps/web/src/finance/components/MetricHelp.tsx:72-80`, `:102-105`; `apps/web/src/styles/globals.css:1284-1300`. Sondas `p2-focus-a11y`, `s13`, `s14`.
- **Impacto:** con teclado se salta a un lienzo inoperable antes de "Hoy", y con lector el encabezado es un muro de texto.
- **Principio afectado:** WCAG 2.2 2.4.3 (A); 1.3.2 (A); 1.4.13 (AA); Nielsen #8.
- **Recomendación:**
  - Orden del DOM igual al visual.
  - Las métricas informativas pasan a `<button aria-expanded>` que alterna la ayuda, o salen del Tab.
  - Las descripciones cerradas van con `hidden` (siguen funcionando por `aria-describedby`).
  - Tooltip sobrevolable con ~300 ms de gracia.
  - `<header>` "Resumen de tu plan".
- **Criterio de aceptación:** Tab va de arriba a la izquierda hacia abajo a la derecha sin saltos, y el árbol ARIA del encabezado da 6 pares etiqueta-valor sin definiciones intercaladas.

### UX-57 · Roles ARIA sin su modelo de teclado: toolbar, radiogroup, menús con texto suelto, diálogo sin foco
**Severidad:** media · **Prioridad:** Ola 3, #57 · **Esfuerzo:** M · **Origen:** E-06 + parte de B-13 (amplían P2-25 y P2-26)
- **Ubicación:** barra de herramientas, "Se repite" (editor y onboarding), menús de futuros y alertas, "Cómo moverte" y menú contextual.
- **Problema:**
  - **`toolbar`:** 7 paradas de Tab y las flechas no hacen nada.
  - **`radiogroup` "Se repite":** 6 radios con `tabIndex=0` y sin flechas.
  - **Menús de futuros y alertas:** `role="menu"` con `<p>` hijos, texto al que el lector no llega en modo menú.
  - **Menú contextual:** sin `menuitem`, y el foco se queda en el canvas.
  - **"Cómo moverte":** es `dialog`, pero no recibe foco.
- **Evidencia:** `apps/web/src/components/PlaylistShell.tsx:594-606`, `:636-642`; `apps/web/src/finance/components/SchedulePicker.tsx:84-118`; `apps/web/src/finance/components/FuturesMenu.tsx:106-111`, `:215-219`; `apps/web/src/finance/components/FinancialSummaryBar.tsx:560-571`; `apps/web/src/finance/components/NavControls.tsx:167-180`. Sondas `s3`, `s11`, `s17`.
- **Impacto:** el lector promete interacciones ("barra de herramientas", "opción 1 de 6") que el teclado no cumple.
- **Principio afectado:** WCAG 2.2 4.1.2 (A), 1.3.1 (A); APG Toolbar, Radio Group, Menu y Dialog.
- **Recomendación:**
  - Tabindex itinerante en toolbar y radiogroup (o quitar los roles y dejar `aria-pressed` en un `group`).
  - Las notas, fuera del `role="menu"`.
  - Menú contextual con `useMenuButton` (P2-26).
  - "Cómo moverte" recibe el foco, o deja de ser `dialog`.
- **Criterio de aceptación:** toolbar y "Se repite" son una parada de Tab cada uno y responden a las flechas, y ningún `menu` tiene hijos fuera de `menuitem*`, `separator` y `group`.
- **Nota:** el trabajo local sin commitear del 2026-11-11 ya implementa el radiogroup de `SchedulePicker` con tabindex itinerante (flechas, Inicio y Fin).

### UX-58 · No hay estructura de encabezados, y los nombres accesibles arrastran términos DAW en inglés
**Severidad:** media · **Prioridad:** Ola 3, #58 · **Esfuerzo:** S · **Origen:** E-07 + A-17 (amplían P3-1)
- **Ubicación:** toda la app, los diálogos y el riel de Análisis.
- **Problema:**
  - **0 encabezados** en la vista principal y en los 4 diálogos (los títulos son `<strong>`). Las secciones del riel son botones sueltos.
  - **Nombres en inglés o de DAW:** región "Playlist", "Lectura del playhead", "Cash", "No clip selected." sin `lang="en"` y la meta description "Timeline editor workspace for SliceX.".
  - **Erratas y mezcla de idioma:** "Cuándo" con una tilde que no corresponde en el menú de alertas, y "timeline" en el estado de cuenta.
- **Evidencia:** `apps/web/src/finance/components/FinancialEditorModal.tsx:790`; `apps/web/src/finance/components/Onboarding.tsx:280`; `apps/web/src/finance/components/RecDialog.tsx:126`; `apps/web/src/finance/components/StatementDialog.tsx:128`, `:183-184`; `apps/web/src/finance/components/FinancialUi.tsx:91-95`; `apps/web/src/components/PlaylistShell.tsx:1168`; `apps/web/src/finance/components/PlayheadReadout.tsx:36`, `:40`; `apps/web/index.html:26`; `apps/web/src/finance/components/FinancialSummaryBar.tsx:569`. Sondas `s10`, `p3-aria`.
- **Impacto:** con lector no se puede saltar por secciones, y se oyen términos que el glosario prohíbe.
- **Principio afectado:** WCAG 2.2 1.3.1 (A); 2.4.6 (AA); 3.1.2 (AA); Nielsen #2.
- **Recomendación:** un `h1` oculto ("Tu plan financiero"); títulos de diálogo como `h2` referidos por `aria-labelledby`; secciones del riel como `h3 > button[aria-expanded]`. Renombrar ("Tu plan", "Lectura del día", "Caja") y extender el lint de P3-1 a `aria-label` y `title`.
- **Criterio de aceptación:** al menos un encabezado por diálogo y panel, y ningún nombre accesible con playlist, playhead, clip, cash ni track.

### UX-59 · Contraste: fugas en los bordes del sistema de tokens, y placeholders que parecen valores
**Severidad:** media · **Prioridad:** Ola 3, #59 · **Esfuerzo:** S · **Origen:** E-09 + B-15 (amplían P2-28)
- **Ubicación:** campos con placeholder, calendario del editor y cifras negativas.
- **Problema:**
  1. No hay regla `::placeholder`, así que se usa el gris del navegador (#757575): **4.02:1** y **3.69:1** en oscuro. Afecta a "dd/mm/aaaa" (la única pista del formato) y a "Lo que dice tu banco ahora". Además, "$12,000", "$9,000" y "12" parecen valores ya capturados, incluso junto al error "Escribe cuánto dinero tienes hoy".
  2. Los días fuera de mes del calendario de Mantine quedan en **2.16:1** y **2.70:1** (`opacity: .5` sobre `--muted`), y son botones activos.
  3. `--fin-negative` en cifras queda sin margen: 4.36 en hover y 4.20 sobre su tinte. Ya existe `--fin-negative-text` (5.18–5.63), pero las cifras no lo usan.
- **Evidencia:** `apps/web/src/styles/globals.css` (0 coincidencias de `placeholder`), `:80-87`, `:1083`, `:1435`, `:2190-2192`; `apps/web/src/finance/components/Onboarding.tsx:295`, `:317`, `:346`. Sondas `s4`, `s5`, `s15`, `s16`, `p4-layout`.
- **Impacto:** la pista del formato de fecha, que previene justo los errores de P0-14, es difícil de leer, y la persona puede creer que un campo vacío ya tiene valor.
- **Principio afectado:** WCAG 2.2 1.4.3 (AA); Nielsen #1; #4.
- **Recomendación:**
  - Token `--placeholder` por tema, aplicado con `::placeholder`, y ejemplos con "ej." o como texto de ayuda.
  - `opacity: 1` en los días fuera de mes.
  - Cifras negativas con `--fin-negative-text` en claro.
  - Extender el test de ratios de P2-28.
- **Criterio de aceptación:** ningún texto activo queda por debajo de 4.5:1 en ningún tema, y ningún placeholder es un valor plausible.

### UX-60 · Atajos de una sola tecla escuchados en `window` (Q, A, "/") sin forma de desactivarlos
**Severidad:** media · **Prioridad:** Ola 3, #60 · **Esfuerzo:** S · **Origen:** E-11 (nueva; P2-2 cubre los atajos del canvas)
- **Ubicación:** shell (`keydown` global).
- **Problema:** con el foco en cualquier botón, mantener **q** abre la vista previa de otro futuro y **/** abre la barra de comandos. Los atajos de herramienta sí están acotados al host del canvas.
- **Evidencia:** `apps/web/src/components/PlaylistShell.tsx:1094-1117`, `:1132`, frente a `packages/canvas/src/playlist-interaction/controller.ts:2292`. Sonda `s18`.
- **Impacto:** con control por voz o con pulsaciones involuntarias se abren vistas previas y la barra.
- **Principio afectado:** WCAG 2.2 2.1.4 Atajos de teclado de un solo carácter (A).
- **Recomendación:** escuchar Q, A y "/" solo con el foco dentro del escenario, o agregar un ajuste para apagarlos.
- **Criterio de aceptación:** con el foco en un botón de la cabecera, q y / no tienen efecto (o se pueden apagar).

---

## Ola 4 · Pulido

### UX-61 · Tres puntos de creación con tres catálogos distintos
**Severidad:** baja · **Prioridad:** Ola 4, #61 · **Esfuerzo:** S · **Origen:** A-16 (nueva)
- **Ubicación:** "Nuevo" del encabezado, menú contextual del vacío y menú de la línea.
- **Problema:** "Nuevo" ofrece 6 tipos más "Escribir…"; el clic derecho en el vacío, 4 (sin Tarjeta ni Compra); el menú de la línea, 2, fechados en el cursor de tiempo y no donde se hizo clic.
- **Evidencia:** `apps/web/src/finance/components/FinancialSummaryBar.tsx:55-65`; `apps/web/src/components/PlaylistShell.tsx:278-293`, `:521-526`. *Leído en código.*
- **Impacto:** quien aprende a crear con clic derecho no encuentra la tarjeta.
- **Principio afectado:** Nielsen #4.
- **Recomendación:** los mismos 6 tipos en todos los puntos (o los 3 más usados más "Otro…", con la colocación ya fijada).
- **Criterio de aceptación:** desde cualquier punto de creación se llega a los 6 tipos en ≤ 2 pasos.

### UX-62 · Vocabulario y jerarquía de acciones distintos en cada diálogo de conciliación
**Severidad:** baja · **Prioridad:** Ola 4, #62 · **Esfuerzo:** S · **Origen:** C-17 (amplía P2-4 y P2-13)
- **Ubicación:** Rec, estado de cuenta, tarjeta del valle, Escenario y banner de Rec.
- **Problema:** para confirmar se usa "Guardar" (Rec), "Aplicar" (estado de cuenta, valle) y "Fijar / Soltar base". Para salir, "Después", "Cancelar" y "× Está bien así". La tarjeta del valle tiene 3 primarios rellenos, contra el canon de "una sola acción primaria rellena por superficie".
- **Evidencia:** `apps/web/src/finance/components/RecDialog.tsx:97-104`, `:223-228`; `apps/web/src/finance/components/StatementDialog.tsx:77-80`, `:191-200`; `apps/web/src/finance/components/ValleyCard.tsx:131-137`; [project-canon.md](project-canon.md) (líneas 124-125). Sonda `p09-valley-hover`.
- **Impacto:** cada flujo se aprende por separado.
- **Principio afectado:** Nielsen #4.
- **Recomendación:** "Aplicar" para meter lo revisado al plan, "Cancelar" para salir sin cambios y "Después" solo si queda algo pendiente. La × siempre significa "cerrar sin decidir". Un solo primario por superficie.
- **Criterio de aceptación:** una tabla verbo → efecto de los 5 componentes no tiene excepciones.

### UX-63 · Cinco recetas de indicador de foco, dos casi invisibles
**Severidad:** baja · **Prioridad:** Ola 4, #63 · **Esfuerzo:** S · **Origen:** E-12 (amplía P2-24)
- **Ubicación:** todos los controles.
- **Problema:** el outline global (2 px, 4.04–6.34:1) y el inset están bien. En cambio:
  - Los campos cambian solo 1 px de borde, con un halo de ~1.2:1.
  - "Liquidez hoy" y "Reserva" usan `outline: none` con un subrayado de 1 px.
  - La barra "/" no tiene indicador (0 reglas `:focus-within` en todo el CSS).
- **Evidencia:** `apps/web/src/styles/globals.css:182-197`, `:308-310`, `:1106-1110`, `:2048-2053`, `:2749-2752`, `:3048-3053`, `:3093-3097`. Sonda `s2`.
- **Impacto:** con la barra "/" abierta no se sabe si lo que se teclea va al campo.
- **Principio afectado:** WCAG 2.2 2.4.7 (AA, en el límite); Nielsen #1.
- **Recomendación:** un token `--focus-ring` aplicado también a los campos, y `.fin-command:focus-within` con el anillo.
- **Criterio de aceptación:** todo foco muestra un cambio de ≥ 2 px con ≥ 3:1.

### UX-64 · `prefers-reduced-motion` se respeta en la navegación pero no en el morph del carril
**Severidad:** baja · **Prioridad:** Ola 4, #64 · **Esfuerzo:** S · **Origen:** E-13 (nueva)
- **Ubicación:** cambio de futuro y Q/A (morph de 320 ms).
- **Problema:** el navegador del canvas consulta `prefers-reduced-motion`, pero `bridge.animateFrom` interpola siempre.
- **Evidencia:** `packages/canvas/src/playlist-interaction/controller.ts:603-606`; `packages/canvas/src/playlist-interaction/navigator.ts:122`; `apps/web/src/finance/financial-bridge.ts:136`, `:741-751`. *Leído en código.*
- **Impacto:** pequeño; es una incoherencia trivial de cerrar.
- **Principio afectado:** WCAG 2.2 2.3.3 (AAA, se cita porque el arreglo es trivial); Nielsen #4.
- **Recomendación:** `animateFrom` no hace nada con `reduce`, reutilizando la función `reducedMotion` del controlador.
- **Criterio de aceptación:** con `reducedMotion: 'reduce'`, `bridge.isAnimating()` es falso justo después de cambiar de futuro.

---

## Diagnóstico transversal

### Problemas sistemáticos

1. **La interfaz se organiza alrededor del modelo, no de la decisión.** Esto explica casi un tercio de los hallazgos:
   - El encabezado sigue el orden de los campos del documento (UX-14).
   - Los formularios imponen la ventana de recurrencia a tipos donde no significa nada (UX-07, UX-33, UX-34) y piden "Tipo" como campo (UX-31).
   - El préstamo empieza por "Pago" (UX-08).
   - Las líneas se llaman por su contenedor (UX-44) y los paneles por su mecánica ("Análisis", UX-47).

   La pregunta de la persona ("¿me alcanza?", "¿cuándo sale el dinero?", "¿cuánto pago para salir de esta deuda?") casi siempre está calculada, pero queda en segundo plano: en un tooltip, un readback o una píldora transitoria.
2. **Lo simulado y lo real no se distinguen.**
   - Hay seis mecanismos de "qué pasa si": silencio, solo, futuros, Escenario, cabezal fuera de hoy y Q/A. Ninguno marca las cifras como hipótesis (UX-03, UX-19, UX-40).
   - Ninguno ofrece comparación en cifras y un cierre ("quedarme / descartar") (UX-20, UX-21, UX-54).
   - Dos de ellos sí modifican el plan guardado (silencio y Escenario).
3. **La consecuencia se ve antes en una superficie y en las demás no; después, en ninguna.**
   - "/" tiene la vista previa ejemplar, pero el editor (UX-23), Rec (UX-22), los arreglos del valle (UX-06) y la avalancha (UX-55) no la tienen.
   - Tras Guardar, Aplicar, soltar o Enter, nada confirma qué cambió, ofrece Deshacer ni lo anuncia (UX-16, UX-22, UX-26; P2-1).
4. **Un mismo dato tiene varias puertas con semánticas distintas:**
   - "Saldo real de hoy": absoluto, delta o gasto (UX-02, UX-05, UX-18).
   - Día de pago: tres controles (UX-34).
   - Dos parsers (UX-35).
   - Primer abono de MSI: dos convenciones (UX-33).
   - Creación: tres catálogos (UX-61).
   - Errores: dos estrategias (UX-32).
5. **Valores por defecto que inventan datos en lugar de pedirlos:** montos de $500 y $1,000, mínimo de tarjeta $0, colchón igual a un pago, año mexicano marcado sin montos y primera tarjeta preseleccionada (UX-01, UX-12, UX-30). El caso grave (UX-01) es crítico.
6. **La herencia DAW llega sin filtro al host financiero:**
   - Cortar parte todas las líneas y deja insignias ↻ (UX-09).
   - Hay modos persistentes con cursor `not-allowed` (UX-16).
   - Atajos FL, "Silenciar" y "Solo" (UX-43).
   - Medidores tipo fader (UX-44).
   - Tipos de marcador "Bucle / Compás" (informe A).

   El core no tiene que cambiar: falta que el host declare qué gestos, insignias, cursores y vocabulario aplican (en línea con P2-2).
7. **Lo que existe como gesto, hover o tecla no tiene comando equivalente:**
   - Búsqueda de objetivo, "tu año sin esto", Q y reordenar o mover líneas (UX-28).
   - La información del objeto (UX-25).
   - La tarjeta del valle (UX-50).

   Esto bloquea a la vez el target táctil, el teclado y WCAG 2.5.7 / 2.1.1, y es el motivo de la severidad crítica de UX-04.
8. **Cada superficie flotante reinventa foco, cierre y posición:** tres recetas de Escape, una restauración de foco privada del editor y 9 de 14 superficies que pierden el foco (UX-27). Además, los paneles se **superponen** en lugar de componer: Análisis tapa las cabeceras (UX-47), "/" tapa el carril (UX-53) y los banners tapan las líneas (UX-29).
9. **El diseño adaptable cede espacio quitando información decisiva en lugar de reordenar por prioridad:** primero desaparecen el mínimo, el horizonte y el nombre del futuro (UX-15, UX-19), y el marco fijo no se pliega a alturas bajas (UX-29).

### Oportunidades de estandarización

Primitivos concretos que resuelven varias entradas a la vez, sin dependencias nuevas:

| Primitivo | Dónde vive | Resuelve |
|---|---|---|
| **`useOverlay`** (tipo, foco inicial, restauración, pila de Escape, política de clic fuera) sobre `useDismiss` + `useRestoreFocus` extraído del editor | `apps/web/src/ui/` | UX-27, UX-49, UX-50, UX-57, UX-62; P0-20, P2-3, P2-4, P2-13 |
| **Línea de efecto** ("Tu caja: mínimo A → B · horizonte ±C") con `bridge.setPreview` y cálculo diferido | `apps/web/src/finance/components/` | UX-06, UX-13, UX-22, UX-23, UX-55 |
| **Región de resultado + toast con Deshacer**, actualizada por el bridge al cerrar un commit | shell | UX-16, UX-22, UX-26, UX-06; P2-1 |
| **Chip de modo simulación** ("Sin 2 objetos", "Estás en Rama…", "Viendo el 2 mar") con un solo lugar en el encabezado | `FinancialSummaryBar` | UX-03, UX-19, UX-40, UX-21 |
| **Contrato "probar → quedarme / descartar"** sobre futuros (Escenario y "/" lo reutilizan) | `futures.ts` + `FuturesMenu` | UX-20, UX-21, UX-54 |
| **Parser es-MX único** (fechas relativas, día suelto, "mil", "k") compartido por editor, onboarding, encabezado y "/" | `apps/web/src/finance/format.ts` | UX-05, UX-18, UX-35; P2-10 |
| **Control de día del mes** y **readback por tipo** | `form-kit.tsx` / editor | UX-33, UX-34, UX-07 |
| **Declaración de semántica del host** (alcance de Cortar, insignias, cursores, vocabulario y atajos) | opción del renderer y controller, leída una vez | UX-09, UX-16, UX-43; P2-2 |
| **Glosario + lint** extendido a `aria-label`, `title` y `meta` | `scripts/` (P3-1) | UX-43, UX-58 |
| **Tokens nuevos:** `--placeholder`, `--focus-ring` y escalas de alto de control y tipografía | `globals.css` ↔ `palette.ts` | UX-59, UX-63; inventario del informe E |

### Lo que está sólido (no tocar)

- **Lectura de las cifras:**
  - El **readback en lenguaje llano** del editor ("Cobras $20,000 cada mes, el día 25… Próximos: 25 nov · 25 dic…"). Hay que extenderlo a tarjeta y MSI, no rehacerlo.
  - La **vista previa de "/"**: resumen legible, "Supuse: …" y efecto en mínimo y horizonte, sin tocar el plan hasta Enter.
  - El **contenido de MetricHelp**: hay que subirlo de jerarquía, no reescribirlo.
- **Feedback del gesto en el canvas:**
  - Tooltip con día, caja y movimientos; píldora "Mín … → … · sales del rojo"; fantasma de la curva anterior; encabezado vivo.
  - Selección (anillo de 2.5 px), imán, fantasma de destino, etiquetas pegajosas.
  - El lápiz no crea por su cuenta.
- **Flujos financieros:**
  - La **búsqueda de objetivo** de deudas como mecánica; solo le falta mostrar el beneficio (UX-13) y una alternativa sin arrastre (UX-28).
  - La **tarjeta del valle** explica la causa e ilumina en el canvas lo que la cava; el camino "Mínimo proyectado → Aplicar" son 2 clics.
  - El **estado de cuenta** muestra el efecto exacto en la tarjeta ("Saldo de Nu: $30,069 → $30,080").
- **Entrada de datos:**
  - **`DateField` es-MX**: acepta "15/12", "15 dic", "1 de enero"; rechaza "12/31/2026" en lugar de malinterpretarlo; calendario en español; Escape aislado.
  - **Montos tolerantes**: "$12,000", "1 234.5", "$ 8,000.00".
  - **Esquema Zod único** + Mantine Form, con el error bajo cada campo.
- **Accesibilidad base:**
  - Los **menús de la cabecera** (`useMenuButton`): foco al primer ítem, flechas, Home/End, y Escape/Tab devuelven el foco.
  - Diálogos con `aria-modal` y fondo `inert`; **sin trampas de teclado**; todos los botones de ícono con nombre; `lang="es"`.
  - Ningún control DOM por debajo de 24 px; foco nunca tapado del todo (2.4.11); 1.4.12 aguanta.
- **Sistema visual:**
  - Texto AA en ambos temas, en el DOM y en el canvas (títulos ≥ 13.4:1, detalle ≥ 5.5:1).
  - Tema claro/oscuro sin parpadeo; CSS 100 % tokenizado en color y sin `!important`.

---

## Orden de implementación sugerido

1. **En paralelo con P0 de la auditoría 2026-11-10.** UX-03 se resuelve junto con P0-1 (persistir solo `clip.muted` más el chip de exclusión). UX-02 y UX-01 son S y van primero.
2. **Ola 1 restante (cifras):** UX-05, UX-06, UX-07, UX-08, UX-09, UX-10, UX-11, UX-12 y UX-13. UX-04 empieza aquí como paso intermedio (foco itinerante + Enter + anuncio) porque es el único crítico de accesibilidad.
3. **Primitivos transversales, antes de la ola 2:** `useOverlay`, la línea de efecto, la región de resultado con Deshacer y el chip de modo simulación. Desbloquean de golpe UX-16, UX-19, UX-21, UX-22, UX-23, UX-26 y UX-27.
4. **Ola 2 (estado y modo):** el veredicto del encabezado (UX-14) con su plegado por prioridad (UX-15), herramientas (UX-16, UX-17), edición en línea (UX-18), futuros (UX-19, UX-20, UX-21), Rec (UX-22), editor (UX-23), onboarding (UX-24), hover y toque (UX-25), anuncios (UX-26), alternativas a gestos (UX-28) y zoom (UX-29).
5. **Ola 3:** primero las S de captura (UX-30, UX-31, UX-32, UX-35, UX-36, UX-37), luego las del canvas y el lenguaje (UX-38–UX-46), los flujos (UX-47–UX-55) y la accesibilidad estructural (UX-56–UX-60).
6. **Ola 4:** pulido (UX-61–UX-64).

**Quick wins** (S, severidad ≥ alta): UX-01, UX-02, UX-07, UX-10, UX-17, UX-18, UX-26. **Quick wins medios** (S, severidad media): UX-30, UX-31, UX-32, UX-35, UX-36, UX-37, UX-38, UX-39, UX-40, UX-42, UX-43, UX-45, UX-46, UX-48, UX-49, UX-50, UX-51, UX-52, UX-53, UX-56, UX-58, UX-59, UX-60.

---

## Método, cobertura y límites

- **Estado auditado:** `origin/feat/financial-engine-mvp` @ `52f28d6`, en un worktree aparte, con la app en un dev server propio y el plan de ejemplo (`?reset`, hoy = 11 nov 2026). Ninguno de los arreglos de la auditoría 2026-11-10 estaba aplicado.
- **Cinco áreas en paralelo**, cada una con las 7 dimensiones del encargo:

  | Área | Alcance | Hallazgos |
  |---|---|---|
  | A | Shell, orientación y navegación | 17 |
  | B | Captura y edición (formularios, onboarding) | 15 |
  | C | Conciliar, analizar y simular | 17 |
  | D | Interacción y lenguaje visual del canvas | 17 |
  | E | Accesibilidad, adaptabilidad y sistema de diseño | 13 |

  Los 79 hallazgos se agruparon por causa en 64 entradas.
- **Evidencia:** más de 60 sondas Playwright (Chromium) con mouse y teclado reales, en 1920, 1600, 1440×900, 1366, 1280×720, 1200, 768×1024, 740×360, 640×360, 360×740 y 320×256 px, en claro y oscuro. Los contrastes se calcularon desde `globals.css`, `palette.ts` y `getComputedStyle`.
- **Verificación cruzada:** el orquestador volvió a comprobar en código o con sonda propia las cuatro críticas y varias altas: UX-01 (`items.ts:141` + `types.ts:124`), UX-02 (`bootstrap.ts:97-100`), UX-05 (`command.ts:17`), UX-06 (`valley.ts:344-361`), UX-09 (`state.ts:794-806` y la spec de paridad) y UX-10 (`labels.ts:19-26`, `visuals.ts:404`).
- **Falso positivo descartado:** el área C reportó una trampa de teclado en "Reserva mínima" (WCAG 2.1.2). Dos sondas independientes (la del área E y la del orquestador) muestran que Tab avanza con normalidad: Liquidez → Reserva → Deuda → … → herramientas.
- **Límites:**
  - No se probó con un lector de pantalla real (los anuncios se infirieron con MutationObserver y el árbol de accesibilidad de Playwright).
  - No se probó en un dispositivo táctil real.
  - No hubo pruebas con usuarios: los criterios del tipo "prueba con 5 personas" son una sugerencia de validación, no un resultado.
- **Artefactos:** los informes por área y las sondas quedaron fuera del repo, en el scratchpad de la sesión (no versionados).
