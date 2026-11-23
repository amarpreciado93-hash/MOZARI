// Mozari · Worker del ESTUDIO (la plataforma: escaparate, cuentas con Google y estudio)
//
//   /                         escaparate si no has entrado · el estudio si ya entraste
//   /entrar /auth/google /salir   entrar con Google y salir (sesion.js)
//   GET    /api/yo            tu cuenta
//   GET    /api/tours         tus tours
//   POST   /api/tours         crea un tour            { nombre }
//   GET    /api/tours/:id     proyecto (borrador)
//   PUT    /api/tours/:id     guarda el proyecto
//   DELETE /api/tours/:id     borra el tour completo
//   PUT    /api/tours/:id/f/<ruta>        sube un archivo (piezas de esfera, imágenes, audio)
//   DELETE /api/tours/:id/f/<prefijo>/    borra una carpeta (por ejemplo una esfera)
//   POST   /api/tours/:id/publicar        congela el borrador como versión pública
//   GET    /api/tours/:id/descargar       lo necesario para armar el .zip del tour publicado (otro hosting)
//   GET    /api/uso           espacio que usan tus tours y tu plan
//   GET    /api/admin/cuentas         (solo el dueño) todas las cuentas
//   PUT    /api/admin/cuentas/:uid    (solo el dueño) cambia el plan de una cuenta  { plan }
//   GET    /api/admin/laboratorio     (solo el dueño) funciones en prueba y para quién están
//   GET    /api/admin/tours/:id       (solo el dueño) lee el proyecto de cualquier tour, para revisar reportes
//   GET|PUT /api/admin/cupo           (solo el dueño) cupo de cuentas { cupo } y la lista de espera
//   GET    /api/novedades             anuncios para esta cuenta (y si ya los vio) · POST /api/novedades/:id/vista
//   GET|POST /api/admin/novedades     (solo el dueño) crear y editar anuncios · PUT /:id · PUT /:id/media
//   PUT    /api/admin/laboratorio/:clave   { modo: yo|probadores|pago|todos, probadores: [correos] }
//   GET    /t/:id/<ruta>      archivos de tu tour (el estudio los usa para mostrar las esferas)
//   POST   /v/:id  y  /c/:id  (públicos, desde el tour) resumen anónimo de una visita · aviso de que el tour se cerró solo
//
// Cada tour pertenece a una cuenta: cuentas/<uid>/tours/<id>. Nadie puede leer, cambiar ni borrar
// tours de otra cuenta. Los tours publicados se ven en el Worker de tours (público, solo lectura).

import { json, error, rutaValida, tipoDe, servirR2, borrarPrefijo, ID_TOUR, conCarga, cargaEnViejos, rutasEdicion, prefijoEdicion, LLAVE_MAPA, ESTILO_MAPA, confMapa, satDe, olvidarSat } from "./comun.js";
import { vozEstado, vozAudio, adminVoz } from "./voces.js";
import { rutasSesion, cuentaDe, perfil, leerCupo, contarCuentas, firmarLink, verificarLink } from "./sesion.js";
import { leerConf, guardarConf, contador, enviar, TOPE_MES, TOPE_DIA, correoBienvenida, correoCompra, correoCotizacion, htmlCotizacion, textoCotizacion, TIPOS_COTIZACION, correoDeNovedad, correoCampana, enlaceBaja, iniciarCola, avanzarCola, avanzarColas, rutaBaja, CAMPANA, iniciarCampana, correoCompu, mandarRecordatorios, sembrarRecordatorios } from "./correos.js";
import { cookiesOrigen, pedirLink, mandarProspectosPendientes, listaProspectos } from "./origen.js";
import { PLANES, planDe, pasa, usaLotificacion, sumarMeses } from "./planes.js";
import { apiPagos, webhookMercadoPago, webhookStripe, CODIGO, cuponClave } from "./pagos.js";
import { EmailMessage } from "cloudflare:email";
import { vigilarRespaldos, apiRespaldos } from "./respaldos.js";

const MAX_PROYECTO = 8 * 1024 * 1024;   // 8 MB de JSON
const MAX_ARCHIVO = 25 * 1024 * 1024;   // 25 MB por archivo
const MAX_VIDEO = 95 * 1024 * 1024;     // 95 MB por video (Cloudflare acepta hasta 100 MB por envío)

function idNuevo(nombre) {
  const base = String(nombre || "tour").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "tour";
  const azar = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 5);
  return (base.length < 3 ? "tour-" + base : base) + "-" + azar;
}

const indiceDe = (uid, id) => "cuentas/" + uid + "/tours/" + id;
async function guardarIndice(env, uid, id, datos) {
  const prev = await env.R2.head(indiceDe(uid, id));
  const meta = Object.assign({}, prev ? prev.customMetadata : {}, datos, { actualizado: new Date().toISOString() });
  Object.keys(meta).forEach((k) => (meta[k] = String(meta[k]).slice(0, 400)));
  await env.R2.put(indiceDe(uid, id), "", { customMetadata: meta });
}
const esDueno = async (env, uid, id) => !!(await env.R2.head(indiceDe(uid, id)));

// La primera vez que entra el dueño de Mozari, se queda con los tours creados antes de las cuentas
async function adoptarTours(env, p) {
  if (!p.admin) return;
  let cursor;
  do {
    const l = await env.R2.list({ prefix: "indice/", include: ["customMetadata"], cursor, limit: 1000 });
    for (const o of l.objects) {
      await env.R2.put(indiceDe(p.uid, o.key.slice(7)), "", { customMetadata: o.customMetadata || {} });
      await env.R2.delete(o.key);
    }
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
}

// Espacio usado por una cuenta. Contarlo cuesta, así que se guarda y se recalcula cada 10 minutos
// (o al momento cuando se pide). Para los límites basta con este dato reciente.
async function usoDe(env, uid, forzar) {
  const k = "cuentas/" + uid + "/uso.json";
  if (!forzar) {
    const o = await env.R2.get(k);
    if (o) { const u = await o.json(); if (Date.now() - u.fecha < 10 * 60 * 1000) return u; }
  }
  let bytes = 0, tours = 0, cur;
  do {
    const l = await env.R2.list({ prefix: "cuentas/" + uid + "/tours/", cursor: cur, limit: 1000 });
    for (const t of l.objects) {
      tours++;
      let c;
      do {
        const f = await env.R2.list({ prefix: "tours/" + t.key.split("/").pop() + "/", cursor: c, limit: 1000 });
        f.objects.forEach((o) => (bytes += o.size));
        c = f.truncated ? f.cursor : undefined;
      } while (c);
    }
    cur = l.truncated ? l.cursor : undefined;
  } while (cur);
  const u = { bytes, tours, fecha: Date.now() };
  await env.R2.put(k, JSON.stringify(u));
  return u;
}
const gb = (b) => (b / 1024 ** 3).toFixed(b < 10 * 1024 ** 3 ? 1 : 0) + " GB";
const limite = (mensaje, que) => json({ error: mensaje, limite: que }, 403);

// ---------- Contrata tu tour 360 (pedido de Amar, 11 nov 2026) ----------
// Desde el escaparate (sin cuenta): la solicitud se guarda en cotizaciones/<id>.json, al cliente le llega que ya se
// recibió y al dueño un aviso con todo (y un link a WhatsApp). En el Panel de dueño → Solicitudes cambia su estado.
const ESTADOS_COT = ["nueva", "cotizada", "ganada", "perdida"], COT_DIA_IP = 5;
// Cotización tentativa (pedido de Amar, 17 nov 2026): tarifas fijas que el dueño cambia en su panel (config/cotizacion.json).
// Solo «Terreno o desarrollo con lotes» lleva precio; las demás, «te enviamos tu cotización en minutos». Nunca hay tabla pública.
const TARIFAS_COT = "config/cotizacion.json";
const TARIFAS_DEF = { dron: 3500, armado: 3000, porLote: 20, minimo: 8000, maximo: 25000, anticipo: 50, vigencia: 7, whatsapp: "524777217228" };
async function tarifasCot(env) {
  const o = await env.R2.get(TARIFAS_COT), c = o ? await o.json().catch(() => ({})) : {}, t = Object.assign({}, TARIFAS_DEF);
  Object.keys(TARIFAS_DEF).forEach((k) => { if (k === "whatsapp") { if (/^\d{10,15}$/.test(String(c.whatsapp || ""))) t.whatsapp = String(c.whatsapp); } else if (Number.isFinite(+c[k]) && +c[k] >= 0 && c[k] !== "" && c[k] !== null) t[k] = +c[k]; });
  if (t.maximo < t.minimo) t.maximo = t.minimo; t.anticipo = Math.min(100, t.anticipo); t.vigencia = Math.max(1, Math.round(t.vigencia));
  return t;
}
function armarCotizacion(sol, t) {
  const ahora = new Date(), vence = new Date(ahora.getTime() + t.vigencia * 864e5);
  const folio = "MZ-" + ahora.toISOString().slice(2, 10).replace(/-/g, "") + "-" + sol.id.split("-")[1].slice(-4).toUpperCase().padStart(4, "0");
  const tipo = TIPOS_COTIZACION[sol.tipo] || sol.tipo, lugar = [sol.ciudad, sol.pais].filter(Boolean).join(", ");
  const q = { folio, fecha: ahora.toISOString(), vence: vence.toISOString(), whatsapp: t.whatsapp, conPrecio: sol.tipo === "terreno" };
  if (!q.conPrecio) {
    q.mensaje = "Hola, soy " + sol.nombre + ". Envié la solicitud " + folio + " en Mozari para un tour 360 de " + tipo.toLowerCase() + " en " + lugar + ". Quiero mi cotización.";
    return q;
  }
  const conceptos = [["Levantamiento con dron", t.dron], ["Armado del tour", t.armado], ["Lotificación (" + sol.lotes.toLocaleString("es-MX") + " lotes × $" + t.porLote.toLocaleString("es-MX") + ")", sol.lotes * t.porLote]];
  const subtotal = conceptos.reduce((a, [, m]) => a + m, 0), total = Math.min(t.maximo, Math.max(t.minimo, subtotal)), anticipo = Math.round((total * t.anticipo) / 100);
  Object.assign(q, { moneda: "MXN", lotes: sol.lotes, conceptos, subtotal, total, ajuste: total > subtotal ? "minimo" : total < subtotal ? "maximo" : "", anticipo, contraentrega: total - anticipo, pctAnticipo: t.anticipo, vigencia: t.vigencia });
  q.mensaje = "Hola, soy " + sol.nombre + ". Tengo la cotización tentativa " + folio + " de Mozari: tour 360 de mi terreno en " + lugar + ", " + sol.lotes.toLocaleString("es-MX") + " lotes, total $" + total.toLocaleString("es-MX") + " MXN + IVA. Quiero agendar la junta de revisión.";
  return q;
}
async function huellaCorta(t) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(t))); return [...new Uint8Array(b)].slice(0, 10).map((x) => x.toString(16).padStart(2, "0")).join(""); }
async function cotizar(request, env, url) {
  if (request.method === "GET") return json({ pais: (request.cf && request.cf.country) || "" });
  if (request.method !== "POST") return error(405, "Método no permitido");
  const origen = request.headers.get("origin");
  if (origen && origen !== url.origin) return error(403, "Origen no permitido");
  const c = await request.json().catch(() => null); if (!c || typeof c !== "object") return error(400, "Solicitud inválida");
  const t = (k, n) => String(c[k] == null ? "" : c[k]).replace(/\s+/g, " ").trim().slice(0, n);
  // Trampa para robots: el campo escondido lleno o el formulario enviado en menos de 3 s. Se contesta «ok» y no se guarda.
  if (t("sitio", 60) || (+c.tiempo > 0 && +c.tiempo < 3000)) return json({ ok: true });
  const sol = { tipo: TIPOS_COTIZACION[c.tipo] ? c.tipo : "", pais: t("pais", 40), ciudad: t("ciudad", 80), tamano: t("tamano", 80), cuando: t("cuando", 40), nombre: t("nombre", 80),
    whatsapp: t("whatsapp", 30), correo: t("correo", 120).toLowerCase(), mas: String(c.mas == null ? "" : c.mas).trim().slice(0, 800) };
  if (!sol.tipo || !sol.pais || !sol.ciudad || !sol.nombre || sol.whatsapp.replace(/\D/g, "").length < 8 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sol.correo)) return error(400, "Revisa los datos de tu solicitud");
  // Terreno o desarrollo: cuántos lotes (para la cotización tentativa)
  if (sol.tipo === "terreno") { sol.lotes = Math.round(+String(c.lotes || "").replace(/[^\d.]/g, "")); if (!(sol.lotes >= 1 && sol.lotes <= 100000)) return error(400, "Escribe cuántos lotes tiene (aproximado)"); }
  const hoy = new Date().toISOString().slice(0, 10), tope = "cotizaciones-tope/" + hoy + "/" + (await huellaCorta(request.headers.get("cf-connecting-ip") || "local"));
  const n = +((await (await env.R2.get(tope))?.text()) || 0);
  if (n >= COT_DIA_IP) return error(429, "Ya recibimos tus solicitudes de hoy. Te contactamos pronto.");
  await env.R2.put(tope, String(n + 1));
  const id = new Date().toISOString().replace(/\D/g, "").slice(0, 14) + "-" + crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  Object.assign(sol, { id, fecha: new Date().toISOString(), estado: "nueva", paisRed: (request.cf && request.cf.country) || "" });
  sol.cotizacion = armarCotizacion(sol, await tarifasCot(env));
  await env.R2.put("cotizaciones/" + id + ".json", JSON.stringify(sol), { httpMetadata: { contentType: "application/json" } });
  const base = "https://" + (env.DOMINIO || url.hostname), m = correoCotizacion({ nombre: sol.nombre, base, sol });
  await enviar(env, await contador(env), { para: sol.correo, asunto: m.asunto, html: m.html, texto: m.texto }).catch(() => null);
  await avisarCotizacion(env, sol, url);
  return json({ ok: true, id, cotizacion: sol.cotizacion });
}
async function avisarCotizacion(env, sol, url) {
  if (!env.CORREO || !env.ADMIN) return;
  try {
    const dom = env.DOMINIO || url.hostname, de = "reportes@" + dom, wa = sol.whatsapp.replace(/\D/g, "");
    const q = sol.cotizacion || {};
    const asunto = "Mozari · Solicitud de tour 360" + (q.folio ? " " + q.folio : "") + ": " + (TIPOS_COTIZACION[sol.tipo] || sol.tipo) + " en " + sol.ciudad + ", " + sol.pais + (q.conPrecio ? " · $" + q.total.toLocaleString("es-MX") + " + IVA" : "");
    const cuerpo = "Nueva solicitud de tour 360\n\nQué: " + (TIPOS_COTIZACION[sol.tipo] || sol.tipo) + "\nDónde: " + sol.ciudad + ", " + sol.pais + "\nTamaño: " + (sol.tamano || "—") + "\nPara cuándo: " + (sol.cuando || "—") +
      "\n\nNombre: " + sol.nombre + "\nWhatsApp: " + sol.whatsapp + " (https://wa.me/" + wa + ")\nCorreo: " + sol.correo + (sol.mas ? "\n\nComentarios:\n" + sol.mas : "") +
      (q.conPrecio ? "\n\nLa cotización que vio al enviar:\n\n" + textoCotizacion(sol, q) : q.folio ? "\n\nFolio: " + q.folio + " (sin precio: no es terreno; vio «te enviamos tu cotización en minutos»)" : "") +
      "\n\nContesta este correo para escribirle. Está en tu Panel de dueño → Solicitudes: https://" + dom + "/";
    const escH = (x) => String(x == null ? "" : x).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
    const htmlDueno = '<div style="font:14px/1.5 Poppins,Helvetica,Arial,sans-serif;color:#0B0B0B"><p style="margin:0 0 12px"><b>Nueva solicitud de tour 360</b>' + (q.folio ? " · " + escH(q.folio) : "") + "</p>" +
      (q.conPrecio ? htmlCotizacion(sol, q) : "") + '<pre style="font:13px/1.5 Menlo,Consolas,monospace;white-space:pre-wrap;margin:16px 0 0">' + escH(cuerpo) + "</pre></div>";
    const corte = "mz" + sol.id.replace(/\W/g, "");
    const raw = ["From: Mozari <" + de + ">", "To: " + env.ADMIN, "Reply-To: " + sol.correo, "Subject: =?UTF-8?B?" + b64utf8(asunto) + "?=",
      "Message-ID: <cot-" + sol.id + "@" + dom + ">", "Date: " + new Date().toUTCString(), "MIME-Version: 1.0",
      "Content-Type: multipart/alternative; boundary=\"" + corte + "\"", "", "--" + corte,
      "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64utf8(cuerpo).replace(/.{76}/g, "$&\r\n"), "--" + corte,
      "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64utf8(htmlDueno).replace(/.{76}/g, "$&\r\n"), "--" + corte + "--", ""].join("\r\n");
    await env.CORREO.send(new EmailMessage(de, env.ADMIN, raw));
  } catch (e) { /* la solicitud ya quedó guardada aunque el aviso falle */ }
}

// ---------- Reportes de error ----------
// Cada reporte se guarda en reportes/<id>.json (y su imagen en reportes/<id>.jpg). Si el Worker tiene el
// enlace de correo CORREO (Email Routing de Cloudflare), además le llega un correo al dueño.
const REPORTES_DIA = 15, MAX_IMG_REPORTE = 3 * 1024 * 1024;
const b64utf8 = (t) => btoa(String.fromCharCode(...new TextEncoder().encode(t)));
async function avisarPorCorreo(env, rep, url) {
  if (!env.CORREO || !env.ADMIN) return;
  try {
    const de = "reportes@" + (env.DOMINIO || url.hostname), asunto = "Mozari · Reporte de " + (rep.nombre || rep.email);
    const cuerpo = rep.texto + "\n\n— " + rep.nombre + " <" + rep.email + ">\nPlan: " + rep.plan + "\nTour: " + (rep.contexto.tour || "—") + "\nSección: " + (rep.contexto.seccion || "—") +
      "\nNavegador: " + (rep.contexto.navegador || "—") + "\nPantalla: " + (rep.contexto.pantalla || "—") + (rep.contexto.errores && rep.contexto.errores.length ? "\n\nErrores en la página:\n" + rep.contexto.errores.join("\n") : "") +
      (rep.imagen ? "\n\nTiene imagen: ábrela en el Panel de dueño." : "") + "\n\nPanel de dueño: https://" + (env.DOMINIO || url.hostname) + "/";
    const raw = ["From: Mozari <" + de + ">", "To: " + env.ADMIN, "Reply-To: " + rep.email, "Subject: =?UTF-8?B?" + b64utf8(asunto) + "?=",
      "Message-ID: <" + rep.id + "@" + (env.DOMINIO || url.hostname) + ">", "Date: " + new Date().toUTCString(), "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64utf8(cuerpo).replace(/.{76}/g, "$&\r\n")].join("\r\n");
    await env.CORREO.send(new EmailMessage(de, env.ADMIN, raw));
  } catch (e) { /* el reporte ya quedó guardado aunque el correo falle */ }
}
async function crearReporte(request, env, yo, plan) {
  const c = await request.json().catch(() => null);
  const texto = String((c && c.texto) || "").trim().slice(0, 4000);
  if (!texto) return error(400, "Cuéntanos qué pasó");
  const hoy = new Date().toISOString().slice(0, 10), cuenta = "cuentas/" + yo.uid + "/reportes-" + hoy;
  const n = +((await (await env.R2.get(cuenta))?.text()) || 0);
  if (n >= REPORTES_DIA && !yo.admin) return error(429, "Ya enviaste muchos reportes hoy. Gracias, los estamos revisando.");
  const id = hoy.replace(/-/g, "") + "-" + Date.now().toString(36) + crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  const ctx = c.contexto && typeof c.contexto === "object" ? c.contexto : {};
  const corto = (v, k) => String(v || "").slice(0, k);
  const rep = {
    id, fecha: new Date().toISOString(), estado: "nuevo", uid: yo.uid, email: yo.email, nombre: yo.nombre || "", plan: plan.id, texto,
    contexto: { tour: corto(ctx.tour, 80), seccion: corto(ctx.seccion, 60), navegador: corto(ctx.navegador, 300), pantalla: corto(ctx.pantalla, 40), errores: (Array.isArray(ctx.errores) ? ctx.errores : []).slice(-10).map((e) => corto(e, 400)) },
    imagen: false,
  };
  if (typeof c.imagen === "string" && /^data:image\/(jpeg|png);base64,/.test(c.imagen)) {
    const bin = Uint8Array.from(atob(c.imagen.split(",")[1]), (x) => x.charCodeAt(0));
    if (bin.length <= MAX_IMG_REPORTE) { await env.R2.put("reportes/" + id + ".jpg", bin, { httpMetadata: { contentType: c.imagen.slice(5, c.imagen.indexOf(";")) } }); rep.imagen = true; }
  }
  await env.R2.put("reportes/" + id + ".json", JSON.stringify(rep), { httpMetadata: { contentType: "application/json" } });
  await env.R2.put(cuenta, String(n + 1));
  await avisarPorCorreo(env, rep, new URL(request.url));
  return json({ ok: true, id }, 201);
}

// Laboratorio: funciones nuevas que primero prueba el dueño (y quien él elija) antes de darlas a todos.
// El estudio solo muestra la herramienta si la cuenta la tiene en su lista "lab".
export const LABORATORIO = {
  "manzana-curvas": { nombre: "Calle curva", texto: "Manijas en cada punto de la orilla de una manzana (como la pluma de Illustrator) para calles en curva u ola." },
  "estadisticas": { nombre: "Estadísticas de los tours", texto: "Publicar → Estadísticas: visitas, celular o compu, ciudades, de dónde llegan, tiempo, esferas y lotes más vistos y clics a contacto. Cuenta los tours publicados con esta función activa." },
  "fichas": { nombre: "Creador de fichas", texto: "En Fichas técnicas: diseña la ficha que ve tu cliente al tocar un lote, con el logo, colores y tipografía del desarrollo, el plano del lote y su ubicación." },
  "referencia": { nombre: "Plano de referencia", texto: "En Capas: una ventanita con tu masterplan (PDF o imagen) para trazar manzanas y lotes viéndolo. Solo se ve al editar; tus clientes no lo ven en el tour." },
  "manzana-desfase": { nombre: "Doble manzana desfasada", texto: "En una manzana doble, la fila de atrás puede tener otro número de lotes y recorrerse para no coincidir con la del frente." },
  "foto360": { nombre: "Foto 360 con lotes", texto: "En Capas: descarga la esfera como foto 360 (JPG 2:1) con todo lo que tiene, tal cual se ve en el editor (lotes con sus nombres y medidas, manzanas, rutas, polígonos, textos, puntos de interés, hotspots e imágenes 3D), lista para Facebook, Google Fotos u otros visores 360." },
  "carga-logo": { nombre: "Pantalla de carga con tu logo", texto: "El tour publicado carga con el logo y el nombre del proyecto (de la Interfaz), en sus colores, en lugar de Mozari. Se aplica al volver a publicar. En la cuenta de prueba sigue la de Mozari." },
  "manual": { nombre: "Manual", texto: "Botón del librito, arriba a la derecha: los temas del manual de Mozari con sus pasos, un buscador y, primero, los temas de la sección donde estás. Si no se resuelve, lleva a Reportar un error." },
  "mano": { nombre: "Manita con la barra espaciadora", texto: "En las esferas del editor: mantén la barra espaciadora y sale la manita. Arrastras para girar la esfera aunque estés sobre un lote o dibujando, sin mover nada ni poner puntos." },
  "privado": { nombre: "Modo privado", texto: "En Publicar → Web: oculta un tour publicado sin borrarlo (por ejemplo, mientras el cliente termina de pagar). Quien abra el link ve «Este tour no está disponible por ahora». Al mostrarlo vuelve igual, con el mismo link." },
  "interiorismo": { nombre: "Interiorismo y departamentos", texto: "Interfaz «Interior» (botones redondos, menú por espacios y el nombre del espacio abajo) y ficha «Técnica»: plano de cada tipo de unidad, tabla de datos, superficies, planes de pago que recalculan el precio, notas y botón al recorrido 360. También «Departamento · Torre» en los nombres." },
  "iconos": { nombre: "Íconos animados", texto: "En Capas → un hotspot: elige un ícono que se mueve (cocina, baño, recámara, alberca, dron, lotes…) y cámbiale sus 3 colores: líneas, acento y fondo. De inicio toma el color de la Interfaz del tour." },
  "kmz": { nombre: "Lotes desde un KMZ", texto: "En el plano de referencia: sube el KMZ o KML de Google Earth con los lotes. Mozari dibuja el plano con su medida real, lee el número, la manzana y la superficie de cada lote, y los colocas en la esfera con 4 esquinas, como con el PDF." },
  "imagen3d": { nombre: "Imagen en 3D", texto: "En Capas → «Imagen 3D»: sube un PNG o JPG (tu plano de CAD, unas manzanas) y queda pegado a la esfera. Crece desde la esquina sin deformarse y con Inclinar se acuesta sobre el terreno. Encima puedes poner polígonos con su acción." },
  "limpio": { nombre: "Edición limpia", texto: "En Propiedades cada grupo (Estilo, Ícono animado, Al hacer clic, Terreno, Orden…) tiene su flechita: todo sale abierto y tú cierras lo que no usas (se recuerda). «Cerrar todo» / «Abrir todo» arriba a la derecha. En Capas, «Agregar» esconde o muestra los botones para agregar." },
  "terreno-facil": { nombre: "Terreno en 3 pasos", texto: "Panoramas → Terreno: 1) eliges 2 esferas con los menús de arriba (de todas las del tour; solo esas se amarran), 2) marcas 4 puntos y la esfera que toca tocar se ilumina, 3) un botón verde pasa tus manzanas. Con animación la primera vez y en «¿Cómo se usa?». En Capas el interruptor se llama «Pasar a las esferas amarradas»." },
  "carpetas": { nombre: "Manzanas como carpeta", texto: "En Capas cada manzana guarda sus lotes como un grupo de Photoshop: cerrada de inicio, con su flechita la abres o la cierras, dice cuántos lotes tiene y su ojito oculta o muestra todos sus lotes. Al tocar un lote en la esfera, su carpeta se abre sola." },
  "manzanas-esferas": { nombre: "Manzanas en todas las esferas", texto: "Con el Terreno amarrado: selecciona una manzana y en Terreno prende «Aplicar a todas las esferas»; pasa completa, con sus lotes, a las demás esferas. En Panoramas → Terreno, un botón pasa de una vez todas las manzanas y lotes de la esfera Base. «Duplicar» en una manzana hace otra igual a un lado, con el siguiente número." },
  "estados": { nombre: "Más estados de lote", texto: "En Fichas técnicas → Estados: «+ Estado» agrega estados propios (En negociación, Bloqueado, Escriturado…) con su color, hasta 8. Salen en cada lote, la leyenda del tour, la ficha y el Excel. Los propios se quitan con la ×; sus lotes regresan a Disponible." },
  "lotes-pdf": { nombre: "Lotes desde el PDF", texto: "En el plano de referencia: arrastras un recuadro sobre una manzana del PDF, Mozari arma sus lotes y los colocas en la esfera tocando 4 esquinas. Necesita también «Plano de referencia»." },
  "planos": { nombre: "Plano con radar", texto: "Media → Planos: sube el plano de cada piso (casa, depa, oficina) y pon en él tus esferas con un toque; jalas su cono para que apunte a lo mismo que la esfera. En el tour sale chico en una esquina: el punto de donde estás se ilumina, el cono gira hacia donde miras y tocar otro punto te lleva a esa esfera." },
  "narracion": { nombre: "Narración por espacio", texto: "Media → Audios: sube una voz (MP3, M4A o WAV) para cada esfera, con su subtítulo. En el tour suena sola al llegar a ese espacio, la música baja mientras habla y una pastilla arriba la pausa o la repite. La presentación espera a que termine." },
  "lotes-movil": { nombre: "Disponibilidad desde el celular", texto: "Abre mozari.app en tu celular: elige el tour, toca un lote y márcalo Apartado o Vendido. El tour publicado cambia al momento, sin volver a publicar, y el estudio abierto en la compu no lo regresa. Solo licencias de pago." },
  "copiar-capas": { nombre: "Copiar y pegar capas", texto: "En Capas: elige una o varias capas (una manzana va con sus lotes y sus datos) y cópialas con Ctrl+C (⌘+C en Mac). Ve a otra esfera y pégalas con Ctrl+V: salen enfrente de ti, sin ubicarse en el terreno, para que las acomodes. También con los botones Copiar y Pegar de Propiedades." },
  "tipografias": { nombre: "Tus tipografías", texto: "En cualquier selector de Tipografía (textos, rótulos de los lotes y ficha): «Subir tu tipografía» en TTF, OTF o WOFF (hasta 5 MB). Se guarda en el proyecto y sale igual en el tour publicado, en el .zip y en la foto 360." },
  "landing": { nombre: "Landing del desarrollo", texto: "Publicar → Landing: una página de venta con la marca del proyecto (logos, colores y letras de su manual), portada, plano maestro (se amplía con los dedos), lotes con su precio y calculadora de pagos, recorrido 360, galería, ubicación y WhatsApp con el lote elegido. Se ve en celular y compu y se publica con el tour en su link /landing." },
  "bienvenida": { nombre: "Pantalla de bienvenida", texto: "Proyecto → General: el tour abre con tu logo, el nombre y un botón sobre la esfera girando despacio. Al tocarlo empieza el recorrido con su música y su piloto automático, sin la pregunta de «Activar sonido». Se aplica al volver a publicar." },
  "tutorial-video": { nombre: "Tutorial en video", texto: "En Mis Tours y en Panoramas (mientras el tour no tiene esferas) sale la tarjeta «Tutorial paso a paso»: abre el video de cómo armar un tour, dentro de Mozari, con un aviso de que se grabó antes de las últimas actualizaciones." },
  "mejora": { nombre: "Mejora de esferas", texto: "Ventana «Mejora», junto a Mis Tours: la edición de tus esferas. Ajustes de imagen (brillo, contraste, saturación, sombras, altas luces, temperatura y detalle) que se ven al momento y se guardan al instante; «Quitar el tripié» (el piso visto desde arriba) y «Borrar objetos» en cualquier parte de la esfera, con corrector puntual y tampón de clonar. Sale así en el tour publicado y en el .zip; la foto original no se pierde. Se usa en la compu." },
  "descarga-pdf": { nombre: "Botón para descargar un PDF", texto: "En Interfaz → Descargar PDF: sube el plano, el brochure o la ficha de venta (hasta 25 MB) y en el tour sale un botón junto al de contacto («Descargar plano» o el texto que quieras). En el celular sale solo el ícono para no tapar la vista. También viaja en el .zip." },
  "transiciones": { nombre: "Transiciones inmersivas", texto: "Al tocar un punto para pasar a otra esfera, la vista gira hacia él, avanza y la siguiente esfera entra en vivo (también en celular), sin la foto plana que se veía como página doblada. Antes de abrir, el tour precarga todas sus esferas con una foto de portada, el nombre y el avance." },
  "acabado": { nombre: "Acabado fino del tour", texto: "Retoques a lo que ve tu cliente. Diseño Cine: el título, el nombre y el botón de contacto salen blancos (antes un velo oscuro los dejaba grises); en celular ya salen el botón de contacto y el nombre del proyecto, y las flechas se leen sobre fondos claros. Diseño Brújula: el nombre de la esfera ya no se repite ni se corta en la orilla y los puntos de la ruta se tocan fácil. Se aplica al volver a publicar." },
  "ejemplo": { nombre: "Fotos de ejemplo", texto: "En un tour sin esferas: «Probar con fotos de ejemplo» sube 2 fotos 360 de muestra (una aérea y una a pie) para practicar sin traer fotos propias. Quedan como esferas normales y se borran igual." },
  "tours-link": { nombre: "Link a la mano en Mis Tours", texto: "En Mis Tours, cada tour publicado trae «Copiar link» y «Abrir» en su tarjeta, sin tener que entrar al tour e ir a Publicar." },
  "ubicacion": { nombre: "Ubicación en satélite", texto: "Media → Ubicación: sube el KMZ (o KML) de tu desarrollo y míralo sobre el mapa satelital, en su lugar real. Mozari revisa el archivo y dice en palabras simples qué trae y qué le falta (contorno, lotes, nombres), con la guía «Cómo debe venir tu KMZ» lista para mandársela al ingeniero. Los números de lote salen al acercar y el contorno late al mover el mapa. Si no cae en su lugar, se amarra al satélite con 2 puntos. Se publica con el tour en su link /mapa." },
  "voz-ia": { nombre: "Sonido del tour: música y voz", texto: "Interfaz → «Sonido del tour»: una sola ventana para la música y la voz. Subes tu canción, escribes lo que quieres que diga la voz y una voz lo lee tal cual (o subes tu propio audio). La voz suena cuando el tour empieza y sigue aunque tu cliente cambie de esfera; la música baja sola mientras habla y los subtítulos van pasando por frases. Cada tour puede crear 2 voces al mes y cada licencia trae sus letras de voz (Pro 5,000, Desarrollos 12,000; unas 900 letras son un minuto). Todo Mozari tiene un tope mensual." },
  "previa-celular": { nombre: "Vista previa en celular", texto: "Junto al botón «Vista previa» hay uno con un teléfono: abre el tour dentro de un celular 9:16, con su música, su voz, sus lotes y todo funcionando (antes el 9:16 solo se veía en Interfaz, sin sonido). Arriba se cambia a la vista de compu. Pedido de Emanuel." },
  "rotulo-corto": { nombre: "Rótulo corto y grande en los lotes", texto: "Panoramas → Fichas técnicas → «Rótulo en la esfera: Corto y grande»: cada lote dice solo «L09» y su manzana («M5»), en dos renglones y con letra mucho más grande y centrada; se lee de un vistazo, también desde lejos. La superficie sigue en la ficha del lote. Vale para todo el tour y se ve al volver a publicar." },
  "rotulo-estilos": { nombre: "Número del lote: siglas, solo número, círculo o insignia", texto: "Panoramas → Fichas técnicas → «Rótulo en la esfera»: en Texto, Siglas («L-12») o Solo número («12») en vez de «Lote 12 · M3»; en Estilo, el número dentro de un Círculo o una Insignia del color de su estado (disponible, apartado, vendido), siempre de frente a la cámara. También en el celular y en la Foto 360 (pedido de Obed, nov 2026)." },
  "equipo": { nombre: "Equipo: trabajar un tour entre varios", texto: "Proyecto → General → «Equipo»: invita con su correo a quien te ayuda con un tour (hasta 5). Con su propia cuenta le sale en Mis Tours → «Compartidos contigo» y lo edita y publica con tu licencia; no puede borrarlo ni invitar a otros. Una sola persona edita a la vez: si alguien más lo tiene abierto, sale «Fulano está editando» y solo ves hasta que termine, así nadie borra el trabajo del otro." },
  "lotes-vendidos": { nombre: "Lotes vendidos sin número ni ficha", texto: "Al tocar un lote, en Estado: «Todos los lotes Vendido del tour» trae «Muestran su número» y «Se pueden tocar». Apágalos y todos los lotes vendidos quedan en rojo, sin número y sin abrir su ficha, sin ir uno por uno; también los que marques después desde el celular o el link de tu cliente. Lo mismo para cualquier estado, también en Fichas técnicas → «Ya vendidos». Se ve al volver a publicar." },
  "manzana-unir": { nombre: "Unir manzanas", texto: "Una manzana hecha de dos partes (los lotes de la esquina y los dobles, por ejemplo): selecciona una y en «Unir con otra manzana» elige la otra. Quedan como una sola manzana: el mismo número, la numeración sigue de una parte a la otra y el rótulo, el estilo y el contorno se cambian en las dos a la vez. «Separar» las vuelve a dejar aparte." },
  "voz-idiomas": { nombre: "Voz en inglés y español", texto: "Interfaz → «Sonido del tour»: la voz en español y otra en inglés, cada una con sus voces (escribes el texto en cada idioma). En el tour, la pastilla de la voz trae ES | EN: cada visitante la oye en el idioma de su celular o compu y la cambia con un toque. Se ve al volver a publicar." },
  "link-cliente": { nombre: "Link de disponibilidad para tu cliente", texto: "Publicar → «Link para tu cliente»: un link que le mandas por WhatsApp a tu cliente (el desarrollador o su vendedor). Lo abre en su celular o compu, sin cuenta ni contraseña, ve sus lotes y los marca Disponible, Apartado o Vendido; el tour publicado cambia al momento. Solo puede cambiar el estado de los lotes de ese tour. Tú ves qué cambió y cuándo, y lo quitas cuando quieras. Con Desarrollos la página del cliente sale limpia; con otra licencia o la cuenta de prueba lleva la marca de agua «Creado por Mozari»." },
  "cotas": { nombre: "Cotas en paredes", texto: "En Capas → «Cota»: tocas el inicio y el final de un muro (en el piso) y Mozari calcula su largo con la altura de la cámara; un punto en el piso y otro arriba da la altura. Si tienes la medida del plano, la escribes y manda esa. Salen en el tour como en un plano." },
};
// "pago": las cuentas Pro y Desarrollos (con su plan vigente); "desarrollos": solo Desarrollos (pedido de Amar,
// 23 nov 2026, para Equipo); "todos" incluye también Gratis
const MODOS_LAB = ["yo", "probadores", "desarrollos", "pago", "todos"];
// De dónde llegó la cuenta, para el panel (sin el identificador del clic)
const origenPanel = (o) => (o && typeof o === "object" ? { fuente: o.fuente || "", medio: o.medio || "", campana: o.campana || "", anuncio: o.anuncio || "", correo: !!o.correo } : null);
const LEER_CUENTAS = 350; // Panel de dueño: cuentas que se vuelven a leer por petición (el tope de una petición son 1,000 lecturas)
// Noviembre 2026: todo lo que estaba en el Laboratorio salió a Pro y Desarrollos (versión 2 de la configuración).
// Lo que se agregue después nace "Solo yo". Desde el panel cada función se puede regresar a "Solo yo".
const LANZADAS_V2 = ["manzana-curvas", "estadisticas", "fichas", "referencia", "manzana-desfase", "foto360", "lotes-pdf", "carga-logo"];
async function leerLab(env) {
  const o = await env.R2.get("config/laboratorio.json");
  const c = (o ? await o.json().catch(() => ({})) : {}) || {};
  const v2 = +c._v >= 2;
  return Object.fromEntries(Object.keys(LABORATORIO).map((k) => {
    const f = c[k] || {};
    let modo = MODOS_LAB.includes(f.modo) ? f.modo : "yo";
    if (!v2 && LANZADAS_V2.includes(k) && modo !== "todos") modo = "pago";
    return [k, { modo, probadores: Array.isArray(f.probadores) ? f.probadores : [] }];
  }));
}
// Disponibilidad desde el celular (Laboratorio «lotes-movil», pedido de Amar 11 nov 2026): cambiar el estado de un
// lote sin la compu. Se cambia en el borrador Y en el tour publicado (el cliente lo ve al momento, sin volver a
// publicar). Se anota en tours/<id>/estados-movil.json { "mz|num": { estado, antes, ts } } para que el estudio abierto
// en la compu (que guarda el proyecto completo) no lo regrese: si su lote todavía trae el estado de «antes», se
// corrige; si trae otro, es que en la compu lo cambiaron a propósito y manda ese.
const ESTADOS_BASE = ["disponible", "apartado", "vendido"];
const llaveLote = (mz, num) => String(mz == null ? "" : mz).trim().toLowerCase() + "|" + String(num == null ? "" : num).trim().toLowerCase();
function cambiarEstados(p, cambios) {
  const validos = new Set(ESTADOS_BASE.concat((Array.isArray(p.lotesEstados) ? p.lotesEstados : []).map((e) => e && e.id).filter(Boolean)));
  const porLlave = new Map(cambios.filter((x) => validos.has(x.estado)).map((x) => [llaveLote(x.mz, x.num), x.estado]));
  const antes = {}; let n = 0;
  Object.values(p.capas || {}).forEach((l) => (Array.isArray(l) ? l : []).forEach((c) => {
    if (!c || !c.lote) return;
    const k = llaveLote(c.lote.manzana, c.lote.numero), e = porLlave.get(k);
    if (!e || c.lote.estado === e) return;
    if (!(k in antes)) antes[k] = c.lote.estado || "disponible";
    c.lote.estado = e; n++;
  }));
  return { n, antes };
}
async function leerJSON(env, clave) { const o = await env.R2.get(clave); return o ? o.json().catch(() => null) : null; }
// Cambia el estado de lotes en el borrador Y en el tour publicado, y lo anota para que un estudio abierto no lo regrese.
// quien: "celular" (el dueño desde su cel) o "cliente" (el link de disponibilidad para el cliente).
async function aplicarEstados(env, id, cambios, quien) {
  const base = "tours/" + id + "/", borrador = await leerJSON(env, base + "proyecto.json");
  if (!borrador) return null;
  const r1 = cambiarEstados(borrador, cambios);
  if (r1.n) await env.R2.put(base + "proyecto.json", JSON.stringify(borrador), { httpMetadata: { contentType: tipoDe("x.json") } });
  const pub = await leerJSON(env, "publicado/" + id + "/proyecto.json");
  let r2 = { n: 0 };
  if (pub) { r2 = cambiarEstados(pub, cambios); if (r2.n) await env.R2.put("publicado/" + id + "/proyecto.json", JSON.stringify(pub), { httpMetadata: { contentType: tipoDe("x.json"), cacheControl: "no-cache" } }); }
  if (r1.n) {
    const movil = (await leerJSON(env, base + "estados-movil.json")) || {}, ts = new Date().toISOString();
    cambios.forEach((x) => { const k = llaveLote(x.mz, x.num); if (k in r1.antes) movil[k] = { estado: x.estado, antes: movil[k] && movil[k].antes ? movil[k].antes : r1.antes[k], ts, quien }; });
    await env.R2.put(base + "estados-movil.json", JSON.stringify(movil), { httpMetadata: { contentType: "application/json" } });
  }
  return { borrador: r1.n, publicado: r2.n, enTour: !!pub, antes: r1.antes, proyecto: borrador };
}

// Link de disponibilidad para el cliente (Laboratorio «link-cliente», pedido de Amar 21 nov 2026): «mandarle algo a mi
// cliente para que él solito modifique su disponibilidad». Un link sin cuenta ni contraseña que SOLO cambia el estado de
// los lotes de ese tour (borrador y publicado, igual que desde el celular). El dueño lo crea, lo copia y lo quita.
//   tours/<id>/cliente.json          { token, creado }        el link, para volver a copiarlo
//   clientes/<huella>.json           { id, uid, creado }      huella = SHA-256 del token (el índice no guarda el link)
//   tours/<id>/cambios-cliente.json  [{ mz, num, estado, antes, ts }]   los últimos 100, para el dueño
const TOKEN_CLIENTE = /^[A-Za-z0-9_-]{32}$/, CAMBIOS_CLIENTE_HORA = 300;
// Pedido de Amar: es de Desarrollos, pero todos lo pueden usar; sin Desarrollos la página del cliente lleva la marca de agua
const conMarcaCliente = (cuenta) => !cuenta.admin && planDe(cuenta).id !== "desarrollos";
const huellaToken = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].slice(0, 16).map((x) => x.toString(16).padStart(2, "0")).join("");
const tokenNuevo = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const lotesParaCliente = (p) => {
  const m = new Map();
  Object.values(p.capas || {}).forEach((l) => (Array.isArray(l) ? l : []).forEach((c) => {
    if (!c || !c.lote || (!String(c.lote.numero || "").trim() && !String(c.lote.manzana || "").trim())) return;
    const k = llaveLote(c.lote.manzana, c.lote.numero);
    if (!m.has(k)) m.set(k, { mz: String(c.lote.manzana || "").slice(0, 40), num: String(c.lote.numero || "").slice(0, 40), estado: String(c.lote.estado || "disponible"), area: String(c.lote.area || "").slice(0, 20), precio: String(c.lote.precio || "").slice(0, 30) });
  }));
  return [...m.values()];
};
async function linkDeCliente(env, token) {
  if (!TOKEN_CLIENTE.test(token || "")) return null;
  const ix = await leerJSON(env, "clientes/" + (await huellaToken(token)) + ".json");
  if (!ix || !ID_TOUR.test(ix.id || "") || !ix.uid) return null;
  const c = await leerJSON(env, "tours/" + ix.id + "/cliente.json");
  if (!c || c.token !== token || !(await esDueno(env, ix.uid, ix.id))) return null; // lo quitaron o lo cambiaron
  const dueno = await perfil(env, ix.uid);
  if (!dueno || dueno.bloqueado) return null;
  // Si se apaga en el Laboratorio, el link queda en pausa sin borrarse. Sin Desarrollos funciona con marca de agua.
  if (!(await labDe(env, dueno)).includes("link-cliente")) return { apagado: true };
  return { id: ix.id, uid: ix.uid, marca: conMarcaCliente(dueno) };
}
const sinCache = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };
async function rutaCliente(request, env, url, segs) {
  const token = segs[1] || "", m = request.method;
  // La página (es la misma para todos; lee el link de la dirección)
  if (segs.length === 2 && m === "GET") {
    const r = await conAsset(env, request, "/disponibilidad"), h = new Headers(r.headers);
    Object.entries(sinCache).forEach(([k, v]) => h.set(k, v));
    return new Response(r.body, { status: TOKEN_CLIENTE.test(token) ? r.status : 404, headers: h });
  }
  const conCabeceras = (res) => { Object.entries(sinCache).forEach(([k, v]) => res.headers.set(k, v)); return res; };
  const l = await linkDeCliente(env, token);
  if (!l) return conCabeceras(json({ error: "Este link ya no está activo. Pídele uno nuevo a quien te lo mandó.", cerrado: true }, 404));
  if (l.apagado) return conCabeceras(json({ error: "Este link está en pausa. Pídele a quien te lo mandó que lo revise.", cerrado: true }, 403));
  if (segs[2] === "datos" && segs.length === 3 && m === "GET") {
    const p = await leerJSON(env, "tours/" + l.id + "/proyecto.json");
    if (!p) return conCabeceras(json({ error: "Este link ya no está activo.", cerrado: true }, 404));
    const t = (p.proyecto && p.proyecto.terminos) || {}, publicado = !!(await env.R2.head("publicado/" + l.id + "/proyecto.json"));
    const estados = (Array.isArray(p.lotesEstados) && p.lotesEstados.length ? p.lotesEstados : [{ id: "disponible", nombre: "Disponible", color: "#22B573" }, { id: "apartado", nombre: "Apartado", color: "#F2A900" }, { id: "vendido", nombre: "Vendido", color: "#E5484D" }])
      .filter((e) => e && e.id).slice(0, 8).map((e) => ({ id: String(e.id).slice(0, 40), nombre: String(e.nombre || e.id).slice(0, 40), color: /^#[0-9a-f]{3,8}$/i.test(e.color || "") ? e.color : "#888888" }));
    return conCabeceras(json({ nombre: String((p.proyecto && p.proyecto.nombre) || "Tour").slice(0, 120), terminos: { lote: String(t.lote || "Lote").slice(0, 30), manzana: String(t.manzana || "Manzana").slice(0, 30) }, estados, lotes: lotesParaCliente(p), tour: publicado ? origenTours(env, url) + "/" + l.id + "/" : "", marca: !!l.marca }));
  }
  if (segs[2] === "estados" && segs.length === 3 && m === "POST") {
    // Solo desde la propia página del link
    const origen = request.headers.get("origin");
    if (origen && origen !== url.origin) return conCabeceras(error(403, "Origen no permitido"));
    const c = await request.json().catch(() => ({}));
    const cambios = (Array.isArray(c.cambios) ? c.cambios : []).slice(0, 20).map((x) => ({ mz: String((x && x.mz) || "").slice(0, 40), num: String((x && x.num) || "").slice(0, 40), estado: String((x && x.estado) || "").slice(0, 40) })).filter((x) => x.num && x.estado);
    if (!cambios.length) return conCabeceras(error(400, "Sin cambios"));
    // Tope por hora para el link (por si alguien lo usa de más)
    const ku = "clientes/uso/" + (await huellaToken(token)) + "-" + new Date().toISOString().slice(0, 13), ou = await env.R2.get(ku), usados = ou ? +(await ou.text()) || 0 : 0;
    if (usados + cambios.length > CAMBIOS_CLIENTE_HORA) return conCabeceras(error(429, "Hiciste muchos cambios seguidos. Espera un rato y vuelve a intentar."));
    await env.R2.put(ku, String(usados + cambios.length));
    const r = await aplicarEstados(env, l.id, cambios, "cliente");
    if (!r) return conCabeceras(json({ error: "Este link ya no está activo.", cerrado: true }, 404));
    if (r.borrador) {
      const kc = "tours/" + l.id + "/cambios-cliente.json", lista = (await leerJSON(env, kc)) || [], ts = new Date().toISOString();
      cambios.forEach((x) => { const k = llaveLote(x.mz, x.num); if (k in r.antes) lista.unshift({ mz: x.mz, num: x.num, estado: x.estado, antes: r.antes[k], ts }); });
      await env.R2.put(kc, JSON.stringify(lista.slice(0, 100)), { httpMetadata: { contentType: "application/json" } });
    }
    return conCabeceras(json({ ok: true, cambiados: r.borrador, enTour: r.enTour, lotes: lotesParaCliente(r.proyecto) }));
  }
  return conCabeceras(error(404, "Ruta desconocida"));
}
async function labDe(env, yo) {
  const cfg = await leerLab(env), correo = String(yo.email || "").toLowerCase(), pl = planDe(yo), pago = !pl.marca, des = pl.id === "desarrollos";
  return Object.keys(cfg).filter((k) => yo.admin || cfg[k].modo === "todos" || (cfg[k].modo === "pago" && pago) || (cfg[k].modo === "desarrollos" && des) || (cfg[k].modo === "probadores" && cfg[k].probadores.includes(correo)));
}

// Novedades: anuncios de herramientas nuevas que cada cuenta ve UNA vez (se anota en su perfil, no en el navegador)
//   novedades/<id>.json  { id, titulo, texto, media, mediaTipo, boton, destino, publico, activa, creada, publicada, vistas }
//   novedades/<id>.media el video o la imagen del anuncio
const MAX_MEDIA_NOV = 25 * 1024 * 1024;
const PUBLICOS_NOV = ["todos", "pagados", "desarrollos", "gratis"];
async function listaNovedades(env) {
  const l = await env.R2.list({ prefix: "novedades/", limit: 1000 });
  const ns = await Promise.all(l.objects.filter((o) => o.key.endsWith(".json")).map(async (o) => (await env.R2.get(o.key)).json().catch(() => null)));
  return ns.filter(Boolean).sort((a, b) => String(b.publicada || b.creada).localeCompare(String(a.publicada || a.creada)));
}
const paraQuien = (n, plan) => n.publico === "pagados" ? plan.id !== "gratis" : n.publico === "desarrollos" ? plan.id === "desarrollos" : n.publico === "gratis" ? plan.id === "gratis" : true;
async function apiNovedades(request, env, partes, yo, plan) {
  const m = request.method, id = partes[2];
  if (partes.length === 2 && m === "GET") {
    const vistas = new Set(yo.novedadesVistas || []);
    const ns = (await listaNovedades(env)).filter((n) => n.activa && n.publicada && paraQuien(n, plan)).slice(0, 10)
      .map((n) => ({ id: n.id, etiqueta: n.etiqueta || "", titulo: n.titulo, texto: n.texto, media: n.media ? "api/novedades/" + n.id + "/media" : "", mediaTipo: n.mediaTipo || "", boton: n.boton, destino: n.destino, publicada: n.publicada, vista: vistas.has(n.id) }));
    return json({ novedades: ns });
  }
  if (!/^[a-z0-9]{6,20}$/.test(id || "")) return error(400, "Novedad inválida");
  if (partes[3] === "media" && m === "GET") {
    // Solo la imagen o el video de un anuncio ya publicado para esta cuenta (los borradores solo los ve el dueño)
    if (!yo.admin) { const o = await env.R2.get("novedades/" + id + ".json"); const n = o ? await o.json().catch(() => null) : null; if (!n || !n.activa || !n.publicada || !paraQuien(n, plan)) return error(404, "No existe"); }
    return servirR2(env, request, "novedades/" + id + ".media", "private, max-age=3600");
  }
  if (partes[3] === "vista" && m === "POST") {
    const clave = "cuentas/" + yo.uid + "/perfil.json", o = await env.R2.get(clave); if (!o) return error(404, "Sin cuenta");
    const p = await o.json(); p.novedadesVistas = [...new Set([id].concat(p.novedadesVistas || []))].slice(0, 100);
    await env.R2.put(clave, JSON.stringify(p), { httpMetadata: { contentType: "application/json" } });
    const no = await env.R2.get("novedades/" + id + ".json");
    if (no) { const n = await no.json(); n.vistas = (+n.vistas || 0) + 1; await env.R2.put("novedades/" + id + ".json", JSON.stringify(n), { httpMetadata: { contentType: "application/json" } }); }
    return json({ ok: true });
  }
  return error(404, "Ruta desconocida");
}

// ---------- Estadísticas de los tours (Laboratorio) ----------
// Cada visita manda UN resumen al salir (sin cookies ni datos personales): cuánto duró, celular o compu, de dónde
// llegó, qué esferas y lotes vio y si le dio a contacto. País y ciudad los pone Cloudflare. Se guarda una pieza por
// visita en stats/<tour>/<día>/<visita>.json: si la misma visita vuelve a mandar (sale y regresa), se reemplaza.
const num = (v, max) => Math.max(0, Math.min(max, Math.round(+v || 0)));
function mapa(o, maxK, maxV) {
  const r = {};
  if (o && typeof o === "object") Object.entries(o).slice(0, maxK).forEach(([k, v]) => { const kk = String(k).slice(0, 60); if (kk) r[kk] = num(v, maxV); });
  return r;
}
async function registrarVisita(request, env, id) {
  const ok = new Response(null, { status: 204, headers: { "access-control-allow-origin": "*" } });
  if (!ID_TOUR.test(id || "")) return ok;
  const txt = await request.text().catch(() => "");
  if (!txt || txt.length > 16000) return ok;
  let d; try { d = JSON.parse(txt); } catch (e) { return ok; }
  if (!/^[a-z0-9]{8,40}$/.test(d.v || "")) return ok;
  const pub = await env.R2.get("publicado/" + id + "/proyecto.json");
  if (!pub) return ok;
  const p = await pub.json().catch(() => null);
  if (!p || !p.proyecto || !p.proyecto.estadisticas) return ok;
  const cf = request.cf || {}, ahora = new Date();
  const reg = {
    v: d.v, t: ahora.toISOString(), dur: num(d.dur, 4 * 3600), disp: ["celular", "tablet", "compu"].includes(d.disp) ? d.disp : "compu",
    ref: String(d.ref || "directo").slice(0, 40), pais: String(cf.country || "").slice(0, 2), ciudad: String(cf.city || "").slice(0, 60),
    esferas: mapa(d.esferas, 60, 4 * 3600), lotes: mapa(d.lotes, 150, 100), contacto: num(d.contacto, 50),
  };
  await env.R2.put("stats/" + id + "/" + ahora.toISOString().slice(0, 10) + "/" + d.v + ".json", JSON.stringify(reg), { httpMetadata: { contentType: "application/json" } });
  return ok;
}
// ---------- Aviso si se cae un tour ----------
// El tour publicado deja una marca mientras está en pantalla y la borra al cerrarse bien. Si la próxima vez
// que se abre en ese celular la marca sigue ahí, el tour se cerró solo (sin memoria, el navegador lo tumbó):
// llega como reporte al Panel de dueño, con el celular, el tour y la esfera. Así nos enteramos antes que el cliente.
const CAIDAS_DIA = 20; // por tour, para que nadie llene los reportes
async function registrarCaida(request, env, id) {
  const ok = new Response(null, { status: 204, headers: { "access-control-allow-origin": "*" } });
  if (!ID_TOUR.test(id || "")) return ok;
  const txt = await request.text().catch(() => "");
  if (!txt || txt.length > 8000) return ok;
  let d; try { d = JSON.parse(txt); } catch (e) { return ok; }
  if (!d || typeof d !== "object") return ok;
  // Una caída de verdad se reabre sola en segundos. Más de 30 s (o una versión vieja del tour, que no lo dice)
  // casi siempre es cerrar Safari desde el multitarea y abrirlo otra vez: falsa alarma (MAMAP, nov 2026)
  const hueco = Number(d.hueco);
  if (!(hueco >= 0 && hueco <= 30)) return ok;
  // Y la página se recargó sola (así hace Safari al caerse). Abierta otra vez con su link no es caída (Senderos del Rejón)
  if (d.nav !== "reload") return ok;
  const pub = await env.R2.get("publicado/" + id + "/proyecto.json");
  if (!pub) return ok;
  const p = await pub.json().catch(() => null);
  const hoy = new Date().toISOString().slice(0, 10), clave = "caidas/" + id + "/" + hoy;
  const n = +((await (await env.R2.get(clave))?.text()) || 0);
  if (n >= CAIDAS_DIA) return ok;
  await env.R2.put(clave, String(n + 1));
  const corto = (v, k) => String(v == null ? "" : v).slice(0, k);
  const cf = request.cf || {}, disp = ["celular", "tablet", "compu"].includes(d.disp) ? d.disp : "compu";
  const esfera = corto(d.esferaNombre || d.esfera || "—", 80), lotes = num(d.lotes, 5000), dur = num(d.dur, 24 * 3600);
  const veces = Math.max(1, num(d.veces, 50));
  const tiempo = dur < 90 ? Math.round(dur) + " s" : Math.round(dur / 60) + " min";
  const rid = hoy.replace(/-/g, "") + "-" + Date.now().toString(36) + crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  const nombreTour = corto((p && p.proyecto && p.proyecto.nombre) || id, 80);
  const rep = {
    id: rid, fecha: new Date().toISOString(), estado: "nuevo", tipo: "caida", uid: "", email: env.ADMIN || "", nombre: "Se cerró un tour solo", plan: "aviso automático",
    texto: "El tour «" + nombreTour + "» se cerró solo en un " + disp + " (" + corto(d.modelo || "", 60) + ") en la esfera «" + esfera + "», con " + lotes + (lotes === 1 ? " lote" : " lotes") +
      " y " + num(d.capas, 5000) + " capas en total. " + (dur < 10 ? "Se cerró en los primeros segundos" : "Llevaba " + tiempo + " abierto") + (veces > 1 ? " y ya es la vez " + veces + " seguida en ese celular" : "") + ". Se volvió a abrir a los " + Math.round(hueco) + " s." + (cf.country ? " País: " + corto(cf.country, 2) + "." : ""),
    contexto: { tour: id, seccion: "tour publicado · " + esfera, navegador: corto(d.ua, 300), pantalla: corto(d.pantalla, 40), errores: (Array.isArray(d.errores) ? d.errores : []).slice(-5).map((e) => corto(e, 300)) },
    imagen: false,
    caida: { esfera: corto(d.esfera, 80), lotes, capas: num(d.capas, 5000), dur, veces, memoria: num(d.memoria, 64), calidad: corto(d.calidad, 20), cambios: num(d.cambios, 10000), hueco: Math.round(hueco), nav: corto(d.nav, 20) },
  };
  await env.R2.put("reportes/" + rid + ".json", JSON.stringify(rep), { httpMetadata: { contentType: "application/json" } });
  await avisarPorCorreo(env, rep, new URL(request.url));
  return ok;
}
async function resumenVisitas(env, id, dias, tope = 5000) {
  const desde = new Date(Date.now() - (dias - 1) * 864e5).toISOString().slice(0, 10), claves = [];
  let cursor;
  do {
    const l = await env.R2.list({ prefix: "stats/" + id + "/", cursor, limit: 1000 });
    l.objects.forEach((o) => { if (o.key.split("/")[2] >= desde) claves.push(o.key); });
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor && claves.length < 20000);
  // Leer cada visita cuesta: con muchas se lee una muestra pareja (el Panel de dueño pide hasta 600)
  const paso = Math.max(1, Math.ceil(claves.length / tope)), leer = claves.filter((_, i) => i % paso === 0);
  const regs = [];
  for (let i = 0; i < leer.length; i += 50) regs.push(...(await Promise.all(leer.slice(i, i + 50).map(async (k) => (await env.R2.get(k))?.json().catch(() => null)))).filter(Boolean));
  const suma = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  const r = { dias, total: paso > 1 ? claves.length : regs.length, muestra: regs.length, porDia: {}, disp: {}, origen: {}, ciudades: {}, esferas: {}, esferasVisitas: {}, lotes: {}, contacto: 0, conContacto: 0, durTotal: 0 };
  if (paso > 1) claves.forEach((k) => suma(r.porDia, k.split("/")[2]));
  regs.forEach((x) => {
    if (paso === 1) suma(r.porDia, x.t.slice(0, 10)); suma(r.disp, x.disp); suma(r.origen, x.ref);
    suma(r.ciudades, (x.ciudad ? x.ciudad + ", " : "") + (x.pais || "—"));
    Object.entries(x.esferas || {}).forEach(([k, s]) => { suma(r.esferas, k, s); suma(r.esferasVisitas, k); });
    Object.entries(x.lotes || {}).forEach(([k, n]) => suma(r.lotes, k, n));
    r.contacto += x.contacto || 0; if (x.contacto) r.conContacto++; r.durTotal += x.dur || 0;
  });
  return r;
}

// ---------- Estadísticas de todos los tours (Panel de dueño) ----------
// Pedido de Amar (16 nov 2026): las métricas de los tours publicados de los usuarios, en su panel. Las visitas se
// cuentan con la lista de piezas de stats/ (exacto y barato). Celular o compu, tiempo, contacto, países, ciudades y
// de dónde llegan salen de una muestra pareja de hasta 300 visitas (leer cada una cuesta). Lo de un tour, aparte.
const MUESTRA_STATS = 300;
async function estadisticasAdmin(env, dias) {
  const dia = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10), desde = dia(dias - 1), semana = dia(6);
  // Tours (dueño, nombre, si está publicado) y planes de las cuentas
  const deTour = {}, perfiles = [];
  let cur;
  do {
    const l = await env.R2.list({ prefix: "cuentas/", cursor: cur, limit: 1000, include: ["customMetadata"] });
    for (const o of l.objects) {
      if (o.key.endsWith("/perfil.json")) { perfiles.push(o.key); continue; }
      const t = o.key.match(/^cuentas\/([^/]+)\/tours\/([^/]+)$/), md = o.customMetadata || {};
      if (t) deTour[t[2]] = { uid: t[1], nombre: md.nombre || "Tour", publicado: md.publicado || "" };
    }
    cur = l.truncated ? l.cursor : undefined;
  } while (cur);
  const cuentas = {};
  for (let i = 0; i < perfiles.length; i += 50) (await Promise.all(perfiles.slice(i, i + 50).map((k) => env.R2.get(k).then((o) => (o ? o.json() : null)).catch(() => null)))).forEach((p) => { if (p && p.uid) cuentas[p.uid] = p; });
  const planDeTour = (id) => { const c = deTour[id] && cuentas[deTour[id].uid]; return !c ? "gratis" : c.admin ? "dueno" : PLANES[c.plan] ? c.plan : "gratis"; };
  // Visitas: una pieza por visita en stats/<tour>/<día>/<visita>.json
  const porTour = {}, porDia = {}, deUsuarios = [];
  cur = undefined;
  do {
    const l = await env.R2.list({ prefix: "stats/", cursor: cur, limit: 1000 });
    for (const o of l.objects) {
      const [, id, d] = o.key.split("/");
      if (!id || !d || d < desde) continue;
      const t = porTour[id] || (porTour[id] = { visitas: 0, semana: 0, ultima: "" });
      t.visitas++; if (d >= semana) t.semana++; if (d > t.ultima) t.ultima = d;
      if (planDeTour(id) !== "dueno") { porDia[d] = (porDia[d] || 0) + 1; deUsuarios.push(o.key); }
    }
    cur = l.truncated ? l.cursor : undefined;
  } while (cur);
  const porPlan = { desarrollos: { tours: 0, visitas: 0, publicados: 0 }, pro: { tours: 0, visitas: 0, publicados: 0 }, gratis: { tours: 0, visitas: 0, publicados: 0 }, dueno: { tours: 0, visitas: 0, publicados: 0 } };
  Object.entries(deTour).forEach(([id, t]) => { if (t.publicado) porPlan[planDeTour(id)].publicados++; });
  Object.entries(porTour).forEach(([id, t]) => { const g = porPlan[planDeTour(id)]; g.tours++; g.visitas += t.visitas; });
  // Muestra pareja de las visitas de los usuarios
  const paso = Math.max(1, Math.ceil(deUsuarios.length / MUESTRA_STATS)), leer = deUsuarios.filter((_, i) => i % paso === 0), regs = [];
  for (let i = 0; i < leer.length; i += 50) regs.push(...(await Promise.all(leer.slice(i, i + 50).map((k) => env.R2.get(k).then((o) => (o ? o.json() : null)).catch(() => null)))).filter(Boolean));
  const suma = (o, k) => { if (k) o[k] = (o[k] || 0) + 1; };
  const m = { n: regs.length, disp: {}, paises: {}, ciudades: {}, origen: {}, conContacto: 0, durProm: 0, durMediana: 0 };
  const durs = regs.map((x) => +x.dur || 0).sort((a, b) => a - b);
  regs.forEach((x) => { suma(m.disp, x.disp); suma(m.paises, x.pais || "—"); suma(m.ciudades, x.ciudad ? x.ciudad + ", " + (x.pais || "") : ""); suma(m.origen, x.ref || "directo"); if (x.contacto) m.conContacto++; });
  if (durs.length) { m.durProm = Math.round(durs.reduce((a, b) => a + b, 0) / durs.length); m.durMediana = durs[Math.floor(durs.length / 2)]; }
  const tours = Object.entries(porTour).map(([id, t]) => ({ id, nombre: (deTour[id] || {}).nombre || id, plan: planDeTour(id), dueno: ((cuentas[(deTour[id] || {}).uid] || {}).email) || "", visitas: t.visitas, semana: t.semana, ultima: t.ultima }))
    .sort((a, b) => b.visitas - a.visitas).slice(0, 100);
  const usuarios = ["desarrollos", "pro", "gratis"].reduce((a, k) => ({ visitas: a.visitas + porPlan[k].visitas, tours: a.tours + porPlan[k].tours, publicados: a.publicados + porPlan[k].publicados }), { visitas: 0, tours: 0, publicados: 0 });
  return { dias, desde, generado: new Date().toISOString(), usuarios, porPlan, porDia, muestra: m, tours };
}
// Quién recibe una novedad por correo: cuentas con correo, sin pausar, que no se dieron de baja y del público de la novedad
async function destinatarios(env, n) {
  const claves = [];
  let cur;
  do {
    const l = await env.R2.list({ prefix: "cuentas/", cursor: cur, limit: 1000 });
    l.objects.forEach((o) => { if (o.key.endsWith("/perfil.json")) claves.push(o.key); });
    cur = l.truncated ? l.cursor : undefined;
  } while (cur);
  const ps = [];
  for (let i = 0; i < claves.length; i += 50) ps.push(...(await Promise.all(claves.slice(i, i + 50).map((k) => env.R2.get(k).then((o) => (o ? o.json() : null)).catch(() => null)))));
  return ps.filter((p) => p && p.uid && /@/.test(p.email || "") && !p.bloqueado && !p.noNovedades && paraQuien(n, planDe(p)));
}
// Link de baja firmado: con cuenta (uid) o solo el correo (contactos de una lista)
const firmaBaja = (env) => (x) => firmarLink(env, typeof x === "string" ? { baja: x } : x);
// Todas las cuentas (perfil.json), leídas de 50 en 50
async function todasLasCuentas(env) {
  const claves = [];
  let cur;
  do {
    const l = await env.R2.list({ prefix: "cuentas/", cursor: cur, limit: 1000 });
    l.objects.forEach((o) => { if (o.key.endsWith("/perfil.json")) claves.push(o.key); });
    cur = l.truncated ? l.cursor : undefined;
  } while (cur);
  const ps = [];
  for (let i = 0; i < claves.length; i += 50) ps.push(...(await Promise.all(claves.slice(i, i + 50).map((k) => env.R2.get(k).then((o) => (o ? o.json() : null)).catch(() => null)))));
  return ps.filter((p) => p && p.uid);
}
const CORREO_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
// Campañas con descuento: a una lista de correos y (si se quiere) a los usuarios con cuenta de prueba.
// A quien ya pagó no se le manda. Se prepara (borrador), se prueba con el dueño y se manda con su clic.
async function apiCampanas(request, env, partes, yo) {
  const m = request.method, base = new URL(request.url).origin;
  const resumen = (k) => ({ id: k.id, nombre: k.nombre, pct: k.pct, vence: k.vence, creada: k.creada, estado: k.estado, cuenta: k.cuenta, envio: k.envio || null });
  if (partes.length === 3 && m === "GET") {
    const l = await env.R2.list({ prefix: "correos/campanas/", limit: 200 });
    const ks = (await Promise.all(l.objects.map((o) => env.R2.get(o.key).then((x) => (x ? x.json() : null)).catch(() => null)))).filter(Boolean);
    ks.sort((a, b) => String(b.creada).localeCompare(String(a.creada)));
    return json({ campanas: ks.map(resumen) });
  }
  if (partes.length === 3 && m === "POST") {
    const c = await request.json().catch(() => ({}));
    const pct = Math.round(+c.pct || 30), vence = /^\d{4}-\d{2}-\d{2}$/.test(c.vence || "") ? new Date(c.vence + "T23:59:59-06:00").toISOString() : null;
    if (!(pct >= 1 && pct <= 90)) return error(400, "El descuento va de 1 % a 90 %");
    const lista = [...new Set((String(c.correos || "").match(CORREO_RE) || []).map((e) => e.toLowerCase()))].slice(0, 5000);
    const cuentas = await todasLasCuentas(env), porCorreo = new Map(cuentas.filter((p) => p.email).map((p) => [p.email.toLowerCase(), p]));
    const pagado = (p) => planDe(p).id !== "gratis", mio = String(yo.email || "").toLowerCase();
    const destinos = [], vistos = new Set(), cuenta = { lista: 0, usuarios: 0, yaPagaron: 0 };
    const agregar = (e, p) => {
      if (vistos.has(e) || e === mio) return; vistos.add(e);
      if (p && (p.admin || p.bloqueado)) return;
      if (p && pagado(p)) { cuenta.yaPagaron++; return; }
      destinos.push(p ? { e, u: p.uid } : { e }); p ? cuenta.usuarios++ : cuenta.lista++;
    };
    if (c.usuarios !== false) cuentas.filter((p) => p.email && !p.noNovedades).forEach((p) => agregar(p.email.toLowerCase(), p));
    lista.forEach((e) => agregar(e, porCorreo.get(e)));
    if (!destinos.length) return error(400, "No hay a quién mandarle: pega al menos un correo");
    const id = Date.now().toString(36);
    const k = { id, nombre: String(c.nombre || "Beta " + pct + " %").slice(0, 60), pct, planes: ["pro", "desarrollos"], vence, creada: new Date().toISOString(), estado: "borrador", cuenta: Object.assign(cuenta, { total: destinos.length }), destinos };
    await env.R2.put(CAMPANA(id), JSON.stringify(k), { httpMetadata: { contentType: "application/json" } });
    return json({ campana: resumen(k) }, 201);
  }
  const id = partes[3];
  if (!/^[a-z0-9]{4,20}$/.test(id || "")) return error(400, "Campaña inválida");
  const o = await env.R2.get(CAMPANA(id));
  if (!o) return error(404, "No existe");
  const k = await o.json();
  if (partes[4] === "prueba" && m === "POST") {
    const cm = correoCampana({ nombre: yo.nombre, base, link: base + "/entrar?cupon=AL-EJEMPLO", pct: k.pct, vence: k.vence, baja: enlaceBaja(base, await firmaBaja(env)(yo.uid)) });
    const cuenta = await contador(env);
    const r = await enviar(env, cuenta, { para: yo.email, asunto: "[Prueba] " + cm.asunto, html: cm.html, texto: cm.texto });
    await cuenta.guardar();
    return r === "ok" ? json({ ok: true, para: yo.email }) : error(r === "tope" ? 429 : 502, r === "tope" ? "Llegaste al tope de correos de hoy" : "No se pudo mandar (" + r.slice(6) + ")");
  }
  if (partes[4] === "enviar" && m === "POST") {
    if (k.estado !== "borrador") return error(409, "Esta campaña ya se mandó");
    if (!env.ENVIOS) return error(503, "El envío de correos no está activo");
    await iniciarCampana(env, k);
    await avanzarCola(env, "c" + id, base, firmaBaja(env));
    const k2 = await (await env.R2.get(CAMPANA(id))).json();
    return json({ campana: resumen(k2) });
  }
  if (partes.length === 4 && m === "DELETE") {
    if (k.estado !== "borrador") return error(409, "Ya se mandó: no se puede borrar");
    await env.R2.delete(CAMPANA(id));
    return json({ ok: true });
  }
  return error(405, "Método no permitido");
}

// ---------- Tours hechos con Mozari (galería del sitio) ----------
// config/galeria.json: { tours: [{ id, titulo, lugar }] }, en el orden en que salen. Los elige el dueño desde su
// panel (solo tours con permiso de su cliente). La página pública lee /galeria.json: solo los que siguen publicados
// y no están en pausa ni en modo privado, con su portada y el link de tours.mozari.app.
const GALERIA = "config/galeria.json";
const leerGaleria = async (env) => { const o = await env.R2.get(GALERIA); const g = o ? await o.json().catch(() => ({})) : {}; return Array.isArray(g && g.tours) ? g.tours : []; };
const origenTours = (env, url) => url.hostname === "localhost" ? "http://localhost:8788" : env.DOMINIO ? "https://tours." + env.DOMINIO : url.origin.replace("mozari-estudio", "mozari-tours");
const portadaDe = (base, pr, inicial) => (typeof pr.thumbnail === "string" && rutaValida(pr.thumbnail) ? base + pr.thumbnail : /^[A-Za-z0-9_-]{1,80}$/.test(inicial || "") ? base + "escenas/" + inicial + "/1/f/0/0.jpg" : "");
async function galeriaPublica(request, env, ctx) {
  const url = new URL(request.url), cache = caches.default, clave = new Request(url.origin + "/galeria.json");
  const ya = await cache.match(clave).catch(() => null);
  if (ya) return ya;
  const host = origenTours(env, url), tours = [];
  for (const t of (await leerGaleria(env)).slice(0, 24)) {
    const [pub, pausa, priv] = await Promise.all([env.R2.get("publicado/" + t.id + "/proyecto.json"), env.R2.head("pausados/" + t.id), env.R2.head("privados/" + t.id)]);
    if (!pub || pausa || priv) continue;
    const p = await pub.json().catch(() => null), pr = (p && p.proyecto) || {}, base = host + "/" + t.id + "/";
    tours.push({ id: t.id, titulo: t.titulo || pr.nombre || "Tour 360", lugar: t.lugar || "", portada: portadaDe(base, pr, pr.escenaInicial), url: base });
  }
  const r = json({ tours }, 200, { "cache-control": "public, max-age=300" });
  if (ctx) ctx.waitUntil(cache.put(clave, r.clone()).catch(() => {}));
  return r;
}
async function apiGaleria(request, env, partes) {
  const m = request.method, url = new URL(request.url), host = origenTours(env, url);
  if (m === "GET") {
    // Todos los tours publicados (de todas las cuentas) para elegir
    const [cuentas, elegidos] = await Promise.all([todasLasCuentas(env), leerGaleria(env)]);
    const correo = new Map(cuentas.map((p) => [p.uid, p.email || ""])), publicados = [];
    // Plan de quien lo publicó, para separarlos en el panel (Desarrollos, Pro, cuenta de prueba o del dueño)
    const planPub = new Map(cuentas.map((p) => [p.uid, p.admin ? "dueno" : PLANES[p.plan] ? p.plan : "gratis"]));
    let cur;
    do {
      const l = await env.R2.list({ prefix: "cuentas/", cursor: cur, limit: 1000, include: ["customMetadata"] });
      for (const o of l.objects) {
        const t = o.key.match(/^cuentas\/([^/]+)\/tours\/([^/]+)$/), md = o.customMetadata || {};
        if (!t || !md.publicado) continue;
        publicados.push({ id: t[2], nombre: md.nombre || "Tour", dueno: correo.get(t[1]) || "", plan: planPub.get(t[1]) || "gratis", publicado: md.publicado, portada: portadaDe(host + "/" + t[2] + "/", { thumbnail: md.portada }, md.inicial), url: host + "/" + t[2] + "/" });
      }
      cur = l.truncated ? l.cursor : undefined;
    } while (cur);
    publicados.sort((a, b) => String(b.publicado).localeCompare(String(a.publicado)));
    return json({ elegidos, publicados });
  }
  if (m === "PUT") {
    const c = await request.json().catch(() => ({})), lista = Array.isArray(c.tours) ? c.tours.slice(0, 24) : null;
    if (!lista) return error(400, "Lista inválida");
    const limpios = [];
    for (const t of lista) {
      if (!t || !ID_TOUR.test(String(t.id || "")) || limpios.some((x) => x.id === t.id)) continue;
      if (!(await env.R2.head("publicado/" + t.id + "/proyecto.json"))) return error(400, "Ese tour no está publicado");
      limpios.push({ id: t.id, titulo: String(t.titulo || "").slice(0, 60), lugar: String(t.lugar || "").slice(0, 60) });
    }
    await env.R2.put(GALERIA, JSON.stringify({ tours: limpios }), { httpMetadata: { contentType: "application/json" } });
    await caches.default.delete(new Request(url.origin + "/galeria.json")).catch(() => {});
    return json({ elegidos: limpios });
  }
  return error(405, "Método no permitido");
}

// ---------- Ventas para Google Sheets ----------
// /ventas.csv?k=<clave>: los pagos de todas las cuentas, para que la hoja «Ventas de Mozari» los lea sola
// (IMPORTDATA, cada hora). Sin correos: nombre del cliente y un ID corto. La clave vive en config/ventas-clave
// y solo la ve el dueño (Panel → api/admin/ventas-link). Sin la clave correcta, no existe.
const CLAVE_VENTAS = "config/ventas-clave";
const PLAN_TXT = { pro: "Pro", desarrollos: "Desarrollos", espacio: "Espacio" }, METODO_TXT = { mercadopago: "Mercado Pago", paypal: "PayPal", stripe: "Stripe", cupon: "Cupón" };
async function ventasCsv(request, env) {
  const url = new URL(request.url), o = await env.R2.get(CLAVE_VENTAS), clave = o ? await o.text() : "";
  if (!clave || url.searchParams.get("k") !== clave) return new Response("No existe", { status: 404 });
  const campo = (v) => { const t = String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim(); return /[",]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const idCorto = async (uid) => { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mz-" + uid)); return [...new Uint8Array(b)].slice(0, 4).map((x) => x.toString(16).padStart(2, "0")).join(""); };
  const filas = [];
  for (const p of await todasLasCuentas(env)) {
    const pagos = Array.isArray(p.pagos) ? p.pagos : p.ultimoPago ? [Object.assign({ moneda: "MXN", metodo: "mercadopago" }, p.ultimoPago)] : [];
    if (!pagos.length) continue;
    const id = await idCorto(p.uid), nombre = String(p.nombre || "").includes("@") ? "" : p.nombre || "";
    pagos.forEach((x) => filas.push([String(x.fecha || "").slice(0, 10), nombre, id, PLAN_TXT[x.plan] || "Sin plan", METODO_TXT[x.metodo] || x.metodo || "", x.moneda || "MXN", +x.monto || 0, x.cupon || ""]));
  }
  filas.sort((a, b) => a[0].localeCompare(b[0]));
  const csv = [["Fecha", "Cliente", "ID cliente", "Plan", "Método", "Moneda", "Monto"]].concat(filas.map((f) => f.slice(0, 7))).map((f) => f.map(campo).join(",")).join("\n");
  return new Response(csv + "\n", { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
}

async function admin(request, env, partes, yo) {
  const m = request.method;
  if (partes[2] === "galeria" && partes.length === 3) return apiGaleria(request, env, partes);
  // Estadísticas: todos los tours (resumen) y el detalle de uno
  if (partes[2] === "estadisticas" && m === "GET") {
    const dias = Math.max(1, Math.min(90, +new URL(request.url).searchParams.get("dias") || 30));
    if (partes.length === 3) return json(await estadisticasAdmin(env, dias));
    if (partes.length === 4 && ID_TOUR.test(partes[3])) return json(await resumenVisitas(env, partes[3], dias, 600));
  }
  if (partes[2] === "ventas-link" && partes.length === 3 && m === "GET") {
    let o = await env.R2.get(CLAVE_VENTAS), clave = o ? await o.text() : "";
    if (!clave) { clave = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join(""); await env.R2.put(CLAVE_VENTAS, clave); }
    return json({ url: new URL(request.url).origin + "/ventas.csv?k=" + clave });
  }
  if (partes[2] === "campanas") return apiCampanas(request, env, partes, yo);
  // Correos a los usuarios: la bienvenida (prender o apagar), cuántos van este mes y una prueba al dueño
  if (partes[2] === "correos") {
    if (partes.length === 3 && m === "GET") {
      const [conf, cuenta] = await Promise.all([leerConf(env), contador(env)]);
      return json({ conf, activo: !!env.ENVIOS, mes: cuenta.mes, dia: cuenta.dia, topeMes: TOPE_MES, topeDia: TOPE_DIA });
    }
    if (partes.length === 3 && m === "PUT") {
      const c = await request.json().catch(() => ({})), conf = await leerConf(env);
      if (typeof c.bienvenida === "boolean") conf.bienvenida = c.bienvenida;
      let sembrados = 0;
      if (typeof c.recordatorio === "boolean") {
        if (c.recordatorio && !conf.recordatorio) sembrados = await sembrarRecordatorios(env).catch(() => 0);
        conf.recordatorio = c.recordatorio;
      }
      await guardarConf(env, conf);
      return json({ conf, sembrados });
    }
    // Mandar ya los recordatorios pendientes (en local, las pruebas no esperan 22 horas)
    if (partes[3] === "recordatorios" && partes.length === 4 && m === "POST") {
      const c = await request.json().catch(() => ({})), horas = env.DEV === "1" && Number.isFinite(+c.horas) ? +c.horas : 22;
      return json({ mandados: await mandarRecordatorios(env, new URL(request.url).origin, firmaBaja(env), horas) });
    }
    if (partes[3] === "prueba" && partes.length === 4 && m === "POST") {
      const c = await request.json().catch(() => ({})), base = new URL(request.url).origin;
      let correo, baja = "";
      if (c.novedad) {
        const o = /^[a-z0-9]{6,20}$/.test(c.novedad) ? await env.R2.get("novedades/" + c.novedad + ".json") : null;
        if (!o) return error(404, "No existe esa actualización");
        baja = enlaceBaja(base, await firmaBaja(env)(yo.uid));
        correo = correoDeNovedad(await o.json(), yo, base, baja);
      } else if (["pro", "desarrollos", "espacio"].includes(c.compra)) correo = correoCompra({ nombre: yo.nombre, base, plan: c.compra });
      else if (c.recordatorio) correo = correoCompu({ nombre: yo.nombre, base, baja: enlaceBaja(base, await firmaBaja(env)(yo.uid)) });
      else correo = correoBienvenida({ nombre: yo.nombre, base });
      const cuenta = await contador(env);
      const r = await enviar(env, cuenta, { para: yo.email, asunto: "[Prueba] " + correo.asunto, html: correo.html, texto: correo.texto, baja });
      await cuenta.guardar();
      if (r === "ok") return json({ ok: true, para: yo.email });
      return error(r === "tope" ? 429 : 502, r === "tope" ? "Llegaste al tope de correos de hoy. Mañana sigue." : "No se pudo mandar (" + r.slice(6) + ")");
    }
    return error(405, "Método no permitido");
  }
  if (partes[2] === "novedades") {
    if (partes.length === 3 && m === "GET") return json({ novedades: await listaNovedades(env) });
    if (partes.length === 3 && m === "POST") {
      const id = Date.now().toString(36) + crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 4);
      const n = { id, titulo: "Novedad", texto: "", media: false, mediaTipo: "", boton: "Probar ahora", destino: "", publico: "todos", activa: false, creada: new Date().toISOString(), publicada: "", vistas: 0 };
      await env.R2.put("novedades/" + id + ".json", JSON.stringify(n), { httpMetadata: { contentType: "application/json" } });
      return json({ novedad: n }, 201);
    }
    const id = partes[3];
    if (!/^[a-z0-9]{6,20}$/.test(id || "")) return error(400, "Novedad inválida");
    const clave = "novedades/" + id + ".json", o = await env.R2.get(clave);
    if (!o) return error(404, "No existe");
    const n = await o.json();
    if (partes.length === 4 && m === "PUT") {
      const c = await request.json().catch(() => ({}));
      if (typeof c.titulo === "string") n.titulo = c.titulo.slice(0, 90);
      if (typeof c.texto === "string") n.texto = c.texto.slice(0, 700);
      if (typeof c.boton === "string") n.boton = c.boton.slice(0, 30);
      if (typeof c.etiqueta === "string") n.etiqueta = c.etiqueta.slice(0, 30);
      if (typeof c.destino === "string") n.destino = c.destino.slice(0, 200);
      if (PUBLICOS_NOV.includes(c.publico)) n.publico = c.publico;
      if (typeof c.activa === "boolean") { n.activa = c.activa; if (c.activa && !n.publicada) n.publicada = new Date().toISOString(); }
      await env.R2.put(clave, JSON.stringify(n), { httpMetadata: { contentType: "application/json" } });
      return json({ novedad: n });
    }
    if (partes.length === 4 && m === "DELETE") { await env.R2.delete([clave, "novedades/" + id + ".media"]); return json({ ok: true }); }
    if (partes[4] === "media" && m === "PUT") {
      const tipo = (request.headers.get("content-type") || "").split(";")[0], largo = +request.headers.get("content-length") || 0;
      if (!/^(image\/(png|jpeg|gif|webp)|video\/mp4)$/.test(tipo)) return error(415, "Usa un video MP4 o una imagen (GIF, PNG, JPG o WebP)");
      if (!largo || largo > MAX_MEDIA_NOV) return error(413, "El archivo pesa más de 25 MB");
      await env.R2.put("novedades/" + id + ".media", request.body, { httpMetadata: { contentType: tipo } });
      n.media = true; n.mediaTipo = tipo.startsWith("video") ? "video" : "imagen"; n.mediaV = Date.now().toString(36);
      await env.R2.put(clave, JSON.stringify(n), { httpMetadata: { contentType: "application/json" } });
      return json({ novedad: n });
    }
    if (partes[4] === "media" && m === "GET") return servirR2(env, request, "novedades/" + id + ".media", "private, max-age=60");
    // Mandarla también por correo (una sola vez): a quien la quiere recibir, por tandas y sin pasar los topes
    if (partes[4] === "correo" && partes.length === 5 && m === "GET") return json({ cuantos: (await destinatarios(env, n)).length, correo: n.correo || null });
    if (partes[4] === "correo" && partes.length === 5 && m === "POST") {
      if (!n.activa || !n.publicada) return error(400, "Primero publícala");
      if (n.correo) return error(409, "Esta actualización ya se mandó por correo");
      if (!env.ENVIOS) return error(503, "El envío de correos no está activo");
      const uids = (await destinatarios(env, n)).map((p) => p.uid);
      await iniciarCola(env, n, uids);
      const c = await avanzarCola(env, id, new URL(request.url).origin, firmaBaja(env));
      return json({ correo: { total: c.total, enviados: c.enviados, fallas: c.fallas, faltan: c.pendientes.length, inicio: c.inicio, fin: c.fin } });
    }
    return error(405, "Método no permitido");
  }
  if (partes[2] === "respaldos") return apiRespaldos(request, env, partes);
  // Anuncios y campañas: los correos que se dejaron desde el celular, con su origen (las cuentas ya traen el suyo)
  // Con ?correos=1: la lista de los correos más recientes (dirección, fecha, anuncio y si ya creó su cuenta)
  if (partes[2] === "origenes" && partes.length === 3 && m === "GET") return new URL(request.url).searchParams.get("correos") ? json({ correos: await listaProspectos(env, true) }) : json({ prospectos: await listaProspectos(env) });
  // Cupo de cuentas y lista de espera (quien llegó con el cupo lleno)
  if (partes[2] === "cupo" && partes.length === 3) {
    if (m === "PUT") {
      const c = await request.json().catch(() => ({})), cupo = Math.floor(+c.cupo);
      if (!Number.isFinite(cupo) || cupo < 0 || cupo > 1000000) return error(400, "Cupo inválido");
      await env.R2.put("config/cupo.json", JSON.stringify({ cupo, cambiado: new Date().toISOString() }), { httpMetadata: { contentType: "application/json" } });
      return json({ ok: true, cupo });
    }
    if (m !== "GET") return error(405, "Método no permitido");
    const claves = []; let cur;
    do { const l = await env.R2.list({ prefix: "lista-espera/", cursor: cur, limit: 1000 }); l.objects.forEach((o) => claves.push(o.key)); cur = l.truncated ? l.cursor : undefined; } while (cur && claves.length < 5000);
    const espera = (await Promise.all(claves.slice(0, 1000).map(async (k) => (await env.R2.get(k))?.json().catch(() => null)))).filter(Boolean).sort((x, y) => String(x.fecha).localeCompare(String(y.fecha)));
    return json({ cupo: await leerCupo(env), cuentas: await contarCuentas(env), espera, enEspera: claves.length });
  }
  // Soporte: el dueño puede leer (solo leer) el proyecto de cualquier tour para revisar un reporte
  if (partes[2] === "tours" && partes.length === 4 && request.method === "GET") {
    if (!ID_TOUR.test(partes[3])) return error(400, "Tour inválido");
    return servirR2(env, request, "tours/" + partes[3] + "/proyecto.json", "no-store");
  }
  if (partes[2] === "laboratorio") {
    if (partes.length === 3 && m === "GET") {
      const cfg = await leerLab(env);
      const llave = (await confMapa(env)).esri; // la llave del mapa satelital (Ubicación): al panel solo va si existe y cómo termina
      return json({ funciones: Object.entries(LABORATORIO).map(([clave, f]) => Object.assign({ clave }, f, cfg[clave])), mapa: { hay: !!llave, fin: llave ? llave.slice(-4) : "" } });
    }
    if (partes.length === 4 && m === "PUT" && LABORATORIO[partes[3]]) {
      const cuerpo = await request.json().catch(() => ({}));
      // Se guarda la configuración que rige hoy (con lo ya lanzado), así ninguna otra función cambia sola
      const c = Object.assign(await leerLab(env), { _v: 2 });
      const antes = c[partes[3]] || {};
      c[partes[3]] = {
        modo: MODOS_LAB.includes(cuerpo.modo) ? cuerpo.modo : antes.modo || "yo",
        probadores: Array.isArray(cuerpo.probadores) ? [...new Set(cuerpo.probadores.map((x) => String(x).trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))].slice(0, 200) : antes.probadores || [],
      };
      await env.R2.put("config/laboratorio.json", JSON.stringify(c), { httpMetadata: { contentType: "application/json" } });
      return json({ ok: true, funcion: c[partes[3]] });
    }
  }
  // Voces con guion: qué voces y qué modelo se ofrecen, y cómo va el mes
  if (partes[2] === "voz") return adminVoz(request, env, partes);
  // Mapa satelital de «Ubicación»: el dueño pega la llave de su proveedor (vacía = quitarla). El estilo es opcional.
  if (partes[2] === "mapa" && partes.length === 3 && m === "PUT") {
    const c = await request.json().catch(() => ({})), antes = await confMapa(env);
    const esri = typeof c.esri === "string" ? c.esri.trim() : antes.esri, estilo = typeof c.estilo === "string" ? c.estilo.trim() : antes.estilo;
    if ((esri && !LLAVE_MAPA.test(esri)) || !ESTILO_MAPA.test(estilo)) return error(400, "Esa llave no parece válida. Cópiala completa y vuelve a pegarla.");
    await env.R2.put("config/mapa.json", JSON.stringify({ esri, estilo }), { httpMetadata: { contentType: "application/json" } });
    olvidarSat();
    return json({ ok: true, hay: !!esri, estilo });
  }
  if (partes[2] === "cotizacion-tarifas" && partes.length === 3) {
    if (m === "GET") return json({ tarifas: await tarifasCot(env), predeterminadas: TARIFAS_DEF });
    if (m === "PUT") {
      const c = await request.json().catch(() => ({})), t = await tarifasCot(env);
      Object.keys(TARIFAS_DEF).forEach((k) => { if (!(k in c)) return; if (k === "whatsapp") { const w = String(c.whatsapp).replace(/\D/g, ""); if (/^\d{10,15}$/.test(w)) t.whatsapp = w; } else if (Number.isFinite(+c[k]) && +c[k] >= 0 && +c[k] <= 10000000) t[k] = +c[k]; });
      if (t.maximo < t.minimo) return error(400, "El máximo no puede ser menor que el mínimo");
      if (t.anticipo > 100) return error(400, "El anticipo es un porcentaje (0 a 100)");
      await env.R2.put(TARIFAS_COT, JSON.stringify(t), { httpMetadata: { contentType: "application/json" } });
      return json({ tarifas: await tarifasCot(env) });
    }
    return error(405, "Método no permitido");
  }
  if (partes[2] === "cotizaciones") {
    if (partes.length === 3 && m === "GET") {
      const out = []; let cur;
      do {
        const l = await env.R2.list({ prefix: "cotizaciones/", cursor: cur, limit: 1000 });
        l.objects.forEach((o) => { if (o.key.endsWith(".json")) out.push(o.key); });
        cur = l.truncated ? l.cursor : undefined;
      } while (cur);
      out.sort().reverse();
      return json({ cotizaciones: await Promise.all(out.slice(0, 300).map(async (k) => (await env.R2.get(k)).json())) });
    }
    const id = partes[3] || "";
    if (!/^[0-9]{14}-[a-z0-9]{2,16}$/.test(id) || partes.length !== 4 || m !== "PUT") return error(400, "Solicitud inválida");
    const o = await env.R2.get("cotizaciones/" + id + ".json"); if (!o) return error(404, "No existe");
    const sol = await o.json(), c = await request.json().catch(() => ({}));
    if (ESTADOS_COT.includes(c.estado)) sol.estado = c.estado;
    if (typeof c.nota === "string") sol.nota = c.nota.slice(0, 500);
    sol.cambio = new Date().toISOString();
    await env.R2.put("cotizaciones/" + id + ".json", JSON.stringify(sol), { httpMetadata: { contentType: "application/json" } });
    return json({ cotizacion: sol });
  }
  if (partes[2] === "reportes") {
    if (partes.length === 3 && m === "GET") {
      const out = []; let cur;
      do {
        const l = await env.R2.list({ prefix: "reportes/", cursor: cur, limit: 1000 });
        l.objects.forEach((o) => { if (o.key.endsWith(".json")) out.push(o.key); });
        cur = l.truncated ? l.cursor : undefined;
      } while (cur);
      out.sort().reverse();
      const reps = await Promise.all(out.slice(0, 200).map(async (k) => (await env.R2.get(k)).json()));
      return json({ reportes: reps });
    }
    const id = partes[3] || "";
    if (!/^[0-9]{8}-[a-z0-9]{6,30}$/.test(id)) return error(400, "Reporte inválido");
    if (partes[4] === "imagen" && m === "GET") return servirR2(env, request, "reportes/" + id + ".jpg", "private, max-age=3600");
    if (partes.length === 4 && m === "PUT") {
      const o = await env.R2.get("reportes/" + id + ".json"); if (!o) return error(404, "No existe");
      const rep = await o.json(), cuerpo = await request.json().catch(() => ({}));
      if (["nuevo", "revisando", "resuelto"].includes(cuerpo.estado)) rep.estado = cuerpo.estado;
      await env.R2.put("reportes/" + id + ".json", JSON.stringify(rep), { httpMetadata: { contentType: "application/json" } });
      return json({ ok: true });
    }
    return error(405, "Método no permitido");
  }
  if (partes[2] === "cupones") {
    if (partes.length === 3 && m === "GET") {
      const l = await env.R2.list({ prefix: "cupones/", limit: 1000 });
      const cupones = await Promise.all(l.objects.filter((o) => o.key.endsWith(".json")).map(async (o) => (await env.R2.get(o.key)).json()));
      cupones.sort((a, b) => String(b.creado).localeCompare(String(a.creado)) || String(a.codigo).localeCompare(String(b.codigo)));
      // Quién usó cada link (correo de la cuenta)
      const uids = [...new Set(cupones.flatMap((c) => c.usadoPor || []))];
      const correos = Object.fromEntries(await Promise.all(uids.map(async (u) => { const p = await perfil(env, u); return [u, p ? p.email : u]; })));
      cupones.forEach((c) => { c.usadoPorCorreo = (c.usadoPor || []).map((u) => correos[u] || u); });
      return json({ cupones });
    }
    // Crea N links de un solo uso (cada uno con su código), con el mismo descuento y vigencia
    if (partes.length === 3 && m === "POST") {
      const c = await request.json().catch(() => ({}));
      const pct = Math.round(+c.pct), cantidad = Math.round(+c.cantidad || 1);
      if (!(pct >= 1 && pct <= 100)) return error(400, "El descuento va de 1% a 100%");
      if (!(cantidad >= 1 && cantidad <= 100)) return error(400, "De 1 a 100 links a la vez");
      const planes = ["pro", "desarrollos", "espacio"].filter((p) => (c.planes || []).includes(p));
      if (!planes.length) return error(400, "Elige al menos un plan");
      const vence = c.vence && /^\d{4}-\d{2}-\d{2}$/.test(c.vence) ? new Date(c.vence + "T23:59:59-06:00").toISOString() : null;
      const nota = String(c.nota || "").slice(0, 60), lote = Date.now().toString(36), creado = new Date().toISOString();
      const meses = pct >= 100 && +c.meses === 12 ? 12 : 0; // cuánto dura la licencia regalada: 12 meses o para siempre
      const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", cupones = [];
      while (cupones.length < cantidad) {
        const r = crypto.getRandomValues(new Uint8Array(6)), codigo = (pct >= 100 ? "MZ-" : "AL-") + [...r].map((x) => LETRAS[x % LETRAS.length]).join("");
        if (await env.R2.head(cuponClave(codigo))) continue;
        const cupon = { codigo, pct, planes, max: 1, vence, usos: 0, usadoPor: [], activo: true, nota, lote, creado };
        if (meses) cupon.meses = meses;
        await env.R2.put(cuponClave(codigo), JSON.stringify(cupon), { httpMetadata: { contentType: "application/json" } });
        cupones.push(cupon);
      }
      return json({ cupones });
    }
    const codigo = String(partes[3] || "").toUpperCase();
    if (partes.length === 4 && m === "PUT" && CODIGO.test(codigo)) {
      const o = await env.R2.get(cuponClave(codigo)); if (!o) return error(404, "No existe");
      const cupon = await o.json(), cuerpo = await request.json().catch(() => ({}));
      if (typeof cuerpo.activo === "boolean") cupon.activo = cuerpo.activo;
      await env.R2.put(cuponClave(codigo), JSON.stringify(cupon), { httpMetadata: { contentType: "application/json" } });
      return json(cupon);
    }
    return error(405, "Método no permitido");
  }
  if (partes[2] !== "cuentas") return error(404, "Ruta desconocida");
  if (partes.length === 3 && m === "GET") {
    // Con 531 cuentas el panel tardaba 20 s y a veces fallaba: leía el perfil y las sesiones de TODAS las cuentas en
    // cada visita (más de 1,000 lecturas, el tope de una sola petición). Ahora guarda un resumen de cada cuenta
    // (config/cuentas-panel.json) y solo vuelve a leer las que cambiaron desde la última vez (se sabe por su etag).
    // Si son muchas (la primera vez), lee LEER_CUENTAS por petición y avisa cuántas faltan: el panel vuelve a pedir.
    const tours = [], nTours = {}, claves = [];
    const leerJson = (k) => env.R2.get(k).then((r) => (r ? r.json() : null)).catch(() => null);
    let cur;
    do {
      const l = await env.R2.list({ prefix: "cuentas/", cursor: cur, limit: 1000, include: ["customMetadata"] });
      for (const o of l.objects) {
        if (o.key.endsWith("/perfil.json") || o.key.endsWith("/sesiones.json")) { claves.push([o.key, o.etag || String(o.uploaded || "")]); continue; }
        // Índice de tours de cada cuenta: cuentas/<uid>/tours/<id> (su "publicado" dice si ya se publicó)
        const t = o.key.match(/^cuentas\/([^/]+)\/tours\/([^/]+)$/);
        if (t) tours.push({ uid: t[1], publicado: !!(o.customMetadata && o.customMetadata.publicado) });
        if (t) nTours[t[1]] = (nTours[t[1]] || 0) + 1;
      }
      cur = l.truncated ? l.cursor : undefined;
    } while (cur);
    const MEMO = "config/cuentas-panel.json", memo = await leerJson(MEMO), datos = memo && memo.v === 1 && memo.datos ? memo.datos : {};
    const vivas = new Set(claves.map((c) => c[0]));
    let cambio = false;
    for (const k of Object.keys(datos)) if (!vivas.has(k)) { delete datos[k]; cambio = true; }
    const pendientes = claves.filter(([k, e]) => !datos[k] || datos[k].e !== e);
    const pedido = +new URL(request.url).searchParams.get("tope"), tope = env.DEV && pedido > 0 ? pedido : LEER_CUENTAS;
    // De cada perfil, lo que usa el panel; de las sesiones, de dónde entra (ciudad y país) y con qué se registró
    const dePerfil = async (p) => {
      if (!p || !p.uid) return null;
      const pagos = Array.isArray(p.pagos) ? p.pagos : p.ultimoPago ? [Object.assign({ moneda: "MXN", metodo: "mercadopago" }, p.ultimoPago)] : [];
      // Los regalos de antes no guardaban para quién eran: se toma la nota de su link
      for (const x of pagos) if (x && x.metodo === "cupon" && x.cupon && x.nota === undefined) { const c = await leerJson(cuponClave(x.cupon)); x.nota = (c && c.nota) || ""; }
      return { uid: p.uid, email: p.email, nombre: p.nombre, plan: p.plan, vence: p.vence || null, admin: !!p.admin, creado: p.creado, ultimaEntrada: p.ultimaEntrada, registro: p.registro || "", bloqueado: !!p.bloqueado, cortesia: !!p.cortesia, planAntes: p.planAntes || "", pais: p.pais || "", pagos, origen: origenPanel(p.origen) };
    };
    const deSesiones = (l) => {
      if (!Array.isArray(l)) return null;
      const u = l.filter((x) => x && (x.ciudad || x.pais)).sort((a, b) => String(b.ultima || b.creada).localeCompare(String(a.ultima || a.creada)))[0] || {};
      return { pais: u.pais || "", ciudad: u.ciudad || "", tipo: (l.filter(Boolean).sort((a, b) => String(a.creada).localeCompare(String(b.creada)))[0] || {}).tipo || "" };
    };
    await Promise.all(pendientes.slice(0, tope).map(async ([k, e]) => { const j = await leerJson(k); datos[k] = { e, d: k.endsWith("/perfil.json") ? await dePerfil(j) : deSesiones(j) }; }));
    const faltan = Math.max(0, pendientes.length - tope);
    if (pendientes.length || cambio) await env.R2.put(MEMO, JSON.stringify({ v: 1, datos }), { httpMetadata: { contentType: "application/json" } });
    const cuentas = [], sesiones = {};
    for (const k of Object.keys(datos)) { const d = datos[k].d; if (!d) continue; if (k.endsWith("/perfil.json")) cuentas.push(d); else sesiones[k.split("/")[1]] = d; }
    const ultimaSesion = (uid) => sesiones[uid] || {};
    const dueno = new Set(cuentas.filter((p) => p.admin).map((p) => p.uid)), pub = tours.filter((t) => t.publicado);
    const resumenTours = { creados: tours.length, publicados: pub.length, publicadosClientes: pub.filter((t) => !dueno.has(t.uid)).length };
    // Publicados según el plan de la cuenta (el dueño aparte, en «tuyos»)
    const planCuenta = new Map(cuentas.map((p) => [p.uid, PLANES[p.plan] ? p.plan : "gratis"]));
    resumenTours.porPlan = { desarrollos: 0, pro: 0, gratis: 0 };
    pub.forEach((t) => { if (!dueno.has(t.uid)) resumenTours.porPlan[planCuenta.get(t.uid) || "gratis"]++; });
    cuentas.sort((a, b) => String(b.ultimaEntrada).localeCompare(String(a.ultimaEntrada)));
    // Desde dónde se registró: lo anota la cuenta nueva; las de antes, su primer dispositivo con sesión
    const registroDe = (p) => p.registro || (sesiones[p.uid] || {}).tipo || "";
    return json({ tours: resumenTours, faltan, cuentas: cuentas.map((p) => ({ uid: p.uid, email: p.email, nombre: p.nombre, plan: p.plan, vence: p.vence || null, admin: !!p.admin, creado: p.creado, ultimaEntrada: p.ultimaEntrada,
      registro: registroDe(p), nTours: nTours[p.uid] || 0,
      // Lo que pagó y por dónde (los pagos de antes del historial salen de su último pago, que fue por Mercado Pago)
      pausada: !!p.bloqueado, cortesia: !!p.cortesia, planAntes: p.planAntes || "", pais: p.pais || ultimaSesion(p.uid).pais || "", ciudad: ultimaSesion(p.uid).ciudad || "",
      pagos: p.pagos || [], origen: p.origen || null })) });
  }
  if (partes.length === 4 && m === "PUT") {
    const uid = partes[3], cuerpo = await request.json().catch(() => ({}));
    if (!/^[A-Za-z0-9_-]{2,80}$/.test(uid) || !(PLANES[cuerpo.plan] || typeof cuerpo.pausada === "boolean" || (cuerpo.regalo && typeof cuerpo.regalo === "object"))) return error(400, "Datos inválidos");
    const p = await perfil(env, uid);
    if (!p) return error(404, "No existe esa cuenta");
    if (p.admin) return error(400, "La cuenta del dueño no se cambia aquí");
    if (PLANES[cuerpo.plan]) {
      p.plan = cuerpo.plan;
      delete p.vence;   // lo que asigna el dueño a mano no caduca
      p.cortesia = cuerpo.plan !== "gratis"; // dado por el dueño sin pago
    }
    // Licencia de regalo puesta a mano (un alumno que ya tenía su cuenta): con su grupo y, si se quiere, por un año.
    // Queda en su historial como regalo en cero, para que el panel y el Excel no la cuenten como venta.
    if (cuerpo.regalo && typeof cuerpo.regalo === "object") {
      const g = cuerpo.regalo, nota = String(g.nota || "").replace(/\s+/g, " ").trim().slice(0, 60), meses = +g.meses === 12 ? 12 : 0, ahora = new Date();
      if (g.plan !== "pro" && g.plan !== "desarrollos") return error(400, "Elige Pro o Desarrollos");
      if (!nota) return error(400, "Escribe de quién es el regalo (por ejemplo, el curso)");
      // Si ya tenía otra licencia para siempre, se le guarda: al vencer el regalo regresa a ella
      if (meses && !p.vence && p.plan && p.plan !== "gratis" && p.plan !== g.plan) p.planAntes = p.plan;
      p.plan = g.plan; delete p.cortesia;
      if (meses) p.vence = sumarMeses(ahora, meses).toISOString(); else delete p.vence;
      const antes = Array.isArray(p.pagos) ? p.pagos : p.ultimoPago ? [Object.assign({ moneda: "MXN", metodo: "mercadopago" }, p.ultimoPago)] : [];
      p.pagos = antes.concat([{ ref: "regalo-" + Date.now().toString(36), fecha: ahora.toISOString(), monto: 0, moneda: "MXN", metodo: "cupon", plan: g.plan, nota }]).slice(-50);
    }
    // Pausar: no entra al estudio y sus tours publicados dejan de mostrarse (no se borra nada)
    if (typeof cuerpo.pausada === "boolean") {
      if (cuerpo.pausada) p.bloqueado = true; else delete p.bloqueado;
      const l = await env.R2.list({ prefix: "cuentas/" + uid + "/tours/", limit: 1000 });
      const ids = l.objects.map((o) => o.key.split("/").pop()).filter((x) => ID_TOUR.test(x));
      await Promise.all(ids.map((id) => (cuerpo.pausada ? env.R2.put("pausados/" + id, uid) : env.R2.delete("pausados/" + id))));
    }
    await env.R2.put("cuentas/" + uid + "/perfil.json", JSON.stringify(p), { httpMetadata: { contentType: "application/json" } });
    return json({ ok: true });
  }
  return error(405, "Método no permitido");
}

async function api(request, env, partes, yo) {
  const m = request.method, uid = yo.uid, plan = planDe(yo);
  if (partes[1] === "yo" && m === "GET") return json({ email: yo.email, nombre: yo.nombre, foto: yo.foto, admin: !!yo.admin, plan, lab: await labDe(env, yo), guias: yo.guiasVistas || [], bienvenida: !!yo.bienvenida });
  // Desde el celular: «Mándame el link a mi correo» para abrir Mozari en la compu (una vez cada 10 minutos)
  if (partes[1] === "yo" && partes[2] === "link-compu" && partes.length === 3 && m === "POST") {
    const clave = "cuentas/" + yo.uid + "/perfil.json", o = await env.R2.get(clave); if (!o) return error(404, "Sin cuenta");
    const p = await o.json();
    if (p.linkCompu && Date.now() - Date.parse(p.linkCompu) < 600e3) return json({ ok: true, para: p.email, repetido: true });
    const base = new URL(request.url).origin, c = correoCompu({ nombre: p.nombre, base, pedido: true });
    const cuenta = await contador(env), r = await enviar(env, cuenta, { para: p.email, asunto: c.asunto, html: c.html, texto: c.texto });
    await cuenta.guardar();
    if (r !== "ok") return error(r === "tope" ? 429 : 502, "No se pudo mandar el correo. Copia el link: " + base + "/");
    p.linkCompu = new Date().toISOString();
    await env.R2.put(clave, JSON.stringify(p), { httpMetadata: { contentType: "application/json" } });
    return json({ ok: true, para: p.email });
  }
  // Tutoriales guiados: cada cuenta ve el de cada herramienta una sola vez (se anota en su perfil)
  // Sonido del tour (Laboratorio «voz-ia»): las voces que hay, lo que le queda a la cuenta este mes y a ese tour
  if (partes[1] === "voz" && partes.length === 2 && m === "GET") {
    // En un tour compartido (Equipo) el socio usa las letras de voz de la licencia del dueño (pedido de Amar, 23 nov 2026),
    // igual que al crear la voz (api/tours/<id>/voz/audio ya corre con la cuenta del dueño)
    const tour = new URL(request.url).searchParams.get("tour") || "";
    let quien = yo, pq = plan;
    if (ID_TOUR.test(tour) && !(await esDueno(env, uid, tour))) { const d = await duenoDeEquipo(env, yo, tour); if (d) { quien = d; pq = planDe(d); } }
    const lab = await labDe(env, quien);
    return lab.includes("voz-ia") ? vozEstado(env, quien, pq, tour, lab.includes("voz-idiomas")) : error(403, "Esta función aún no está en tu cuenta");
  }
  // Ubicación en satélite: el satélite para la vista previa del mapa dentro del estudio (solo a quien tiene la función)
  if (partes[1] === "mapa" && partes.length === 2 && m === "GET") return json({ sat: (await labDe(env, yo)).includes("ubicacion") ? await satDe(env) : "" });
  if (partes[1] === "guias" && partes.length === 3 && m === "POST" && /^[a-z0-9-]{2,40}$/.test(partes[2])) {
    const clave = "cuentas/" + yo.uid + "/perfil.json", o = await env.R2.get(clave); if (!o) return error(404, "Sin cuenta");
    const p = await o.json(); p.guiasVistas = [...new Set((p.guiasVistas || []).concat([partes[2]]))].slice(-300); // los más nuevos se quedan (antes, pasando de 100 ya no se guardaba ninguno y el tutorial salía siempre)
    await env.R2.put(clave, JSON.stringify(p), { httpMetadata: { contentType: "application/json" } });
    return json({ ok: true });
  }
  if (partes[1] === "pagos") return apiPagos(request, env, partes, yo);
  if (partes[1] === "reportes" && partes.length === 2 && m === "POST") return crearReporte(request, env, yo, plan);
  if (partes[1] === "admin") return yo.admin ? admin(request, env, partes, yo) : error(403, "Solo el dueño de Mozari");
  if (partes[1] === "novedades") return apiNovedades(request, env, partes, yo, plan);

  if (partes[1] === "uso" && m === "GET") return json(Object.assign({ plan }, await usoDe(env, uid, true)));

  if (partes[1] !== "tours") return error(404, "Ruta desconocida");

  if (partes.length === 2) {
    if (m === "GET") {
      const l = await env.R2.list({ prefix: "cuentas/" + uid + "/tours/", include: ["customMetadata"], limit: 1000 });
      const tours = l.objects.map((o) => Object.assign({ id: o.key.split("/").pop() }, o.customMetadata))
        .sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado)));
      return json({ tours, compartidos: await compartidosCon(env, yo) });
    }
    if (m === "POST") {
      if (plan.tours !== null) {
        const l = await env.R2.list({ prefix: "cuentas/" + uid + "/tours/", limit: 1000 });
        // En la cuenta de prueba se dice cómo seguir practicando (un usuario creyó que solo podía pagar, nov 2026)
        if (l.objects.length >= plan.tours) return limite(plan.marca ? "Tu cuenta de prueba incluye " + plan.tours + " tours. Para practicar más, borra uno que ya no uses, o pasa a Pro para crear sin límite." : "Tu plan " + plan.nombre + " incluye " + plan.tours + (plan.tours === 1 ? " tour" : " tours") + ". Mejora tu plan para crear más.", "tours");
      }
      const cuerpo = await request.json().catch(() => ({}));
      const nombre = String(cuerpo.nombre || "Tour nuevo").slice(0, 80);
      const id = idNuevo(nombre);
      const proyecto = { version: 2, proyecto: { nombre, escenaInicial: "", musica: { volumen: 0.6, repetir: true } }, escenas: [], capas: {} };
      await env.R2.put("tours/" + id + "/proyecto.json", JSON.stringify(proyecto), { httpMetadata: { contentType: tipoDe("x.json") } });
      await guardarIndice(env, uid, id, { nombre, creado: new Date().toISOString(), publicado: "" });
      return json({ id, proyecto }, 201);
    }
    return error(405, "Método no permitido");
  }

  const id = partes[2];
  if (!ID_TOUR.test(id)) return error(400, "Tour inválido");
  if (await esDueno(env, uid, id)) return apiTour(request, env, partes, yo, id, null);
  // Equipo: un miembro trabaja el tour con la licencia, el espacio y el Laboratorio de su dueño
  const d = await duenoDeEquipo(env, yo, id);
  if (!d) return error(404, "No existe ese tour");
  return apiTour(request, env, partes, d, id, yo);
}

// ---------- Equipo (Laboratorio «equipo», pedido de Amar 22 nov 2026: «¿hay forma de poder trabajar en equipo un tour que
// yo ya estoy trabajando?») ----------
// El dueño invita por correo a quien le ayuda; con su propia cuenta le sale el tour en «Compartidos contigo» y lo edita y
// publica como si fuera del dueño (con su licencia, su espacio y su Laboratorio). No puede borrarlo ni invitar a otros.
// Para que nadie borre el trabajo del otro, una sola persona edita a la vez: mientras el estudio está abierto se renueva
// tours/<id>/editando.json; quien llega después solo ve hasta que se libere, y el servidor no acepta sus cambios.
//   tours/<id>/equipo.json        { dueno: uid, miembros: [{ email, desde }] }
//   compartidos/<huella del correo>/<id>   vacío, con { dueno, duenoNombre } (para su lista)
//   tours/<id>/editando.json      { uid, nombre, email, hasta }   vale 75 s; el estudio lo renueva cada 25 s
const MAX_EQUIPO = 5, VIGENCIA_EDITANDO = 75e3;
const CORREO_OK = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i;
const claveCompartido = (h, id) => "compartidos/" + h + "/" + id;
async function huellaCorreo(email) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mz-equipo:" + String(email).trim().toLowerCase()));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function leerEquipo(env, id) {
  const o = await env.R2.get("tours/" + id + "/equipo.json"), e = o ? await o.json().catch(() => null) : null;
  return { dueno: (e && e.dueno) || "", miembros: e && Array.isArray(e.miembros) ? e.miembros.filter((x) => x && CORREO_OK.test(x.email || "")) : [] };
}
async function duenoDeEquipo(env, yo, id) {
  const eq = await leerEquipo(env, id), correo = String(yo.email || "").toLowerCase();
  if (!eq.dueno || !correo || !eq.miembros.some((x) => x.email === correo) || !(await esDueno(env, eq.dueno, id))) return null;
  const d = await perfil(env, eq.dueno);
  if (!d || d.bloqueado) return null;
  d.uid = d.uid || eq.dueno;
  return (await labDe(env, d)).includes("equipo") ? d : null; // si el dueño ya no tiene la función, el equipo deja de entrar
}
async function editandoDe(env, id) {
  const o = await env.R2.get("tours/" + id + "/editando.json"), l = o ? await o.json().catch(() => null) : null;
  return l && Date.parse(l.hasta) > Date.now() ? l : null;
}
// Si otra persona del equipo tiene el tour abierto: { nombre, email } (en un tour sin equipo, nunca)
async function otroEditando(env, id, quien) {
  const l = await editandoDe(env, id);
  if (!l || l.uid === quien.uid) return null;
  return (await leerEquipo(env, id)).miembros.length ? { nombre: l.nombre, email: l.email } : null;
}
async function apiEquipo(request, env, partes, yo, id, miembro) {
  const m = request.method, quien = miembro || yo, base = "tours/" + id + "/", eq = await leerEquipo(env, id);
  const guardarEquipo = () => env.R2.put(base + "equipo.json", JSON.stringify({ dueno: yo.uid, miembros: eq.miembros }), { httpMetadata: { contentType: "application/json" } });
  const vista = async () => {
    const l = await editandoDe(env, id);
    return json({ miembros: eq.miembros.map((x) => ({ email: x.email, desde: x.desde })), dueno: { nombre: yo.nombre || yo.email, email: yo.email }, soyDueno: !miembro,
      plan: miembro ? planDe(yo) : undefined, duenoAdmin: miembro ? !!yo.admin : undefined, // el estudio del miembro trabaja con la licencia del dueño
      puedeInvitar: !miembro && (await labDe(env, yo)).includes("equipo"), max: MAX_EQUIPO, editando: l && l.uid !== quien.uid && eq.miembros.length ? { nombre: l.nombre, email: l.email } : null });
  };
  // Mientras el estudio está abierto: «estoy editando» cada 25 s; al cerrarlo, se suelta
  if (partes[3] === "editando" && partes.length === 4 && m === "POST") {
    if (!eq.miembros.length) return json({ libre: true, solo: true });
    const c = await request.json().catch(() => ({})), l = await editandoDe(env, id);
    if (c.soltar) { if (l && l.uid === quien.uid) await env.R2.delete(base + "editando.json"); return json({ ok: true }); }
    if (l && l.uid !== quien.uid) return json({ libre: false, editando: { nombre: l.nombre, email: l.email } });
    if (c.mirar) return json({ libre: true }); // quien solo está viendo pregunta si ya se liberó, sin apartarlo
    await env.R2.put(base + "editando.json", JSON.stringify({ uid: quien.uid, nombre: String(quien.nombre || quien.email).slice(0, 60), email: quien.email, hasta: new Date(Date.now() + VIGENCIA_EDITANDO).toISOString() }), { httpMetadata: { contentType: "application/json" } });
    return json({ libre: true });
  }
  if (partes[3] !== "equipo") return error(404, "Ruta desconocida");
  if (partes.length === 4 && m === "GET") return vista();
  if (partes.length === 4 && m === "POST") {
    if (miembro) return error(403, "Solo el dueño del tour invita a su equipo");
    if (!(await labDe(env, yo)).includes("equipo")) return error(403, "Función del Laboratorio");
    const c = await request.json().catch(() => ({})), email = String(c.email || "").trim().toLowerCase();
    if (!CORREO_OK.test(email)) return error(400, "Escribe un correo válido");
    if (email === String(yo.email || "").toLowerCase()) return error(400, "Ese es tu correo: tú ya eres el dueño del tour");
    if (eq.miembros.some((x) => x.email === email)) return error(400, "Esa persona ya está en el equipo");
    if (eq.miembros.length >= MAX_EQUIPO) return error(400, "Un tour puede tener hasta " + MAX_EQUIPO + " personas en su equipo");
    eq.miembros.push({ email, desde: new Date().toISOString() });
    await guardarEquipo();
    await env.R2.put(claveCompartido(await huellaCorreo(email), id), "", { customMetadata: { dueno: yo.uid, duenoNombre: String(yo.nombre || yo.email).slice(0, 80) } });
    return vista();
  }
  if (partes.length === 5 && m === "DELETE") {
    const email = decodeURIComponent(partes[4] || "").trim().toLowerCase();
    if (miembro && email !== String(miembro.email || "").toLowerCase()) return error(403, "Solo el dueño quita a otras personas del equipo");
    if (!eq.miembros.some((x) => x.email === email)) return error(404, "Esa persona no está en el equipo");
    eq.miembros = eq.miembros.filter((x) => x.email !== email);
    await guardarEquipo();
    await env.R2.delete(claveCompartido(await huellaCorreo(email), id));
    const l = await editandoDe(env, id); if (l && String(l.email || "").toLowerCase() === email) await env.R2.delete(base + "editando.json");
    return miembro ? json({ ok: true, salio: true }) : vista();
  }
  return error(405, "Método no permitido");
}
// Los tours que otros le compartieron a esta cuenta (para Mis Tours → «Compartidos contigo»)
async function compartidosCon(env, yo) {
  if (!yo.email) return [];
  const h = await huellaCorreo(yo.email), l = await env.R2.list({ prefix: "compartidos/" + h + "/", include: ["customMetadata"], limit: 100 });
  const r = await Promise.all(l.objects.map(async (o) => {
    const id = o.key.split("/").pop(), md = o.customMetadata || {};
    if (!ID_TOUR.test(id) || !md.dueno) return null;
    const ix = await env.R2.head(indiceDe(md.dueno, id)); if (!ix) return null;
    return Object.assign({ id }, ix.customMetadata, { compartido: true, duenoNombre: md.duenoNombre || "" });
  }));
  return r.filter(Boolean).sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado)));
}

// Todo lo de un tour. yo = su dueño; miembro = quien lo trabaja si no es el dueño (Equipo)
async function apiTour(request, env, partes, yo, id, miembro) {
  const m = request.method, uid = yo.uid, plan = planDe(yo), quien = miembro || yo;
  const base = "tours/" + id + "/";
  if (miembro && partes.length === 3 && m === "DELETE") return error(403, "Solo el dueño puede borrar el tour");
  if (partes[3] === "equipo" || partes[3] === "editando") return apiEquipo(request, env, partes, yo, id, miembro);

  if (partes.length === 3) {
    if (m === "GET") return servirR2(env, request, base + "proyecto.json", "no-store");
    if (m === "PUT") {
      const otro = await otroEditando(env, id, quien); if (otro) return json({ error: otro.nombre + " está editando este tour. Tus cambios no se guardaron.", editando: otro }, 409);
      const largo = +request.headers.get("content-length") || 0;
      if (largo > MAX_PROYECTO) return error(413, "El proyecto pesa demasiado");
      let txt = await request.text();
      if (txt.length > MAX_PROYECTO) return error(413, "El proyecto pesa demasiado");
      let p;
      try { p = JSON.parse(txt); } catch (e) { return error(400, "JSON inválido"); }
      if (!p || !p.proyecto || !Array.isArray(p.escenas)) return error(400, "Proyecto incompleto");
      // Lo que se marcó desde el celular gana sobre un estudio abierto que no se ha enterado
      const movil = await leerJSON(env, base + "estados-movil.json"), corregidos = [], cargado = String(request.headers.get("x-cargado") || "").slice(0, 30);
      if (movil && Object.keys(movil).length) {
        let cambio = false;
        Object.values(p.capas || {}).forEach((l) => (Array.isArray(l) ? l : []).forEach((c) => {
          if (!c || !c.lote) return;
          const k = llaveLote(c.lote.manzana, c.lote.numero), r = movil[k];
          if (!r) return;
          const actual = c.lote.estado || "disponible";
          // El estudio dice cuándo abrió el tour: si fue después del cambio en el celular, ya lo vio y lo que trae manda
          if (cargado && cargado > r.ts) { r.listo = true; return; }
          if (actual !== r.estado && (cargado || actual === r.antes)) { c.lote.estado = r.estado; cambio = true; if (!corregidos.some((x) => x.k === k)) corregidos.push({ k, mz: c.lote.manzana || "", num: c.lote.numero || "", estado: r.estado, quien: r.quien === "cliente" ? "cliente" : "celular" }); }
          else if (actual !== r.antes) r.listo = true; // ya coincide o lo cambiaron a propósito en la compu
        }));
        Object.keys(movil).forEach((k) => { if (movil[k].listo) delete movil[k]; });
        await env.R2.put(base + "estados-movil.json", JSON.stringify(movil), { httpMetadata: { contentType: "application/json" } });
        if (cambio) txt = JSON.stringify(p);
      }
      if (!pasa(plan.esferas, p.escenas.length)) return limite(plan.marca ? "Tu cuenta de prueba incluye " + plan.esferas + " esferas por tour. Para practicar más, borra una que ya no uses, o pasa a Pro para subir sin límite." : "Tu plan " + plan.nombre + " incluye " + plan.esferas + " esferas por tour. Mejora tu plan para subir más.", "esferas");
      await env.R2.put(base + "proyecto.json", txt, { httpMetadata: { contentType: tipoDe("x.json") } });
      const portada = typeof p.proyecto.thumbnail === "string" && rutaValida(p.proyecto.thumbnail) ? p.proyecto.thumbnail : "";
      await guardarIndice(env, uid, id, { nombre: p.proyecto.nombre || "Tour", escenas: p.escenas.length, inicial: p.proyecto.escenaInicial || "", portada });
      return json(corregidos.length ? { ok: true, estados: corregidos } : { ok: true });
    }
    if (m === "DELETE") {
      const cli = await leerJSON(env, base + "cliente.json"); // su link para el cliente deja de existir con él
      if (cli && TOKEN_CLIENTE.test(cli.token || "")) await env.R2.delete("clientes/" + (await huellaToken(cli.token)) + ".json");
      const eq = await leerEquipo(env, id); // y a su equipo ya no le sale en «Compartidos contigo»
      if (eq.miembros.length) await env.R2.delete(await Promise.all(eq.miembros.map(async (x) => claveCompartido(await huellaCorreo(x.email), id))));
      const n = await borrarPrefijo(env, base) + await borrarPrefijo(env, "publicado/" + id + "/");
      await env.R2.delete([indiceDe(uid, id), "privados/" + id]);
      await usoDe(env, uid, true);
      return json({ ok: true, borrados: n });
    }
    return error(405, "Método no permitido");
  }

  if (partes[3] === "estados" && partes.length === 4 && m === "PATCH") {
    if (!yo.admin && plan.id !== "desarrollos") return error(403, "Cambiar la disponibilidad desde el celular es de la licencia Desarrollos");
    if (!(await labDe(env, yo)).includes("lotes-movil")) return error(403, "Función del Laboratorio");
    const c = await request.json().catch(() => ({}));
    const cambios = (Array.isArray(c.cambios) ? c.cambios : []).slice(0, 50).map((x) => ({ mz: String((x && x.mz) || "").slice(0, 40), num: String((x && x.num) || "").slice(0, 40), estado: String((x && x.estado) || "").slice(0, 40) })).filter((x) => x.num && x.estado);
    if (!cambios.length) return error(400, "Sin cambios");
    const r = await aplicarEstados(env, id, cambios, "celular");
    if (!r) return error(404, "No existe ese tour");
    return json({ ok: true, borrador: r.borrador, publicado: r.publicado, enTour: r.enTour });
  }
  // Link de disponibilidad para el cliente (Laboratorio «link-cliente»): verlo, crearlo (o cambiarlo) y quitarlo
  if (partes[3] === "cliente" && partes.length === 4) {
    if (!(await labDe(env, yo)).includes("link-cliente")) return error(403, "Función del Laboratorio");
    const actual = await leerJSON(env, base + "cliente.json"), origen = new URL(request.url).origin;
    const quitar = async () => { if (actual && TOKEN_CLIENTE.test(actual.token || "")) await env.R2.delete(["clientes/" + (await huellaToken(actual.token)) + ".json", base + "cliente.json"]); };
    if (m === "GET") {
      const cambios = ((await leerJSON(env, base + "cambios-cliente.json")) || []).slice(0, 20);
      return json({ link: actual ? origen + "/disponibilidad/" + actual.token : "", creado: actual ? actual.creado : "", cambios, marca: conMarcaCliente(yo) });
    }
    if (m === "POST") {
      await quitar(); // uno nuevo deja sin efecto el anterior
      const token = tokenNuevo(), creado = new Date().toISOString();
      await env.R2.put("clientes/" + (await huellaToken(token)) + ".json", JSON.stringify({ id, uid, creado }), { httpMetadata: { contentType: "application/json" } });
      await env.R2.put(base + "cliente.json", JSON.stringify({ token, creado }), { httpMetadata: { contentType: "application/json" } });
      return json({ link: origen + "/disponibilidad/" + token, creado, marca: conMarcaCliente(yo) }, 201);
    }
    if (m === "DELETE") { await quitar(); return json({ ok: true }); }
    return error(405, "Método no permitido");
  }
  // Descargar el tour publicado para subirlo a otro hosting: la página, el proyecto y la lista de archivos.
  // El estudio baja cada archivo y arma el .zip en la compu del usuario (el servidor no hace el trabajo pesado).
  if (partes[3] === "descargar" && partes.length === 4 && m === "GET") {
    const obj = await env.R2.get("publicado/" + id + "/proyecto.json");
    if (plan.marca && !yo.admin) return json({ error: "Descargar tus tours es parte del plan Pro.", plan: "pro" }, 403);
    if (!obj) return error(409, "Publica tu tour antes de descargarlo.");
    const p = await obj.json(), pr = p.proyecto || {};
    // Solo se descarga lo que la licencia cubre completo (sin marca de prueba)
    if (pr.marcaMozari && !yo.admin) {
      const lotes = usaLotificacion(p);
      return json({ error: lotes ? "Para descargar un tour con lotes necesitas el plan Desarrollos." : "Para descargar tus tours necesitas el plan Pro.", plan: lotes ? "desarrollos" : "pro" }, 403);
    }
    const escenas = new Set((p.escenas || []).map((e) => e.id).filter((x) => /^[A-Za-z0-9_-]{1,80}$/.test(x)));
    const archivos = [];
    for (const pre of ["escenas/", "archivos/"]) {
      let cursor;
      do {
        const l = await env.R2.list({ prefix: base + pre, cursor, limit: 1000 });
        for (const o of l.objects) {
          const ruta = o.key.slice(base.length);
          if (pre === "escenas/" && !escenas.has(ruta.split("/")[1])) continue;
          if (rutaValida(ruta)) archivos.push({ ruta, bytes: o.size });
        }
        cursor = l.truncated ? l.cursor : undefined;
      } while (cursor);
    }
    // Esferas editadas (Mejora): sus piezas se bajan ya editadas (e<N>-<M>/) con el nombre de siempre, y no van las
    // carpetas ret<N>/ ni aj<M>/. El escena.json del .zip va sin el número de edición (lo quita el estudio al armarlo).
    const edic = {};
    await Promise.all([...escenas].map(async (e) => { const o = await env.R2.get(base + "escenas/" + e + "/escena.json"), j = o ? await o.json().catch(() => null) : null; const pf = prefijoEdicion(j); if (pf) edic[e] = pf; }));
    for (let i = archivos.length - 1; i >= 0; i--) {
      const a = archivos[i], m = /^escenas\/([A-Za-z0-9_-]{1,80})\/(.+)$/.exec(a.ruta); if (!m) continue;
      if (/^(ret|aj)\d+\//.test(m[2])) { archivos.splice(i, 1); continue; }
      if (edic[m[1]] && (/^\d{1,2}\/[bdflru]\/\d+\/\d+\.jpg$/.test(m[2]) || m[2] === "preview.jpg")) a.desde = "escenas/" + m[1] + "/" + edic[m[1]] + "/" + m[2];
    }
    const nombre = String(pr.nombre || "Recorrido virtual 360").slice(0, 90);
    const desc = (typeof pr.descripcion === "string" && pr.descripcion.replace(/\s+/g, " ").trim().slice(0, 200)) || "Recorrido virtual 360";
    const pon = (v) => ({ element: (el) => el.setAttribute("content", v) });
    const quita = { element: (el) => el.remove() };
    // Marca blanca (pedido de OBED y Amar, nov 2026): la página es recorrido.html (solo el visor, compacto y sin
    // ninguna mención a la plataforma), con la carga del proyecto, sin íconos ni vista previa que lleven a mozari.app
    const pagina = await env.ASSETS.fetch(new Request(new URL("/recorrido.html", request.url)));
    const html = await conCarga(new HTMLRewriter(), p, false, true)
      .on("body", { element: (el) => { el.setAttribute("data-modo", "tour"); el.setAttribute("data-exportado", "1"); } })
      .on("title", { element: (el) => el.setInnerContent(nombre) })
      .on('meta[property="og:title"]', pon(nombre)).on('meta[property="og:site_name"]', pon(nombre))
      .on('meta[property="og:description"]', pon(desc)).on('meta[name="description"]', pon(desc))
      .on('meta[property^="og:image"]', quita).on('meta[name="twitter:image"]', quita).on('meta[property="og:url"]', quita)
      .on('link[href^="/"]', quita).on('meta[name="theme-color"]', quita)
      // El ícono de la pestaña del cliente (si subió uno) viaja en sus archivos
      .on("head", { element: (el) => { const i = p.skin && p.skin.icono; if (typeof i === "string" && /^archivos\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|svg)$/.test(i)) el.append('<link rel="icon" href="' + i + '"><link rel="apple-touch-icon" href="' + i + '">', { html: true }); } })
      // Las librerías viajan dentro del .zip, junto al index.html
      .on('script[src^="/lib/"]', { element: (el) => el.setAttribute("src", el.getAttribute("src").slice(1)) })
      .transform(pagina).text();
    if (p.proyecto) delete p.proyecto.marcaMozari; // el proyecto.json del .zip tampoco nombra a la plataforma
    return json({ nombre, html, proyecto: p, archivos, librerias: ["lib/marzipano.js", "lib/d3.min.js"], bytes: archivos.reduce((s, a) => s + a.bytes, 0) });
  }

  if (partes[3] === "estadisticas" && partes.length === 4 && m === "GET") {
    if (!(await labDe(env, yo)).includes("estadisticas")) return error(403, "Función del Laboratorio");
    return json(await resumenVisitas(env, id, Math.max(1, Math.min(90, +new URL(request.url).searchParams.get("dias") || 30))));
  }

  // Modo privado (Laboratorio): el tour publicado se esconde sin borrar nada; el Worker de tours lo revisa al abrirlo
  if (partes[3] === "privado" && partes.length === 4 && m === "PUT") {
    if (!(await labDe(env, yo)).includes("privado")) return error(403, "Función del Laboratorio");
    const si = !!(await request.json().catch(() => ({}))).privado;
    if (si) await env.R2.put("privados/" + id, uid); else await env.R2.delete("privados/" + id);
    await guardarIndice(env, uid, id, { privado: si ? "1" : "" });
    return json({ ok: true, privado: si });
  }

  if (partes[3] === "publicar" && partes.length === 4 && m === "POST") {
    const otro = await otroEditando(env, id, quien); if (otro) return json({ error: otro.nombre + " está editando este tour. Publica cuando termine.", editando: otro }, 409);
    const obj = await env.R2.get(base + "proyecto.json");
    if (!obj) return error(404, "No existe ese tour");
    const p = await obj.json();
    // Versión de prueba: todo se puede usar y publicar, pero lo que el plan no cubre sale con marca de agua
    // (Gratis siempre; un tour con lotes sin el plan Desarrollos). Lo decide el servidor, no la página.
    p.proyecto.marcaMozari = !!plan.marca || (!plan.lotificacion && usaLotificacion(p));
    // Estadísticas (Laboratorio): el tour publicado solo cuenta visitas si su dueño tiene la función activa
    const lab = await labDe(env, yo);
    p.proyecto.estadisticas = lab.includes("estadisticas");
    // Pantalla de carga con el logo del proyecto (Laboratorio): el servidor la arma al servir el tour
    p.proyecto.cargaPropia = lab.includes("carga-logo");
    // Acabado fino (Laboratorio): los retoques a la interfaz del tour publicado
    p.proyecto.acabado = lab.includes("acabado");
    p.proyecto.transiciones = lab.includes("transiciones");
    // Botón para descargar un PDF (Laboratorio): sale solo si su dueño tiene la función
    p.proyecto.descargaPdf = lab.includes("descarga-pdf");
    // Landing del desarrollo (Laboratorio): solo se publica si su dueño tiene la función
    if (!lab.includes("landing")) delete p.proyecto.landing;
    // Rótulo corto y grande (Laboratorio): solo se publica si su dueño tiene la función
    if (!lab.includes("rotulo-corto")) delete p.proyecto.rotuloCorto;
    if (!lab.includes("rotulo-estilos")) { delete p.proyecto.rotuloFormato; delete p.proyecto.rotuloEstilo; }
    // Lotes vendidos sin número ni ficha (Laboratorio «lotes-vendidos»): sin la función, todos los estados se ven como siempre
    if (!lab.includes("lotes-vendidos") && Array.isArray(p.lotesEstados)) p.lotesEstados = p.lotesEstados.map((e) => { if (!e || typeof e !== "object") return e; const x = Object.assign({}, e); delete x.sinNumero; delete x.sinToque; delete x.sinRelleno; return x; });
    // Ubicación en satélite (Laboratorio): el mapa /mapa solo se publica si su dueño tiene la función
    if (!lab.includes("ubicacion")) delete p.proyecto.ubicacion;
    // Voz del tour (Laboratorio): solo se publica si su dueño tiene la función; sus notas de trabajo se quedan en el borrador
    if (!lab.includes("voz-ia")) delete p.proyecto.vozTour;
    else if (p.proyecto.vozTour && typeof p.proyecto.vozTour === "object") {
      const vt = p.proyecto.vozTour; delete vt.ia;
      // La voz en inglés (Laboratorio «voz-idiomas») solo sale publicada si su dueño tiene la función
      if (!lab.includes("voz-idiomas") || !vt.en || typeof vt.en !== "object" || !vt.en.archivo) delete vt.en; else delete vt.en.ia;
      if (!vt.archivo && !vt.en) delete p.proyecto.vozTour;
    }
    // Pantalla de bienvenida (Laboratorio): solo sale publicada si su dueño tiene la función
    if (!lab.includes("bienvenida")) delete p.proyecto.bienvenida;
    await env.R2.put("publicado/" + id + "/proyecto.json", JSON.stringify(p), { httpMetadata: { contentType: tipoDe("x.json"), cacheControl: "no-cache" } });
    await guardarIndice(env, uid, id, { publicado: new Date().toISOString() });
    return json({ ok: true });
  }

  // Sonido del tour (Laboratorio «voz-ia»): la voz lee tal cual el texto del usuario (cada tour, 2 voces al mes)
  if (partes[3] === "voz" && partes.length === 5 && m === "POST" && partes[4] === "audio") {
    const lab = await labDe(env, yo);
    if (!lab.includes("voz-ia")) return error(403, "Esta función aún no está en tu cuenta");
    return vozAudio(request, env, yo, plan, base, usoDe, limite, id, lab.includes("voz-idiomas"));
  }

  if (partes[3] === "f" && partes.length > 4) {
    const ruta = partes.slice(4).join("/");
    const valida = (m === "DELETE" && ruta.endsWith("/")) ? rutaValida(ruta.slice(0, -1)) : rutaValida(ruta);
    if (!valida) return error(400, "Ruta de archivo inválida");
    if (m === "PUT") {
      const largo = +request.headers.get("content-length") || 0;
      if (!largo || largo > (tipoDe(ruta) === "video/mp4" ? MAX_VIDEO : MAX_ARCHIVO)) return error(413, tipoDe(ruta) === "video/mp4" ? "El video pesa más de 95 MB. Compáctalo o súbelo a YouTube y pega el link." : "Archivo vacío o muy pesado");
      if (plan.bytes !== null) {
        const u = await usoDe(env, uid);
        if (u.bytes + largo > plan.bytes) return limite(plan.marca ? "Llegaste a los " + gb(plan.bytes) + " de tu cuenta de prueba. Para practicar más, borra un tour o una esfera que ya no uses, o pasa a Pro para tener más espacio." : "Llegaste al espacio de tu plan " + plan.nombre + " (" + gb(plan.bytes) + "). Mejora tu plan para subir más.", "espacio");
      }
      const tipo = tipoDe(ruta);
      if (tipo === "application/octet-stream" || tipo.startsWith("text/html")) return error(415, "Tipo de archivo no permitido");
      await env.R2.put(base + ruta, request.body, { httpMetadata: { contentType: tipo } });
      return json({ ok: true });
    }
    if (m === "DELETE") {
      const n = ruta.endsWith("/") ? await borrarPrefijo(env, base + ruta) : (await env.R2.delete(base + ruta), 1);
      return json({ ok: true, borrados: n });
    }
    return error(405, "Método no permitido");
  }
  return error(404, "Ruta desconocida");
}

const conAsset = (env, request, ruta) => env.ASSETS.fetch(new Request(new URL(ruta, request.url), { headers: request.headers }));

// Una vez por copia del programa: si es una versión nueva de Mozari, respalda los datos antes de seguir
let respaldoRevisado = false;
export default {
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(vigilarRespaldos(env));
    // Novedades por correo que aún tienen pendientes: una tanda por hora
    if (env.ENVIOS) ctx.waitUntil(avanzarColas(env, "https://" + (env.DOMINIO || "mozari.app"), firmaBaja(env)).catch(() => {}));
    // «Tu cuenta te espera en la compu»: a las ~24 h, a quien no ha hecho su primer tour (si el dueño lo prendió)
    // Links para la compu que alguien pidió desde el celular y no cupieron en su día
    if (env.ENVIOS) ctx.waitUntil(mandarProspectosPendientes(env, "https://" + (env.DOMINIO || "mozari.app"), firmaBaja(env)).catch(() => {}));
    if (env.ENVIOS) ctx.waitUntil(leerConf(env).then((c) => (c.recordatorio ? mandarRecordatorios(env, "https://" + (env.DOMINIO || "mozari.app"), firmaBaja(env)) : 0)).catch(() => {}));
  },
  async fetch(request, env, ctx) {
    if (!respaldoRevisado && env.VERSION && ctx) { respaldoRevisado = true; ctx.waitUntil(vigilarRespaldos(env).catch(() => {})); }
    const url = new URL(request.url);
    const segs = url.pathname.replace(/^\/+/, "").split("/");

    // Dominio propio: las páginas viejas (workers.dev, www) mandan a mozari.app.
    // La API, los archivos, el aviso de Mercado Pago y la entrada con Google en curso no se mueven.
    if (env.DOMINIO && url.hostname !== env.DOMINIO && url.hostname !== "localhost" && request.method === "GET" && !["api", "t", "webhooks", "auth"].includes(segs[0])) {
      return Response.redirect("https://" + env.DOMINIO + url.pathname + url.search, 302);
    }

    // Visitas de los tours publicados (público, sin sesión): solo guarda un resumen anónimo
    if (segs[0] === "v" && segs.length === 2 && request.method === "POST") return registrarVisita(request, env, segs[1]);
    // Aviso si un tour publicado se cerró solo en un celular (público, sin sesión)
    if (segs[0] === "c" && segs.length === 2 && request.method === "POST") return registrarCaida(request, env, segs[1]);

    // Contrata tu tour 360 (escaparate, sin sesión): el país del visitante y la solicitud de cotización
    if (url.pathname === "/cotizar") return cotizar(request, env, url);
    // Desde el celular (portada, sin sesión): deja su correo y le llega el link para abrir Mozari en la compu
    if (url.pathname === "/prospecto") return pedirLink(request, env, url, firmaBaja(env), /iPhone|Android.*Mobile/.test(request.headers.get("user-agent") || "") ? "celular" : /iPad|Android|Tablet/.test(request.headers.get("user-agent") || "") ? "tablet" : "compu");
    // Ventas para la hoja de Google (con su clave, sin sesión)
    if (url.pathname === "/ventas.csv" && request.method === "GET") return ventasCsv(request, env);
    // Tours hechos con Mozari: la lista pública para el sitio (sin sesión)
    if (url.pathname === "/galeria.json" && request.method === "GET") return galeriaPublica(request, env, ctx);
    // Correos: darse de baja de las novedades (sin sesión: el link va firmado) y la imagen de una novedad
    if (url.pathname === "/baja" && (request.method === "GET" || request.method === "POST")) return rutaBaja(request, env, verificarLink);
    if (segs[0] === "correo" && segs[1] === "novedad" && segs.length === 3 && request.method === "GET") {
      const o = /^[a-z0-9]{6,20}$/.test(segs[2]) ? await env.R2.get("novedades/" + segs[2] + ".json") : null, n = o ? await o.json().catch(() => null) : null;
      if (!n || !n.activa || !n.publicada || n.mediaTipo !== "imagen") return new Response("No existe", { status: 404 });
      return servirR2(env, request, "novedades/" + segs[2] + ".media", "public, max-age=86400");
    }

    // Link de disponibilidad para el cliente (sin sesión: el link es la llave)
    if (segs[0] === "disponibilidad" && segs.length >= 2) return rutaCliente(request, env, url, segs);

    const s = await rutasSesion(request, env, (p) => adoptarTours(env, p));
    if (s) return s;

    if (url.pathname === "/webhooks/mercadopago") return webhookMercadoPago(request, env);
    if (url.pathname === "/webhooks/stripe") return webhookStripe(request, env);

    // Links cortos para compartir: mozari.app/planes, /pro y /desarrollos
    const corto = { "/planes": "/#planes", "/precios": "/#planes", "/pro": "/entrar?comprar=pro", "/desarrollos": "/entrar?comprar=desarrollos" }[url.pathname.replace(/\/$/, "")];
    if (corto && request.method === "GET") return Response.redirect(url.origin + (corto.startsWith("/#") ? "/" + url.search + corto.slice(1) : corto), 302);

    if (segs[0] === "api" || segs[0] === "t") {
      const yo = await cuentaDe(request, env);
      if (!yo) return error(401, "Tu sesión terminó. Vuelve a entrar.");
      // Solo se aceptan cambios que vengan de la propia página del estudio
      const origen = request.headers.get("origin");
      if (request.method !== "GET" && request.method !== "HEAD" && origen && origen !== url.origin) return error(403, "Origen no permitido");
      if (segs[0] === "api") {
        try { return await api(request, env, segs, yo); }
        catch (e) { return error(500, "Algo falló en el servidor"); }
      }
      const id = segs[1], ruta = segs.slice(2).join("/");
      if (!ID_TOUR.test(id || "") || !rutaValida(ruta)) return error(400, "Ruta inválida");
      if (request.method !== "GET" && request.method !== "HEAD") return error(405, "Método no permitido");
      if (!(await esDueno(env, yo.uid, id)) && !(await duenoDeEquipo(env, yo, id))) return error(404, "No existe");
      const ed = rutasEdicion(ruta), cc = ruta.endsWith(".json") ? "no-store" : "private, max-age=31536000, immutable";
      if (ed) { for (const c of ed.slice(0, -1)) { const r = await servirR2(env, request, "tours/" + id + "/" + c, cc); if (r.status !== 404) return r; } return servirR2(env, request, "tours/" + id + "/" + ed[ed.length - 1], cc); }
      return servirR2(env, request, "tours/" + id + "/" + ruta, cc);
    }

    // Página principal: el escaparate para quien no ha entrado, el estudio para quien sí
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const yo = await cuentaDe(request, env);
      const r = await conAsset(env, request, yo ? "/" : "/escaparate");
      const h = new Headers(r.headers);
      h.set("cache-control", "no-store");
      // Quien aún no entra: se anota de qué anuncio o página llega (cookie propia de 30 días), para su cuenta
      if (!yo && request.method === "GET") for (const c of cookiesOrigen(request, url)) h.append("set-cookie", c);
      return new Response(r.body, { status: r.status, headers: h });
    }
    return env.ASSETS.fetch(request);
  },
};
