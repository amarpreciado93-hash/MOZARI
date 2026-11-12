// Mozari · correos a los usuarios (Cloudflare Email Service, binding ENVIOS)
//
// - Bienvenida: le llega a cada cuenta nueva, una sola vez.
// - Novedades: el dueño puede mandar una actualización también por correo. Solo a quien la quiere
//   recibir (perfil.noNovedades no está prendido) y siempre con un link para darse de baja.
// Diseño: tabla de 600 px, todo en línea (los correos no leen hojas de estilo) y claro, que se lee
// igual en Gmail, Outlook y el celular. Sin la palabra "gratis": es una "cuenta de prueba".

import { planDe } from "./planes.js";

const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LIMA = "#D5FF40", TINTA = "#0B0B0B", TEXTO = "#1E1F1C", TENUE = "#6B6E66", FONDO = "#F1F2EC";
const FUENTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Primer nombre para el saludo ("Ana María López" → "Ana"); si es un correo, nada
export const primerNombre = (n) => { const t = String(n || "").trim(); return !t || t.includes("@") ? "" : t.split(/\s+/)[0].slice(0, 30); };

function boton(texto, url) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="' + LIMA + '" style="border-radius:999px">' +
    '<a href="' + esc(url) + '" style="display:inline-block;padding:14px 28px;font:600 15px ' + FUENTE + ";color:" + TINTA + ';text-decoration:none;border-radius:999px">' + esc(texto) + "</a></td></tr></table>";
}

// Marco de todos los correos: encabezado negro con el logo, cuerpo blanco y pie
export function plantilla({ base, preencabezado, cuerpo, pie, portada }) {
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>Mozari</title></head>' +
    '<body style="margin:0;padding:0;background:' + FONDO + '">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">' + esc(preencabezado) + "</div>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + FONDO + '"><tr><td align="center" style="padding:32px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;border-radius:20px;overflow:hidden">' +
    // Encabezado
    '<tr><td bgcolor="' + TINTA + '" style="padding:26px 36px">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="padding-right:12px"><img src="' + esc(base) + '/icon-192.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px"></td>' +
    '<td style="font:500 15px ' + FUENTE + ';letter-spacing:5px;color:#F7F9F2">MOZARI</td></tr></table></td></tr>' +
    '<tr><td bgcolor="' + LIMA + '" style="height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>' +
    (portada ? '<tr><td bgcolor="' + TINTA + '" style="font-size:0;line-height:0"><img src="' + esc(portada) + '" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>' : "") +
    // Cuerpo
    '<tr><td bgcolor="#FFFFFF" style="padding:36px 36px 32px;font:400 16px/1.6 ' + FUENTE + ";color:" + TEXTO + '">' + cuerpo + "</td></tr>" +
    "</table>" +
    // Pie
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px"><tr><td style="padding:20px 36px;font:400 12px/1.6 ' + FUENTE + ";color:" + TENUE + ';text-align:center">' + pie + "</td></tr></table>" +
    "</td></tr></table></body></html>";
}

const PASOS = [
  ["Crea un tour y sube tus fotos 360", "Las esferas de tu cámara 360 o de tu dron, tal como salen."],
  ["Conéctalas y dibuja tus lotes", "Hotspots para pasar de una a otra, tu logo y tus colores. Si es un desarrollo, marca cada lote con su estado y su precio."],
  ["Publica y comparte el link", "Tu cliente lo abre en el celular o la compu, sin instalar nada, y te agenda una visita."],
];

// Fotos de los correos (estudio/correo/): de Amar y de Pexels; las capturas son del Demo Mozari del sitio
const FOTOS = { bienvenida: "/correo/portada.jpg?v=1", novedad: "/correo/novedad.jpg?v=1", pasos: ["/correo/paso-1.jpg?v=1", "/correo/paso-2.jpg?v=1", "/correo/paso-3.jpg?v=1"] };
export function correoBienvenida({ nombre, base }) {
  const n = primerNombre(nombre), hola = n ? "Hola, " + n : "Hola";
  // Cada paso con su imagen: el equipo, el estudio dibujando lotes y el tour publicado
  const pasos = PASOS.map(([t, d], i) =>
    '<tr><td colspan="2" style="padding:0 0 12px"><img src="' + esc(base + FOTOS.pasos[i]) + '" width="528" alt="" style="display:block;width:100%;max-width:528px;height:auto;border:1px solid #E6E8E0;border-radius:14px"></td></tr>' +
    '<tr><td valign="top" width="44" style="padding:0 14px 28px 0"><div style="width:30px;height:30px;border-radius:50%;background:' + TINTA + ";color:" + LIMA + ";text-align:center;font:700 14px/30px " + FUENTE + '">' + (i + 1) + "</div></td>" +
    '<td valign="top" style="padding:2px 0 28px;font:400 15px/1.5 ' + FUENTE + ";color:" + TEXTO + '"><b style="font-weight:600;font-size:16px">' + esc(t) + '</b><br><span style="color:' + TENUE + '">' + esc(d) + "</span></td></tr>").join("");
  const cuerpo =
    '<h1 style="margin:0 0 14px;font:700 26px/1.25 ' + FUENTE + ";color:" + TINTA + '">' + esc(hola) + ", bienvenido a Mozari</h1>" +
    '<p style="margin:0 0 26px">Qué bueno que ya estás aquí. En Mozari haces tours virtuales 360 desde tu navegador: subes tus fotos, les pones tu marca y compartes un link.</p>' +
    '<p style="margin:0 0 16px;font-weight:600;color:' + TINTA + '">Tu primer tour, en 3 pasos:</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + pasos + "</table>" +
    '<div style="padding:0 0 28px">' + boton("Crear mi primer tour", base + "/") + "</div>" +
    '<p style="margin:0 0 18px;padding:16px 18px;border-radius:14px;background:' + FONDO + ';font-size:14px;line-height:1.55">Tu cuenta de prueba te deja practicar con <b>tours sin límite</b>, de hasta 5 esferas cada uno, con la marca de agua de Mozari. Cuando quieras publicar sin marca, pasa a Pro desde el estudio.</p>' +
    '<p style="margin:0 0 4px">Si te atoras, en el estudio está el <b>manual</b> (el librito de arriba) y el botón para <b>reportar un error</b>. Lo leemos todo.</p>' +
    '<p style="margin:22px 0 0">Nos vemos dentro,<br><b>El equipo de Mozari</b></p>';
  const pie = "Te llegó este correo porque creaste tu cuenta en mozari.app.<br>Mozari · León, Guanajuato, México";
  const texto = hola + ", bienvenido a Mozari\n\nQué bueno que ya estás aquí. En Mozari haces tours virtuales 360 desde tu navegador: subes tus fotos, les pones tu marca y compartes un link.\n\n" +
    "Tu primer tour, en 3 pasos:\n" + PASOS.map(([t, d], i) => (i + 1) + ". " + t + ". " + d).join("\n") + "\n\nCrear mi primer tour: " + base + "/\n\n" +
    "Tu cuenta de prueba te deja practicar con tours sin límite, de hasta 5 esferas cada uno, con la marca de agua de Mozari. Cuando quieras publicar sin marca, pasa a Pro desde el estudio.\n\n" +
    "Si te atoras, en el estudio está el manual (el librito de arriba) y el botón para reportar un error.\n\nNos vemos dentro,\nEl equipo de Mozari\n\n—\nTe llegó este correo porque creaste tu cuenta en mozari.app.";
  return { asunto: (n ? n + ", bienvenido" : "Bienvenido") + " a Mozari", html: plantilla({ base, preencabezado: "Tu cuenta ya está lista. Así haces tu primer tour 360.", cuerpo, pie, portada: base + FOTOS.bienvenida }), texto };
}

// Gracias por tu compra (pedido de Amar, 11 nov 2026): le llega a quien paga una licencia o espacio, siempre
// (no depende del interruptor de la bienvenida). Lo más importante: volver a publicar para quitar la marca.
const LO_QUE_INCLUYE = {
  pro: ["Tus tours salen sin marca de agua", "Esferas sin límite y 10 GB para tus fotos", "Descargas tu tour para el hosting de tu cliente"],
  desarrollos: ["Todo lo de Pro, con 50 GB", "Lotificación: manzanas, lotes, fichas técnicas y masterplan", "Tus tours con lotes salen sin marca de agua"],
  espacio: ["10 GB más para tus fotos 360, para siempre"],
};
export function correoCompra({ nombre, base, plan }) {
  const n = primerNombre(nombre), hola = n ? n + ", gracias" : "Gracias", nom = { pro: "Pro", desarrollos: "Desarrollos", espacio: "+10 GB de espacio" }[plan] || "tu compra";
  const licencia = plan === "pro" || plan === "desarrollos", items = LO_QUE_INCLUYE[plan] || [];
  const lista = items.map((t) => '<tr><td valign="top" width="26" style="padding:0 10px 10px 0;font:700 15px/1.5 ' + FUENTE + ";color:" + TINTA + '">✓</td><td style="padding:0 0 10px;font:400 15px/1.5 ' + FUENTE + ";color:" + TEXTO + '">' + esc(t) + "</td></tr>").join("");
  const cuerpo =
    '<h1 style="margin:0 0 14px;font:700 26px/1.25 ' + FUENTE + ";color:" + TINTA + '">' + esc(hola) + " por tu compra</h1>" +
    '<p style="margin:0 0 22px">' + (licencia ? "Tu licencia <b>" + esc(nom) + "</b> ya está activa. Es de pago único: es tuya y no vence." : "Tus <b>" + esc(nom) + "</b> ya están en tu cuenta.") + "</p>" +
    (lista ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px">' + lista + "</table>" : "") +
    (licencia ? '<p style="margin:0 0 24px;padding:16px 18px;border-radius:14px;background:' + FONDO + ';font-size:15px;line-height:1.55"><b>Importante:</b> los tours que ya publicaste conservan la marca de agua hasta que los <b>vuelvas a publicar</b>. Entra a cada uno, ve a <b>Publicar → Web</b> y toca <b>Publicar</b>. El link sigue siendo el mismo.</p>' : "") +
    '<div style="padding:0 0 26px">' + boton("Ir a Mozari", base + "/") + "</div>" +
    '<p style="margin:0 0 4px">Si te atoras, en el estudio está el <b>manual</b> (el librito de arriba) y el botón para <b>reportar un error</b>. Si algo de tu pago no cuadra, contesta este correo.</p>' +
    '<p style="margin:22px 0 0">Gracias por confiar en Mozari,<br><b>El equipo de Mozari</b></p>';
  const pie = "Te llegó este correo porque compraste en mozari.app.<br>Mozari · León, Guanajuato, México";
  const texto = hola + " por tu compra\n\n" + (licencia ? "Tu licencia " + nom + " ya está activa. Es de pago único: es tuya y no vence." : "Tus " + nom + " ya están en tu cuenta.") + "\n\n" +
    items.map((t) => "- " + t).join("\n") + (items.length ? "\n\n" : "") +
    (licencia ? "Importante: los tours que ya publicaste conservan la marca de agua hasta que los vuelvas a publicar. Entra a cada uno, ve a Publicar → Web y toca Publicar. El link sigue siendo el mismo.\n\n" : "") +
    "Ir a Mozari: " + base + "/\n\nSi algo de tu pago no cuadra, contesta este correo.\n\nGracias por confiar en Mozari,\nEl equipo de Mozari";
  return { asunto: licencia ? (n ? n + ", tu" : "Tu") + " licencia " + nom + " de Mozari ya está activa" : "Gracias por tu compra en Mozari", html: plantilla({ base, preencabezado: licencia ? "Ya puedes publicar sin marca de agua. Esto es lo que sigue." : "Ya tienes más espacio en Mozari.", cuerpo, pie, portada: base + FOTOS.bienvenida }), texto };
}

// Contrata tu tour 360 (escaparate): a quien pide una cotización le llega que ya la recibimos
export const TIPOS_COTIZACION = { terreno: "Terreno o desarrollo con lotes", casa: "Casa o departamento", negocio: "Hotel o negocio", otro: "Otro" };
export function correoCotizacion({ nombre, base, sol }) {
  const n = primerNombre(nombre), hola = n ? n + ", recibimos tu solicitud" : "Recibimos tu solicitud";
  const filas = [["Qué", TIPOS_COTIZACION[sol.tipo] || sol.tipo], ["Dónde", [sol.ciudad, sol.pais].filter(Boolean).join(", ")], ["Tamaño", sol.tamano], ["Para cuándo", sol.cuando]].filter(([, v]) => v);
  const tabla = filas.map(([k, v]) => '<tr><td style="padding:6px 14px 6px 0;font:400 14px/1.5 ' + FUENTE + ";color:" + TENUE + ';white-space:nowrap" valign="top">' + esc(k) + '</td><td style="padding:6px 0;font:600 14px/1.5 ' + FUENTE + ";color:" + TINTA + '">' + esc(v) + "</td></tr>").join("");
  const cuerpo =
    '<h1 style="margin:0 0 14px;font:700 26px/1.25 ' + FUENTE + ";color:" + TINTA + '">' + esc(hola) + "</h1>" +
    '<p style="margin:0 0 20px">Un operador de la red Mozari revisa tu proyecto y te mandamos tu cotización en <b>menos de 24 horas</b>, por WhatsApp o por este correo.</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;padding:14px 18px;border-radius:14px;background:' + FONDO + '">' + tabla + "</table>" +
    '<p style="margin:0 0 4px">Si quieres agregar algo (un plano, fotos o la ubicación), contesta este correo.</p>' +
    '<p style="margin:22px 0 0">Gracias por escribirnos,<br><b>El equipo de Mozari</b></p>';
  const pie = "Te llegó este correo porque pediste una cotización en mozari.app.<br>Mozari · León, Guanajuato, México";
  const texto = hola + "\n\nUn operador de la red Mozari revisa tu proyecto y te mandamos tu cotización en menos de 24 horas, por WhatsApp o por este correo.\n\n" +
    filas.map(([k, v]) => k + ": " + v).join("\n") + "\n\nSi quieres agregar algo (un plano, fotos o la ubicación), contesta este correo.\n\nGracias por escribirnos,\nEl equipo de Mozari";
  return { asunto: (n ? n + ", recibimos" : "Recibimos") + " tu solicitud de tour 360", html: plantilla({ base, preencabezado: "Te mandamos tu cotización en menos de 24 horas.", cuerpo, pie }), texto };
}

// Novedad: título, texto (con saltos de línea), imagen opcional y un botón
// Novedad (la misma que se anuncia dentro del estudio): cada renglón del texto es un punto
export function correoNovedad({ nombre, base, etiqueta, titulo, texto, imagen, boton: btn, destino, baja }) {
  const n = primerNombre(nombre), ir = /^https:\/\//.test(destino || "") ? destino : base + "/";
  const parrafos = String(texto || "").trim().split(/\n+/).map((x) => x.replace(/^[\s•·\-–*]+/, "").trim()).filter(Boolean);
  const puntos = parrafos.length > 1
    ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + parrafos.map((p) =>
      '<tr><td valign="top" style="padding:9px 12px 0 0;font-size:0;line-height:0"><div style="width:8px;height:8px;border-radius:50%;background:' + LIMA + ';border:1px solid #B9DE22"></div></td>' +
      '<td valign="top" style="padding:0 0 10px;font:400 16px/1.55 ' + FUENTE + ";color:" + TEXTO + '">' + esc(p) + "</td></tr>").join("") + "</table>"
    : parrafos.map((p) => '<p style="margin:0 0 14px">' + esc(p) + "</p>").join("");
  const cuerpo =
    '<p style="margin:0 0 6px;font:600 12px ' + FUENTE + ';letter-spacing:2px;text-transform:uppercase;color:' + TENUE + '">' + esc(etiqueta || "Novedad en Mozari") + "</p>" +
    '<h1 style="margin:0 0 18px;font:700 26px/1.25 ' + FUENTE + ";color:" + TINTA + '">' + esc(titulo) + "</h1>" +
    (imagen ? '<img src="' + esc(imagen) + '" width="528" alt="" style="display:block;width:100%;max-width:528px;height:auto;border:0;border-radius:14px;margin:0 0 22px">' : "") +
    (n ? '<p style="margin:0 0 14px">Hola, ' + esc(n) + ".</p>" : "") + puntos +
    '<div style="padding:14px 0 6px">' + boton(btn || "Abrir Mozari", ir) + "</div>";
  const pie = "Te llegó porque tienes cuenta en mozari.app y recibes las novedades.<br>" +
    '<a href="' + esc(baja) + '" style="color:' + TENUE + '">Ya no quiero recibir novedades</a> · Mozari · León, Guanajuato, México';
  const textoPlano = (etiqueta || "Novedad en Mozari") + "\n\n" + titulo + "\n\n" + (n ? "Hola, " + n + ".\n\n" : "") + parrafos.map((p) => "• " + p).join("\n") + "\n\n" + (btn || "Abrir Mozari") + ": " + ir + "\n\n—\nYa no quiero recibir novedades: " + baja;
  return { asunto: "Mozari · " + titulo, html: plantilla({ base, preencabezado: parrafos[0] || titulo, cuerpo, pie, portada: imagen ? "" : base + FOTOS.novedad }), texto: textoPlano };
}

// Campaña «Ya salió Mozari» con descuento de la beta: link personal de un solo uso para cada quien
export function correoCampana({ nombre, base, link, pct, vence, baja }) {
  const n = primerNombre(nombre), hola = n ? "Hola, " + n + "." : "Hola.";
  const fecha = vence ? new Date(vence).toLocaleDateString("es-MX", { day: "numeric", month: "long", timeZone: "America/Mexico_City" }) : "";
  const pasos = PASOS.map(([t, d], i) =>
    '<tr><td colspan="2" style="padding:0 0 12px"><img src="' + esc(base + FOTOS.pasos[i]) + '" width="528" alt="" style="display:block;width:100%;max-width:528px;height:auto;border:1px solid #E6E8E0;border-radius:14px"></td></tr>' +
    '<tr><td valign="top" width="44" style="padding:0 14px 26px 0"><div style="width:30px;height:30px;border-radius:50%;background:' + TINTA + ";color:" + LIMA + ";text-align:center;font:700 14px/30px " + FUENTE + '">' + (i + 1) + "</div></td>" +
    '<td valign="top" style="padding:2px 0 26px;font:400 15px/1.5 ' + FUENTE + ";color:" + TEXTO + '"><b style="font-weight:600;font-size:16px">' + esc(t) + '</b><br><span style="color:' + TENUE + '">' + esc(d) + "</span></td></tr>").join("");
  const cupon = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 28px"><tr><td bgcolor="' + TINTA + '" style="border-radius:18px;padding:26px 26px 24px">' +
    '<p style="margin:0 0 4px;font:600 12px ' + FUENTE + ";letter-spacing:2px;text-transform:uppercase;color:" + LIMA + '">Precio de la beta</p>' +
    '<p style="margin:0 0 8px;font:700 40px/1.1 ' + FUENTE + ';color:#F7F9F2">' + pct + ' % de descuento</p>' +
    '<p style="margin:0 0 20px;font:400 15px/1.5 ' + FUENTE + ';color:#C9CCC2">En Pro o Desarrollos. Tu link es personal y se usa una vez' + (fecha ? "; vale hasta el " + esc(fecha) : "") + ".</p>" +
    boton("Usar mi " + pct + " %", link) + "</td></tr></table>";
  const cuerpo =
    '<p style="margin:0 0 6px;font:600 12px ' + FUENTE + ';letter-spacing:2px;text-transform:uppercase;color:' + TENUE + '">Ya salió Mozari</p>' +
    '<h1 style="margin:0 0 16px;font:700 28px/1.2 ' + FUENTE + ";color:" + TINTA + '">Tus tours 360, con tu marca y tus lotes, desde el navegador</h1>' +
    '<p style="margin:0 0 14px">' + esc(hola) + "</p>" +
    '<p style="margin:0 0 22px">Mozari es el software que hicimos en R360 para hacer tours virtuales 360: subes tus esferas, las conectas, dibujas tus lotes y compartes un link. Ya está abierto, y mientras dure la beta tienes un descuento para entrar.</p>' +
    cupon +
    '<p style="margin:0 0 16px;font-weight:600;color:' + TINTA + '">Así se hace un tour en Mozari:</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + pasos + "</table>" +
    '<p style="margin:0 0 18px;padding:16px 18px;border-radius:14px;background:' + FONDO + ';font-size:14px;line-height:1.55">¿Primero quieres probar? Entra y practica con tu cuenta de prueba: tours sin límite, de hasta 5 esferas cada uno, con la marca de agua de Mozari. Tu descuento te espera.</p>' +
    '<p style="margin:22px 0 0">Nos vemos dentro,<br><b>El equipo de Mozari</b></p>';
  const pie = "Te llegó porque tomaste un curso o te registraste con R360 o en mozari.app.<br>" +
    '<a href="' + esc(baja) + '" style="color:' + TENUE + '">Ya no quiero recibir correos de Mozari</a> · Mozari · León, Guanajuato, México';
  const texto = "Ya salió Mozari\n\n" + hola + "\n\nMozari es el software que hicimos en R360 para hacer tours virtuales 360: subes tus esferas, las conectas, dibujas tus lotes y compartes un link. Ya está abierto, y mientras dure la beta tienes un descuento para entrar.\n\n" +
    pct + " % de descuento en Pro o Desarrollos. Tu link es personal y se usa una vez" + (fecha ? "; vale hasta el " + fecha : "") + ":\n" + link + "\n\n" +
    "¿Primero quieres probar? Entra y practica con tu cuenta de prueba: tours sin límite, de hasta 5 esferas cada uno.\n\nNos vemos dentro,\nEl equipo de Mozari\n\n—\nYa no quiero recibir correos de Mozari: " + baja;
  return { asunto: (n ? n + ", ya" : "Ya") + " salió Mozari: " + pct + " % de descuento en la beta", html: plantilla({ base, preencabezado: "Tu link personal con " + pct + " % de descuento en Pro o Desarrollos.", cuerpo, pie, portada: base + FOTOS.bienvenida }), texto };
}

// ---------- Envío ----------
// Topes para no tener sorpresas en el cobro: el plan de Cloudflare incluye 3,000 correos al mes.
// Nunca se pasa de 2,800 al mes ni de 300 al día; lo que falte se manda al día siguiente (o al otro mes).
export const TOPE_MES = 2800, TOPE_DIA = 190, LOTE = 40;
// Cloudflare Email Sending (beta) deja mandar 200 al día (contando los avisos al dueño). Las campañas y las
// actualizaciones se detienen en 150 al día, así siempre quedan lugares para la bienvenida y el correo de compra.
export const TOPE_MASIVO_DIA = 150;
// Cada hora el reloj manda solo 6 (≈144 al día, repartidos): así en cualquier ventana de 24 h de Cloudflare
// sobra lugar para los correos de bienvenida y de compra, sin importar a qué hora reinicia su cuota.
export const POR_HORA_MASIVO = 6;
const CONF = "config/correos.json", PERFIL = (uid) => "cuentas/" + uid + "/perfil.json";
const JSONH = { httpMetadata: { contentType: "application/json" } };
export async function leerConf(env) {
  const o = await env.R2.get(CONF), c = (o ? await o.json().catch(() => ({})) : {}) || {};
  return { bienvenida: c.bienvenida === true };
}
export const guardarConf = (env, c) => env.R2.put(CONF, JSON.stringify(c), JSONH);
const leerNum = async (env, k) => { const o = await env.R2.get(k); return o ? +(await o.text()) || 0 : 0; };
// Contador del mes y del día (se lee una vez por tanda y se guarda al final)
export async function contador(env) {
  const d = new Date().toISOString(), k = { mes: "correos/cuenta/" + d.slice(0, 7), dia: "correos/cuenta/" + d.slice(0, 10) };
  const [mes, dia] = await Promise.all([leerNum(env, k.mes), leerNum(env, k.dia)]);
  return { k, mes, dia, antes: mes, guardar() { return this.mes === this.antes ? null : Promise.all([env.R2.put(k.mes, String(this.mes)), env.R2.put(k.dia, String(this.dia))]); } };
}
// Manda uno. Devuelve "ok", "tope" (se llegó al tope: esperar) o "error:<código>"
export async function enviar(env, cuenta, { para, asunto, html, texto, baja }) {
  if (!env.ENVIOS) return "error:SIN_ENVIOS";
  if (cuenta.mes >= TOPE_MES || cuenta.dia >= TOPE_DIA) return "tope";
  const dominio = env.DOMINIO || "mozari.app";
  const m = { to: para, from: { email: "hola@" + dominio, name: "Mozari" }, replyTo: "hola@" + dominio, subject: asunto, html, text: texto };
  // Botón de «darse de baja» de Gmail y Apple Mail (si Cloudflare no acepta el encabezado, se manda sin él)
  if (baja) m.headers = { "List-Unsubscribe": "<" + baja + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  try { await env.ENVIOS.send(m); }
  catch (e) {
    const c = String((e && e.code) || "ERROR");
    if (!(m.headers && /^E_HEADER/.test(c))) return /RATE_LIMIT|DAILY_LIMIT/.test(c) ? "tope" : "error:" + c;
    delete m.headers;
    try { await env.ENVIOS.send(m); } catch (e2) { const c2 = String((e2 && e2.code) || "ERROR"); return /RATE_LIMIT|DAILY_LIMIT/.test(c2) ? "tope" : "error:" + c2; }
  }
  cuenta.mes++; cuenta.dia++;
  return "ok";
}

// Bienvenida: una sola vez por cuenta, solo si el dueño la prendió en su panel
export async function mandarBienvenida(env, p, base) {
  if (!env.ENVIOS || !p || !p.email || p.bienvenida) return false;
  if (!(await leerConf(env)).bienvenida) return false;
  const cuenta = await contador(env), c = correoBienvenida({ nombre: p.nombre, base });
  const r = await enviar(env, cuenta, { para: p.email, asunto: c.asunto, html: c.html, texto: c.texto });
  await cuenta.guardar();
  return r === "ok";
}

// Novedades por correo: la lista de quién falta se guarda en correos/cola/<id>.json y se manda por tandas
// (una al darle «Mandar» y las demás cada hora con el reloj del Worker), sin pasar los topes.
const COLA = (id) => "correos/cola/" + id + ".json";
export const enlaceBaja = (base, token) => base + "/baja?t=" + encodeURIComponent(token);
export function correoDeNovedad(n, p, base, baja) {
  return correoNovedad({ nombre: p.nombre, base, etiqueta: n.etiqueta, titulo: n.titulo, texto: n.texto, boton: n.boton, destino: n.destino, baja,
    imagen: n.media && n.mediaTipo === "imagen" ? base + "/correo/novedad/" + n.id + "?v=" + encodeURIComponent(n.mediaV || n.publicada || "") : "" });
}
export async function iniciarCola(env, n, uids) {
  const c = { id: n.id, pendientes: uids, total: uids.length, enviados: 0, fallas: 0, inicio: new Date().toISOString(), fin: "" };
  await env.R2.put(COLA(n.id), JSON.stringify(c), JSONH);
  return c;
}
// Manda la siguiente tanda de una novedad. firma(uid) da el token del link de baja.
export async function avanzarCola(env, id, base, firma, cuantos = LOTE) {
  const oc = await env.R2.get(COLA(id)); if (!oc) return null;
  const c = await oc.json(); if (!c.pendientes.length) return c;
  if (c.tipo === "campana") return avanzarCampana(env, c, base, firma, cuantos);
  const on = await env.R2.get("novedades/" + id + ".json"), n = on ? await on.json() : null;
  if (!n || !n.activa) { c.pendientes = []; c.fin = new Date().toISOString(); c.cancelada = true; }
  const cuenta = await contador(env);
  while (c.pendientes.length && cuantos-- > 0) {
    const uid = c.pendientes[0], op = await env.R2.get(PERFIL(uid)), p = op ? await op.json().catch(() => null) : null;
    if (p && p.email && !p.bloqueado && !p.noNovedades) {
      if (cuenta.mes >= TOPE_MES || cuenta.dia >= TOPE_MASIVO_DIA) break; // lo demás en la siguiente hora (o mañana)
      const baja = enlaceBaja(base, await firma(uid)), m = correoDeNovedad(n, p, base, baja);
      const r = await enviar(env, cuenta, { para: p.email, asunto: m.asunto, html: m.html, texto: m.texto, baja });
      if (r === "tope") break;
      if (r === "ok") c.enviados++; else c.fallas++;
    }
    c.pendientes.shift();
  }
  if (!c.pendientes.length && !c.fin) c.fin = new Date().toISOString();
  await Promise.all([cuenta.guardar(), env.R2.put(COLA(id), JSON.stringify(c), JSONH)]);
  if (n) { n.correo = { total: c.total, enviados: c.enviados, fallas: c.fallas, faltan: c.pendientes.length, inicio: c.inicio, fin: c.fin }; await env.R2.put("novedades/" + id + ".json", JSON.stringify(n), JSONH); }
  return c;
}
// Reloj de cada hora: sigue con las novedades que aún tienen pendientes
export async function avanzarColas(env, base, firma) {
  const l = await env.R2.list({ prefix: "correos/cola/", limit: 100 });
  for (const o of l.objects) {
    const id = o.key.slice(13, -5);
    const r = await avanzarCola(env, id, base, firma, POR_HORA_MASIVO).catch(() => null);
    if (r && r.pendientes.length) break; // llegó al tope o a la tanda: lo demás en la siguiente hora
  }
}

// ---------- Campañas (correo con descuento a una lista + usuarios con cuenta de prueba) ----------
// correos/campanas/<id>.json guarda la campaña (y a quién va); la cola es correos/cola/c<id>.json.
// Cada correo lleva su propio cupón de un solo uso (cupones/AL-XXXXXX.json, nota = el correo), creado
// justo al mandarlo: a quien no le llega, no se le crea. Quien se da de baja sin tener cuenta queda en
// correos/baja/<huella del correo> y ya no recibe ninguna campaña.
export const CAMPANA = (id) => "correos/campanas/" + id + ".json";
async function huella(t) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(t).trim().toLowerCase())); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
export const claveBajaCorreo = async (email) => "correos/baja/" + (await huella(email));
const LETRAS_CUPON = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
async function nuevoCupon(env, k, email) {
  for (let i = 0; i < 6; i++) {
    const r = crypto.getRandomValues(new Uint8Array(6)), codigo = "AL-" + [...r].map((x) => LETRAS_CUPON[x % LETRAS_CUPON.length]).join("");
    if (await env.R2.head("cupones/" + codigo + ".json")) continue;
    const cupon = { codigo, pct: k.pct, planes: k.planes, max: 1, vence: k.vence || null, usos: 0, usadoPor: [], activo: true, nota: String(email).slice(0, 60), lote: "c" + k.id, creado: new Date().toISOString() };
    await env.R2.put("cupones/" + codigo + ".json", JSON.stringify(cupon), JSONH);
    return codigo;
  }
  return null;
}
export async function iniciarCampana(env, k) {
  const c = { id: "c" + k.id, tipo: "campana", campana: k.id, pendientes: k.destinos, total: k.destinos.length, enviados: 0, fallas: 0, omitidos: 0, inicio: new Date().toISOString(), fin: "" };
  await env.R2.put(COLA(c.id), JSON.stringify(c), JSONH);
  k.estado = "enviando"; k.envio = { total: c.total, enviados: 0, fallas: 0, omitidos: 0, faltan: c.total, inicio: c.inicio, fin: "" };
  await env.R2.put(CAMPANA(k.id), JSON.stringify(k), JSONH);
  return c;
}
async function avanzarCampana(env, c, base, firma, cuantos) {
  const ok = await env.R2.get(CAMPANA(c.campana)), k = ok ? await ok.json() : null;
  if (!k) { c.pendientes = []; c.fin = new Date().toISOString(); c.cancelada = true; }
  const cuenta = await contador(env);
  while (c.pendientes.length && cuantos-- > 0) {
    const it = c.pendientes[0];
    let nombre = "", omitir = !!(await env.R2.head(await claveBajaCorreo(it.e)));
    if (!omitir && it.u) {
      const op = await env.R2.get(PERFIL(it.u)), p = op ? await op.json().catch(() => null) : null;
      if (!p || p.bloqueado || p.noNovedades || planDe(p).id !== "gratis") omitir = true; else nombre = p.nombre;
    }
    if (omitir) { c.omitidos++; c.pendientes.shift(); continue; }
    if (cuenta.mes >= TOPE_MES || cuenta.dia >= TOPE_MASIVO_DIA) break; // lo demás en la siguiente hora (o mañana)
    const codigo = await nuevoCupon(env, k, it.e);
    if (!codigo) { c.fallas++; c.pendientes.shift(); continue; }
    const baja = enlaceBaja(base, await firma(it.u ? it.u : { bajaCorreo: it.e }));
    const m = correoCampana({ nombre, base, link: base + "/entrar?cupon=" + codigo, pct: k.pct, vence: k.vence, baja });
    const r = await enviar(env, cuenta, { para: it.e, asunto: m.asunto, html: m.html, texto: m.texto, baja });
    if (r === "tope") { await env.R2.delete("cupones/" + codigo + ".json"); break; }
    if (r === "ok") c.enviados++;
    else { c.fallas++; await env.R2.delete("cupones/" + codigo + ".json"); }
    c.pendientes.shift();
  }
  if (!c.pendientes.length && !c.fin) c.fin = new Date().toISOString();
  await Promise.all([cuenta.guardar(), env.R2.put(COLA(c.id), JSON.stringify(c), JSONH)]);
  if (k) {
    k.envio = { total: c.total, enviados: c.enviados, fallas: c.fallas, omitidos: c.omitidos, faltan: c.pendientes.length, inicio: c.inicio, fin: c.fin };
    if (c.fin) k.estado = "enviada";
    await env.R2.put(CAMPANA(k.id), JSON.stringify(k), JSONH);
  }
  return c;
}

// Página para darse de baja (y volver a recibirlas). El link trae la cuenta firmada.
const paginaBaja = (titulo, texto, boton, accion, t) => '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Mozari · Novedades</title>' +
  '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:' + TINTA + ";color:#F7F9F2;font:16px/1.55 " + FUENTE + "}.c{max-width:420px;padding:32px 24px;text-align:center}h1{font-size:24px;margin:16px 0 8px}p{color:#B9BCB2;margin:0 0 22px}" +
  "button{font:600 15px " + FUENTE + ";padding:13px 26px;border-radius:999px;border:0;background:" + LIMA + ";color:" + TINTA + ";cursor:pointer}a{color:#B9BCB2;font-size:14px}.l{display:block;margin-top:18px}</style></head><body><div class=\"c\">" +
  '<img src="/icon-192.png" width="56" height="56" alt="Mozari" style="border-radius:14px"><h1>' + esc(titulo) + "</h1><p>" + esc(texto) + "</p>" +
  (accion ? '<form method="post" action="/baja?t=' + encodeURIComponent(t) + '"><input type="hidden" name="accion" value="' + accion + '"><button>' + esc(boton) + "</button></form>" : "") +
  '<a class="l" href="/">Ir a Mozari</a></div></body></html>';
export async function rutaBaja(request, env, verificar) {
  const url = new URL(request.url), t = url.searchParams.get("t") || "", d = await verificar(env, t);
  const html = (cuerpo, status = 200) => new Response(cuerpo, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  // Sin cuenta en Mozari (de una lista): se marca su correo y ya no recibe campañas
  if (d && d.bajaCorreo) {
    const k = await claveBajaCorreo(d.bajaCorreo), ya = !!(await env.R2.head(k));
    if (request.method === "POST") {
      const f = await request.text().catch(() => ""), accion = /accion=alta/.test(f) ? "alta" : "baja";
      if (accion === "baja") await env.R2.put(k, JSON.stringify({ fecha: new Date().toISOString() }), JSONH); else await env.R2.delete(k);
      return accion === "baja"
        ? html(paginaBaja("Listo, ya no te escribiremos", "No te llegarán más correos de Mozari. Si cambias de opinión, puedes volver a recibirlos.", "Volver a recibirlos", "alta", t))
        : html(paginaBaja("Listo, te volverán a llegar", "Te escribimos solo cuando haya algo nuevo en Mozari.", "", "", ""));
    }
    return ya
      ? html(paginaBaja("Ya no recibes correos de Mozari", "Si quieres, puedes volver a recibirlos.", "Volver a recibirlos", "alta", t))
      : html(paginaBaja("¿Ya no quieres recibir correos de Mozari?", "Dejaremos de escribirte. Es un solo clic.", "Sí, ya no quiero recibirlos", "baja", t));
  }
  if (!d || !d.baja) return html(paginaBaja("Este link ya no sirve", "Ábrelo desde el último correo de Mozari que te llegó.", "", "", ""), 400);
  const op = await env.R2.get(PERFIL(d.baja)), p = op ? await op.json().catch(() => null) : null;
  if (!p) return html(paginaBaja("Este link ya no sirve", "No encontramos tu cuenta.", "", "", ""), 404);
  if (request.method === "POST") {
    const f = await request.text().catch(() => ""), accion = /accion=alta/.test(f) ? "alta" : "baja"; // Gmail manda «List-Unsubscribe=One-Click»
    if (accion === "baja") p.noNovedades = new Date().toISOString(); else delete p.noNovedades;
    await env.R2.put(PERFIL(p.uid), JSON.stringify(p), JSONH);
    return accion === "baja"
      ? html(paginaBaja("Listo, ya no te llegarán novedades", "Tu cuenta y tus tours siguen igual. Si cambias de opinión, puedes volver a recibirlas.", "Volver a recibirlas", "alta", t))
      : html(paginaBaja("Listo, te volverán a llegar", "Te escribimos solo cuando haya algo nuevo en Mozari.", "", "", ""));
  }
  return p.noNovedades
    ? html(paginaBaja("Ya no recibes novedades", "Si quieres, puedes volver a recibirlas.", "Volver a recibirlas", "alta", t))
    : html(paginaBaja("¿Ya no quieres recibir novedades?", "Dejaremos de mandarte los correos con lo nuevo de Mozari. Tu cuenta y tus tours siguen igual.", "Sí, ya no quiero recibirlas", "baja", t));
}
