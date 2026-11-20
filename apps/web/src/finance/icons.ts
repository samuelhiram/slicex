// The items' icons: a catalog drawn in-house (no third-party package, no
// network, no web font — the glyphs ship inside the bundle: zero latency,
// nothing to load or to fail). Each icon is a few SVG path strings on a
// 24 × 24 grid, drawn with a 2-unit round stroke in the item's colour — the
// same data the DOM (ItemIcon) and the canvas (getClipIcon → Pixi
// GraphicsPath) draw, so the timeline and the forms always match.
//
// The plan stores only the icon's NAME (FinancialItem.icon, e.g. "house").
// The names follow Lucide's (lucide.dev) where one exists, so a native app —
// or a swap to that set — maps them one to one. A name this catalog does not
// know (a newer plan opened in an older app) draws nothing.
import type { FinancialItemKind } from "@slicex/core";

/** A glyph: SVG path data on a 24 × 24 grid, stroked (2 units, round). */
export type IconGlyph = readonly string[];

export interface IconDef {
  /** Stored in the plan: kebab-case, stable. */
  id: string;
  /** Its name for the person (tooltips, aria-label). */
  label: string;
  /** More words that find it (no accents needed). */
  keywords: string;
  group: IconGroupId;
  glyph: IconGlyph;
}

export type IconGroupId = "money" | "home" | "shopping" | "transport" | "health" | "family" | "leisure";

export const ICON_GROUPS: ReadonlyArray<{ id: IconGroupId; label: string }> = [
  { id: "money", label: "Dinero" },
  { id: "home", label: "Casa y servicios" },
  { id: "shopping", label: "Comida y compras" },
  { id: "transport", label: "Transporte" },
  { id: "health", label: "Salud y cuidado" },
  { id: "family", label: "Familia y escuela" },
  { id: "leisure", label: "Ocio y otros" },
];

// --- shape helpers (path data only: one primitive for every renderer) -------

const n = (value: number): string => String(Math.round(value * 100) / 100);

function circle(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
}

function rect(x: number, y: number, w: number, h: number, r = 0): string {
  if (r <= 0) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  const a = `${n(r)} ${n(r)} 0 0 1`;
  return (
    `M${n(x + r)} ${n(y)}h${n(w - 2 * r)}a${a} ${n(r)} ${n(r)}v${n(h - 2 * r)}` +
    `a${a} ${n(-r)} ${n(r)}h${n(-(w - 2 * r))}a${a} ${n(-r)} ${n(-r)}v${n(-(h - 2 * r))}a${a} ${n(r)} ${n(-r)}Z`
  );
}

/** A dot (a zero-length round-capped stroke). */
const dot = (x: number, y: number): string => `M${n(x)} ${n(y)}h.01`;

// --- the catalog --------------------------------------------------------------

const DEFS: IconDef[] = [
  // Dinero
  {
    id: "wallet",
    label: "Cartera",
    keywords: "dinero efectivo billetera",
    group: "money",
    glyph: [rect(3, 6.5, 18, 14, 2.5), "M17 6.5V4.8A1.8 1.8 0 0 0 15.2 3H6a3 3 0 0 0-3 3.2", "M21 11.5h-3.5a2 2 0 0 0 0 4H21"],
  },
  {
    id: "banknote",
    label: "Billete",
    keywords: "dinero efectivo pago sueldo",
    group: "money",
    glyph: [rect(2, 6, 20, 12, 2), circle(12, 12, 2.5), dot(6, 12), dot(18, 12)],
  },
  {
    id: "coins",
    label: "Monedas",
    keywords: "dinero cambio ahorro",
    group: "money",
    glyph: [circle(9, 9, 6), "M15 9A6 6 0 1 1 9 15", "M9 6.5v5"],
  },
  {
    id: "piggy-bank",
    label: "Ahorro",
    keywords: "alcancia guardar meta fondo",
    group: "money",
    glyph: [
      "M5 11.5a6.5 6 0 0 1 6.5-6H15l3-2v3.6a6 6 0 0 1 1.9 3.4H21v4h-1.4a6 6 0 0 1-2.1 2.6V20h-3v-1.8h-4.5V20H7v-3a6 6 0 0 1-2-5.5Z",
      dot(16, 9.5),
      "M9.5 8.5h3",
    ],
  },
  {
    id: "dollar-sign",
    label: "Pesos",
    keywords: "dinero peso dolar precio monto",
    group: "money",
    glyph: ["M12 2.5v19", "M16.5 6.5H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H7"],
  },
  {
    id: "briefcase",
    label: "Trabajo",
    keywords: "sueldo nomina empleo oficina negocio",
    group: "money",
    glyph: [rect(3, 7, 18, 13, 2), "M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7", "M3 12.5h18"],
  },
  {
    id: "trending-up",
    label: "Inversión",
    keywords: "rendimiento crecer ganancia subir",
    group: "money",
    glyph: ["M3 17l6-6 4 4 8-8", "M15 7h6v6"],
  },
  {
    id: "gift",
    label: "Regalo",
    keywords: "aguinaldo bono premio cumpleanos",
    group: "money",
    glyph: [
      rect(3, 8, 18, 4, 1),
      "M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7",
      "M12 8v13",
      "M12 8C11 5.5 9 3.8 7.6 4.6 6 5.6 7.5 8 12 8",
      "M12 8c1-2.5 3-4.2 4.4-3.4C18 5.6 16.5 8 12 8",
    ],
  },
  {
    id: "landmark",
    label: "Banco",
    keywords: "prestamo credito institucion gobierno",
    group: "money",
    glyph: ["M2.5 9 12 3.5 21.5 9Z", "M6 12v6M10 12v6M14 12v6M18 12v6", "M4 18h16", "M3 21h18"],
  },
  {
    id: "credit-card",
    label: "Tarjeta",
    keywords: "credito debito pago",
    group: "money",
    glyph: [rect(2, 5, 20, 14, 2), "M2 10h20", "M6 15h4"],
  },
  {
    id: "receipt",
    label: "Recibo",
    keywords: "factura cuenta ticket pago",
    group: "money",
    glyph: [
      "M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17l-2.3-1.5-2.4 1.5-2.3-1.5-2.3 1.5-2.4-1.5Z",
      "M9 8h6",
      "M9 12h6",
      "M9 16h3",
    ],
  },
  {
    id: "percent",
    label: "Intereses",
    keywords: "tasa porcentaje descuento",
    group: "money",
    glyph: ["M19 5 5 19", circle(6.5, 6.5, 2.5), circle(17.5, 17.5, 2.5)],
  },
  {
    id: "building",
    label: "Empresa",
    keywords: "negocio oficina edificio renta local",
    group: "money",
    glyph: [
      rect(5, 2.5, 14, 19, 1.5),
      dot(9, 7),
      dot(12, 7),
      dot(15, 7),
      dot(9, 11),
      dot(12, 11),
      dot(15, 11),
      dot(9, 15),
      dot(15, 15),
      "M10.5 21.5V18h3v3.5",
    ],
  },
  // Casa y servicios
  {
    id: "house",
    label: "Casa",
    keywords: "renta hogar hipoteca vivienda depa",
    group: "home",
    glyph: ["M3 10.5 12 3l9 7.5", "M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9", "M10 21v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V21"],
  },
  {
    id: "key-round",
    label: "Llave",
    keywords: "hipoteca renta depa casa auto",
    group: "home",
    glyph: [circle(7.5, 15.5, 4.5), "M10.7 12.3 20 3", "M16.5 6.5l3 3", "M14 9l2 2"],
  },
  {
    id: "zap",
    label: "Luz",
    keywords: "electricidad cfe energia",
    group: "home",
    glyph: ["M13 2 4 14h7l-1 8 9-12h-7Z"],
  },
  {
    id: "droplet",
    label: "Agua",
    keywords: "servicio agua potable",
    group: "home",
    glyph: ["M12 2.5c3 4 6.5 7.5 6.5 11.5a6.5 6.5 0 0 1-13 0c0-4 3.5-7.5 6.5-11.5Z"],
  },
  {
    id: "flame",
    label: "Gas",
    keywords: "estufa calentador fuego",
    group: "home",
    glyph: [
      "M12 21.5a6.5 6.5 0 0 0 6.5-6.5c0-4-2.7-6.8-4.8-10-.6 2.8-1.8 4.3-3.2 4.9C10.2 8 9.2 6.3 8.2 4.8 6.6 7.6 5.5 10.6 5.5 15a6.5 6.5 0 0 0 6.5 6.5Z",
      "M12 21.5a2.8 2.8 0 0 0 2.8-2.8c0-1.8-1.3-3-2.8-4.2-1.5 1.2-2.8 2.4-2.8 4.2a2.8 2.8 0 0 0 2.8 2.8Z",
    ],
  },
  {
    id: "wifi",
    label: "Internet",
    keywords: "wifi red telefono cable",
    group: "home",
    glyph: ["M2 9a14.5 14.5 0 0 1 20 0", "M5 12.5a10 10 0 0 1 14 0", "M8.5 16a5 5 0 0 1 7 0", dot(12, 19.5)],
  },
  {
    id: "smartphone",
    label: "Celular",
    keywords: "telefono movil plan datos",
    group: "home",
    glyph: [rect(6, 2, 12, 20, 2.5), "M11 18h2"],
  },
  {
    id: "tv",
    label: "Streaming",
    keywords: "television tele series peliculas cable",
    group: "home",
    glyph: [rect(2, 7, 20, 13, 2), "M7 2.5l5 4.5 5-4.5"],
  },
  {
    id: "repeat",
    label: "Suscripción",
    keywords: "mensualidad recurrente renovacion",
    group: "home",
    glyph: ["M17 2.5l3 3-3 3", "M4 11.5v-1a5 5 0 0 1 5-5h11", "M7 21.5l-3-3 3-3", "M20 12.5v1a5 5 0 0 1-5 5H4"],
  },
  // Comida y compras
  {
    id: "shopping-cart",
    label: "Súper",
    keywords: "supermercado despensa mandado compras",
    group: "shopping",
    glyph: [
      "M2.5 3h2.2l2.4 11.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 1.9-1.5L21 7H5.6",
      circle(9.5, 20, 1.3),
      circle(17, 20, 1.3),
    ],
  },
  {
    id: "shopping-bag",
    label: "Compras",
    keywords: "tienda ropa regalo bolsa",
    group: "shopping",
    glyph: ["M6 2.5 3.5 6v13.5a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V6L18 2.5Z", "M3.5 6h17", "M16 10a4 4 0 0 1-8 0"],
  },
  {
    id: "utensils",
    label: "Comida",
    keywords: "restaurante comer cena desayuno",
    group: "shopping",
    glyph: ["M4 2.5V8a3 3 0 0 0 6 0V2.5", "M7 2.5v19", "M17 21.5v-19c-2.2 0-3.5 2.5-3.5 6v5H17"],
  },
  {
    id: "coffee",
    label: "Café",
    keywords: "cafeteria antojo snack",
    group: "shopping",
    glyph: ["M4 8.5h13v5.5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z", "M17 10h1.5a2.5 2.5 0 0 1 0 5H17", "M8.5 3v2.5", "M12.5 3v2.5"],
  },
  {
    id: "shirt",
    label: "Ropa",
    keywords: "vestir zapatos moda",
    group: "shopping",
    glyph: ["M8.5 3 4 5 2.5 10 6 11.2V21h12v-9.8l3.5-1.2L20 5l-4.5-2a3.5 3.5 0 0 1-7 0Z"],
  },
  {
    id: "package",
    label: "Paquete",
    keywords: "envio compra en linea pedido caja",
    group: "shopping",
    glyph: ["M12 2.5 3.5 7v10l8.5 4.5 8.5-4.5V7Z", "M3.5 7 12 11.5 20.5 7", "M12 11.5v10", "M7.8 4.8l8.5 4.5"],
  },
  {
    id: "tag",
    label: "Etiqueta",
    keywords: "precio oferta descuento varios",
    group: "shopping",
    glyph: [
      "M3 4v7.2a2 2 0 0 0 .6 1.4l7.8 7.8a2 2 0 0 0 2.8 0l6.2-6.2a2 2 0 0 0 0-2.8L12.6 3.6A2 2 0 0 0 11.2 3H4a1 1 0 0 0-1 1Z",
      dot(7.5, 7.5),
    ],
  },
  // Transporte
  {
    id: "car",
    label: "Auto",
    keywords: "coche carro seguro tenencia verificacion",
    group: "transport",
    glyph: [
      "M5 17H3.5a1 1 0 0 1-1-1v-3.4a2 2 0 0 1 1.3-1.9L6 10l1.8-3.4a2 2 0 0 1 1.8-1.1h4.8a2 2 0 0 1 1.8 1.1L18 10l2.2.7a2 2 0 0 1 1.3 1.9V16a1 1 0 0 1-1 1H19",
      circle(7, 17, 2),
      circle(17, 17, 2),
      "M9 17h6",
      "M6 10h12",
    ],
  },
  {
    id: "fuel",
    label: "Gasolina",
    keywords: "gasolinera combustible auto",
    group: "transport",
    glyph: [
      "M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16",
      "M3 21h12",
      "M4 10h10",
      "M14 12.5h1.5A1.5 1.5 0 0 1 17 14v3a1.8 1.8 0 0 0 3.5 0V8.5L18 5.5",
    ],
  },
  {
    id: "bus",
    label: "Transporte",
    keywords: "camion metro pasaje uber taxi",
    group: "transport",
    glyph: [rect(4, 3, 16, 15, 2.5), "M4 11h16", "M7 18v2.5", "M17 18v2.5", dot(8, 14.5), dot(16, 14.5)],
  },
  {
    id: "plane",
    label: "Viaje",
    keywords: "vuelo vacaciones avion turismo",
    group: "transport",
    glyph: [
      "M12 2.5c.9 0 1.5.8 1.5 1.8V9l7 4v2l-7-2v4.5l2 1.5V21L12 20l-3.5 1v-2l2-1.5V13l-7 2v-2l7-4V4.3c0-1 .6-1.8 1.5-1.8Z",
    ],
  },
  {
    id: "bike",
    label: "Bici",
    keywords: "bicicleta moto ejercicio",
    group: "transport",
    glyph: [circle(5.5, 17, 3.5), circle(18.5, 17, 3.5), "M5.5 17 9 9.5h6.5l3 7.5", "M9 9.5 12 17l3.5-7.5", "M7.5 7h3"],
  },
  // Salud y cuidado
  {
    id: "heart",
    label: "Salud",
    keywords: "bienestar amor pareja corazon",
    group: "health",
    glyph: ["M12 20.5s-9-5.2-9-11.5A4.8 4.8 0 0 1 12 6.2 4.8 4.8 0 0 1 21 9c0 6.3-9 11.5-9 11.5Z"],
  },
  {
    id: "pill",
    label: "Medicina",
    keywords: "farmacia medicamento doctor",
    group: "health",
    glyph: ["M10.5 20.5l10-10a4.95 4.95 0 0 0-7-7l-10 10a4.95 4.95 0 0 0 7 7Z", "M8.5 8.5l7 7"],
  },
  {
    id: "square-plus",
    label: "Médico",
    keywords: "doctor consulta hospital seguro medico gastos medicos",
    group: "health",
    glyph: [rect(3, 3, 18, 18, 3), "M12 8v8", "M8 12h8"],
  },
  {
    id: "dumbbell",
    label: "Gimnasio",
    keywords: "gym ejercicio deporte",
    group: "health",
    glyph: [rect(5, 5.5, 3, 13, 1.2), rect(16, 5.5, 3, 13, 1.2), "M3 9.5v5", "M21 9.5v5", "M8 12h8"],
  },
  {
    id: "scissors",
    label: "Belleza",
    keywords: "corte pelo peluqueria estetica unas",
    group: "health",
    glyph: [circle(6, 6, 3), circle(6, 18, 3), "M20 4 8.6 15.4", "M8.6 8.6 12 12", "M14.5 14.5 20 20"],
  },
  {
    id: "shield-check",
    label: "Seguro",
    keywords: "poliza proteccion seguro de vida",
    group: "health",
    glyph: ["M12 21.5s7.5-3.5 7.5-9.5V5.5L12 2.5 4.5 5.5V12c0 6 7.5 9.5 7.5 9.5Z", "M9 12l2 2 4-4"],
  },
  {
    id: "umbrella",
    label: "Emergencias",
    keywords: "imprevistos fondo de emergencia lluvia",
    group: "health",
    glyph: ["M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9Z", "M12 12v6.5a2 2 0 0 1-4 0", "M12 2v1"],
  },
  {
    id: "smile",
    label: "Personal",
    keywords: "gustos yo antojos diversion",
    group: "health",
    glyph: [circle(12, 12, 9.5), "M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2", dot(9, 9.5), dot(15, 9.5)],
  },
  // Familia y escuela
  {
    id: "users",
    label: "Familia",
    keywords: "hijos pareja papas amigos",
    group: "family",
    glyph: [
      circle(9, 7.5, 3.5),
      "M2.5 20.5v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1",
      "M16 4.2a3.5 3.5 0 0 1 0 6.6",
      "M18.5 14.6a5 5 0 0 1 3 4.4v1.5",
    ],
  },
  {
    id: "graduation-cap",
    label: "Escuela",
    keywords: "colegiatura universidad curso estudios",
    group: "family",
    glyph: ["M2 9l10-5 10 5-10 5Z", "M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5", "M22 9v6"],
  },
  {
    id: "book",
    label: "Libros",
    keywords: "lectura utiles material escolar",
    group: "family",
    glyph: ["M4 19.5V5a2.5 2.5 0 0 1 2.5-2.5H20v17H6.5A2.5 2.5 0 0 0 4 19.5Z", "M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-2.5"],
  },
  {
    id: "paw-print",
    label: "Mascota",
    keywords: "perro gato veterinario croquetas",
    group: "family",
    glyph: [
      "M8 17.5c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5c0 1.8-1.5 3-4 3s-4-1.2-4-3Z",
      circle(5, 10.5, 1.8),
      circle(9, 6.5, 1.8),
      circle(15, 6.5, 1.8),
      circle(19, 10.5, 1.8),
    ],
  },
  // Ocio y otros
  {
    id: "gamepad-2",
    label: "Juegos",
    keywords: "videojuegos consola entretenimiento",
    group: "leisure",
    glyph: [
      "M7 6.5h10a4.5 4.5 0 0 1 4.4 3.7l.9 5a2.6 2.6 0 0 1-4.6 2.1L16 15.5H8l-1.7 1.8a2.6 2.6 0 0 1-4.6-2.1l.9-5A4.5 4.5 0 0 1 7 6.5Z",
      "M8 9.5v4",
      "M6 11.5h4",
      dot(15.5, 10.5),
      dot(17.5, 12.5),
    ],
  },
  {
    id: "music",
    label: "Música",
    keywords: "conciertos spotify canciones",
    group: "leisure",
    glyph: ["M9 18V5l11-2v13", circle(6.5, 18, 2.5), circle(17.5, 16, 2.5)],
  },
  {
    id: "ticket",
    label: "Eventos",
    keywords: "boletos cine conciertos fiesta salidas",
    group: "leisure",
    glyph: [
      "M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z",
      "M14 6v2",
      "M14 11v2",
      "M14 16v2",
    ],
  },
  {
    id: "sun",
    label: "Vacaciones",
    keywords: "playa descanso verano",
    group: "leisure",
    glyph: [
      circle(12, 12, 4),
      "M12 2.5v2",
      "M12 19.5v2",
      "M4.6 4.6 6 6",
      "M18 18l1.4 1.4",
      "M2.5 12h2",
      "M19.5 12h2",
      "M4.6 19.4 6 18",
      "M18 6l1.4-1.4",
    ],
  },
  {
    id: "laptop",
    label: "Tecnología",
    keywords: "computadora equipo gadgets electronica",
    group: "leisure",
    glyph: [rect(4, 4.5, 16, 11, 1.5), "M2 19h20"],
  },
  {
    id: "calendar",
    label: "Cuota",
    keywords: "fecha mensualidad plazo pago fijo",
    group: "leisure",
    glyph: [rect(3, 4.5, 18, 16.5, 2), "M3 9.5h18", "M8 2.5v4", "M16 2.5v4"],
  },
  {
    id: "star",
    label: "Favorito",
    keywords: "importante especial meta deseo",
    group: "leisure",
    glyph: ["M12 3l2.7 5.6 6.1.8-4.4 4.3 1.1 6.1L12 16.9l-5.5 2.9 1.1-6.1-4.4-4.3 6.1-.8Z"],
  },
];

export const ICONS: readonly IconDef[] = DEFS;

const BY_ID = new Map<string, IconDef>(DEFS.map((def) => [def.id, def]));

/** The icon named `id` (null: none, or a name this catalog does not know). O(1). */
export function iconDef(id: string | undefined | null): IconDef | null {
  return id ? BY_ID.get(id) ?? null : null;
}

/**
 * The glyph of icon `id` — the SAME array every call (the canvas compares
 * references: canon provider contract). null: none / unknown. O(1).
 */
export function iconGlyph(id: string | undefined | null): IconGlyph | null {
  return iconDef(id)?.glyph ?? null;
}

/** The icons that fit a kind best, shown first in the picker. */
export const KIND_ICON_SUGGESTIONS: Record<FinancialItemKind, readonly string[]> = {
  income: ["briefcase", "banknote", "trending-up", "gift", "coins", "building"],
  expense: ["shopping-cart", "house", "utensils", "zap", "car", "repeat"],
  loan: ["landmark", "house", "car", "percent", "key-round", "receipt"],
  "credit-card": ["credit-card", "landmark", "wallet", "receipt", "percent", "star"],
  "card-purchase": ["shopping-bag", "package", "laptop", "shirt", "plane", "tag"],
  "installment-plan": ["package", "laptop", "smartphone", "tv", "calendar", "shopping-bag"],
};

/** Lower case, no accents: "Súper" and "super" find the same icon. */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** The icons whose name or keywords contain every word of `query` (catalog order). */
export function searchIcons(query: string): IconDef[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...DEFS];
  return DEFS.filter((def) => {
    const haystack = foldText(`${def.label} ${def.keywords} ${def.id.replace(/-/g, " ")}`);
    return words.every((word) => haystack.includes(word));
  });
}
