# SliceX — Spec primigenia del producto

> Este documento captura la idea central y objetiva del proyecto, tal como fue definida por el autor. Es la **fuente de verdad de comportamiento del producto**. Para estado del repositorio ver [project-canon.md](project-canon.md). Para reglas de ownership ver [../AGENTS.md](../AGENTS.md).

## 1. Visión

Aplicación web (con objetivo de escalar a Android e iOS) que actúa como **gestor financiero avanzado con manejo intuitivo**: el reemplazo para todas las apps de finanzas personales y Exceles desordenados.

**Expectativa de UX:** *Figma Experience pero mejor.*

**Nombre tentativo:** SliceX.

## 2. Requisitos de stack (no negociables)

1. **Alta fluidez y tolerancia de objetos en UI**, interacción altamente libre sin restricciones ni errores de render.
2. **Nada de throttling de renderizado.**
3. **Estabilidad y sensación altamente fluida del lado del cliente.**
4. **Separar el motor gráfico del motor de lógica** para no rehacer todo desde 0 cuando se porte a Android y luego iOS.

## 3. Modelo del timeline

- **Barra de tiempo infinita**, como editores de video o DAWs de música.
- **Múltiples líneas o pistas (tracks)** dentro de un timeline.
- En cada pista puede haber **N objetos financieros estirables**.
  - Por defecto **no son infinitos** en duración.
  - Se pueden marcar como **"dejar como indefinido"** y entonces se estiran en el timeline.
- Pueden haber **infinitos timelines** y se pueden **clonar entre sí con todos sus elementos** para correr distintos casos sobre las mismas variables.

### Qué representa un timeline

La **línea de tiempo de un activo financiero**. Todo timeline requiere que se defina una **cantidad monetaria en tiempo 0**.

> Ejemplo: "tengo 50 pesos en mi bolsa" → el timeline es de 50 pesos.

- El monto en t=0 es **modificable en cualquier momento**.
- Alternativamente, se puede establecer la **duración del timeline estirando su forma**, igual que el `stretch` de FL Studio sobre samples/clips.
- Así podemos elegir **dónde poner y cuánto tiempo dura el efecto** de cada objeto financiero.

## 4. Objetos financieros

Cualquier objeto puede ser de uno de tres tipos:

### 4.1 Ingreso (objeto que aumenta periódicamente — contador)

Algo como un sueldo o cualquier ingreso recurrente.

**Programable:** se define una **regla de aumento del contador** — "cada 15 días", "cada 3 días", "cada 30 días", etc.

> Ejemplo: timeline de 50 pesos + ingreso recurrente "nuevo trabajo, cada 15 días recibo 2500 pesos". Al mover la barra al día 15, vemos `2550` como resultado.

### 4.2 Egreso (objeto que resta al timeline)

Pueden ser **periódicos** o **de una sola exhibición**.

> Ejemplo: gasto de 50 colocado en el día 15. Al mover la barra al día 15, el timeline aumenta 2500 (por el ingreso) y disminuye 50, total `2500`.

**Reglas de periodicidad — pueden ser simples o compuestas:**

- Simples: `diario`, `cada 2 días`, `cada 3 días`, `cada 15 días`.
- Compuestas (más útiles para automatizar): "Gasto 100 pesos cada 4 días de cada 7 días", "Gasto 300 pesos cada 3 días de cada 9 días", etc.

### 4.3 Deuda

Tarjetas de crédito, pagos fijos mensuales, MSI (meses sin intereses), préstamos hipotecarios. Cualquier objeto que pueda llevar **porcentaje de interés** anual / mensual / de X período. Estos también afectan al timeline.

#### Mecánica de fechas de pago

- Se eligen **fechas límite de pago** como referencia.
- Al añadir un objeto tipo `card` se pregunta: *¿antes de cuándo tienes que pagar?*
- Antes de esa fecha se genera la división lógica adecuada.

#### Mecánica de tarjeta de crédito

A una tarjeta se le pueden agregar **line items que suman a su total a pagar en su período inmediato**.

```
Tarjeta creada: {
  alias_tag: "Tarjetita Nu",
  periodoFacturacion: 30
}
```

- El sistema le da **longitud 30 en el timeline** siempre.
- **No puede ser menor** y solo puede crecer **de 30 en 30 días**.
- Solo puede **aumentar en período** (no en fragmentos arbitrarios).
- El período permite vincularse a **N items que representan deudas internas**, y en suma constituyen la deuda total de ese período.

Dentro de cualquier tarjeta pueden vivir **items normales de deuda** que se pueden registrar en cualquier período.

#### Items MSI (meses sin intereses)

- Se les pueden poner nombres personalizados.
- Se registra **costo total** y **a cuántos meses se sacó**.
- Este tipo de item **hace crecer el objeto tarjeta tantos meses como tenga el MSI** (ej. MSI a 6 meses → la tarjeta crece 6 períodos).
- Es un **objeto de nivel superior** que modifica al objeto tarjeta al agregarse.

#### Cálculo automático de la fecha de cargo del pago

- Por defecto: **un día antes del fin de período de pago**.
- Si el usuario establece sus días de pago en el objeto tarjeta (ej. "14 de agosto"), esa fecha se usa en el timeline para registrar el egreso.
- Después de esa fecha, si el usuario no especificó otra fecha futura, se asume que paga **1 día antes del fin de período** del siguiente.

## 5. Implicaciones arquitectónicas que se desprenden del spec

> Estas no son del autor original; son consecuencias directas del spec que afectan cómo se construye el repo. Documentadas aquí para que cualquier ADR futuro pueda anclar contra ellas.

1. **Separación motor gráfico / motor lógico es mandatoria, no estilística.** Es el único camino para portar a Android e iOS sin reescribir desde 0. Se traduce en: `@slicex/core` debe ser TypeScript puro sin React / Pixi / DOM. El motor gráfico (Pixi hoy) puede ser reemplazado por una capa nativa (SwiftUI / Compose / Skia / etc.) sin tocar `@slicex/core`.
2. **El timeline es la unidad de simulación, no la unidad de almacenamiento.** Múltiples timelines clonables sobre las mismas variables implica un modelo donde el dataset financiero está separado del estado del timeline (snapshot del documento + parámetros de simulación).
3. **Las reglas de periodicidad compuestas** ("X cada N días de cada M días", MSI que altera el contenedor padre) requieren un solver de eventos en el tiempo, no solo recurrencias simples. Esto rebasa lo que hoy hace `calculateBalanceAt` en `@slicex/core` — está pendiente de extender.
4. **Stretch de objetos cambia su efecto en el balance**, no solo su tamaño visual. La duración del objeto es un parámetro del modelo financiero, no decoración del renderer.
5. **"Nada de throttling de render"** es la razón de que el motor de interacción se haya construido sobre Pixi (canvas / GPU) y no sobre DOM con virtualización. Cualquier futura propuesta de "volver a DOM" debe justificar por qué no rompe este requisito.
