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

import { json, error, rutaValida, tipoDe, servirR2, borrarPrefijo, ID_TOUR, conCarga, cargaEnViejos } from "./comun.js";
import { rutasSesion, cuentaDe, perfil, leerCupo, contarCuentas, firmarLink, verificarLink } from "./sesion.js";
import { leerConf, guardarConf, contador, enviar, TOPE_MES, TOPE_DIA, correoBienvenida, correoDeNovedad, correoCampana, enlaceBaja, iniciarCola, avanzarCola, avanzarColas, rutaBaja, CAMPANA, iniciarCampana } from "./correos.js";
import { PLANES, planDe, pasa, usaLotificacion } from "./planes.js";
import { apiPagos, webhookMercadoPago, CODIGO, cuponClave } from "./pagos.js";
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
  "carga-logo": { nombre: "Pantalla de carga con tu logo", texto: "El tour publicado carga con el logo y el nombre del proyecto (de la Interfaz), en sus colores, en lugar de Mozari. Se aplica al volver a publicar. En el plan Gratis sigue la de Mozari." },
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
};
// "pago": las cuentas Pro y Desarrollos (con su plan vigente); "todos" incluye también Gratis
const MODOS_LAB = ["yo", "probadores", "pago", "todos"];
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
async function labDe(env, yo) {
  const cfg = await leerLab(env), correo = String(yo.email || "").toLowerCase(), pago = !planDe(yo).marca;
  return Object.keys(cfg).filter((k) => yo.admin || cfg[k].modo === "todos" || (cfg[k].modo === "pago" && pago) || (cfg[k].modo === "probadores" && cfg[k].probadores.includes(correo)));
}

// Novedades: anuncios de herramientas nuevas que cada cuenta ve UNA vez (se anota en su perfil, no en el navegador)
//   novedades/<id>.json  { id, titulo, texto, media, mediaTipo, boton, destino, publico, activa, creada, publicada, vistas }
//   novedades/<id>.media el video o la imagen del anuncio
const MAX_MEDIA_NOV = 25 * 1024 * 1024;
const PUBLICOS_NOV = ["todos", "pagados", "gratis"];
async function listaNovedades(env) {
  const l = await env.R2.list({ prefix: "novedades/", limit: 1000 });
  const ns = await Promise.all(l.objects.filter((o) => o.key.endsWith(".json")).map(async (o) => (await env.R2.get(o.key)).json().catch(() => null)));
  return ns.filter(Boolean).sort((a, b) => String(b.publicada || b.creada).localeCompare(String(a.publicada || a.creada)));
}
const paraQuien = (n, plan) => n.publico === "pagados" ? plan.id !== "gratis" : n.publico === "gratis" ? plan.id === "gratis" : true;
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
async function resumenVisitas(env, id, dias) {
  const desde = new Date(Date.now() - (dias - 1) * 864e5).toISOString().slice(0, 10), claves = [];
  let cursor;
  do {
    const l = await env.R2.list({ prefix: "stats/" + id + "/", cursor, limit: 1000 });
    l.objects.forEach((o) => { if (o.key.split("/")[2] >= desde) claves.push(o.key); });
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor && claves.length < 5000);
  const regs = [];
  for (let i = 0; i < claves.length; i += 50) regs.push(...(await Promise.all(claves.slice(i, i + 50).map(async (k) => (await env.R2.get(k))?.json().catch(() => null)))).filter(Boolean));
  const suma = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  const r = { dias, total: regs.length, porDia: {}, disp: {}, origen: {}, ciudades: {}, esferas: {}, esferasVisitas: {}, lotes: {}, contacto: 0, conContacto: 0, durTotal: 0 };
  regs.forEach((x) => {
    suma(r.porDia, x.t.slice(0, 10)); suma(r.disp, x.disp); suma(r.origen, x.ref);
    suma(r.ciudades, (x.ciudad ? x.ciudad + ", " : "") + (x.pais || "—"));
    Object.entries(x.esferas || {}).forEach(([k, s]) => { suma(r.esferas, k, s); suma(r.esferasVisitas, k); });
    Object.entries(x.lotes || {}).forEach(([k, n]) => suma(r.lotes, k, n));
    r.contacto += x.contacto || 0; if (x.contacto) r.conContacto++; r.durTotal += x.dur || 0;
  });
  return r;
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
    let cur;
    do {
      const l = await env.R2.list({ prefix: "cuentas/", cursor: cur, limit: 1000, include: ["customMetadata"] });
      for (const o of l.objects) {
        const t = o.key.match(/^cuentas\/([^/]+)\/tours\/([^/]+)$/), md = o.customMetadata || {};
        if (!t || !md.publicado) continue;
        publicados.push({ id: t[2], nombre: md.nombre || "Tour", dueno: correo.get(t[1]) || "", publicado: md.publicado, portada: portadaDe(host + "/" + t[2] + "/", { thumbnail: md.portada }, md.inicial), url: host + "/" + t[2] + "/" });
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
const PLAN_TXT = { pro: "Pro", desarrollos: "Desarrollos", espacio: "Espacio" }, METODO_TXT = { mercadopago: "Mercado Pago", paypal: "PayPal", cupon: "Cupón" };
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
      await guardarConf(env, conf);
      return json({ conf });
    }
    if (partes[3] === "prueba" && partes.length === 4 && m === "POST") {
      const c = await request.json().catch(() => ({})), base = new URL(request.url).origin;
      let correo, baja = "";
      if (c.novedad) {
        const o = /^[a-z0-9]{6,20}$/.test(c.novedad) ? await env.R2.get("novedades/" + c.novedad + ".json") : null;
        if (!o) return error(404, "No existe esa actualización");
        baja = enlaceBaja(base, await firmaBaja(env)(yo.uid));
        correo = correoDeNovedad(await o.json(), yo, base, baja);
      } else correo = correoBienvenida({ nombre: yo.nombre, base });
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
      return json({ funciones: Object.entries(LABORATORIO).map(([clave, f]) => Object.assign({ clave }, f, cfg[clave])) });
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
      const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", cupones = [];
      while (cupones.length < cantidad) {
        const r = crypto.getRandomValues(new Uint8Array(6)), codigo = (pct >= 100 ? "MZ-" : "AL-") + [...r].map((x) => LETRAS[x % LETRAS.length]).join("");
        if (await env.R2.head(cuponClave(codigo))) continue;
        const cupon = { codigo, pct, planes, max: 1, vence, usos: 0, usadoPor: [], activo: true, nota, lote, creado };
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
    const cuentas = [], tours = [], lecturas = [], sesiones = {};
    // Los perfiles y las sesiones se leen todos a la vez (uno por uno tardaba 7 s con 75 cuentas)
    const leerJson = (k) => env.R2.get(k).then((r) => (r ? r.json() : null)).catch(() => null);
    let cur;
    do {
      const l = await env.R2.list({ prefix: "cuentas/", cursor: cur, limit: 1000, include: ["customMetadata"] });
      for (const o of l.objects) {
        if (o.key.endsWith("/perfil.json")) { lecturas.push(leerJson(o.key).then((p) => p && cuentas.push(p))); continue; }
        // Sesiones abiertas: de ahí sale la ciudad (y el país de quien entró antes de que se guardara en su perfil)
        if (o.key.endsWith("/sesiones.json")) { const uid = o.key.split("/")[1]; lecturas.push(leerJson(o.key).then((l) => { if (Array.isArray(l)) sesiones[uid] = l; })); continue; }
        // Índice de tours de cada cuenta: cuentas/<uid>/tours/<id> (su "publicado" dice si ya se publicó)
        const t = o.key.match(/^cuentas\/([^/]+)\/tours\/([^/]+)$/);
        if (t) tours.push({ uid: t[1], publicado: !!(o.customMetadata && o.customMetadata.publicado) });
      }
      cur = l.truncated ? l.cursor : undefined;
    } while (cur);
    await Promise.all(lecturas);
    const ultimaSesion = (uid) => (sesiones[uid] || []).filter((x) => x && (x.ciudad || x.pais)).sort((a, b) => String(b.ultima || b.creada).localeCompare(String(a.ultima || a.creada)))[0] || {};
    const dueno = new Set(cuentas.filter((p) => p.admin).map((p) => p.uid)), pub = tours.filter((t) => t.publicado);
    const resumenTours = { creados: tours.length, publicados: pub.length, publicadosClientes: pub.filter((t) => !dueno.has(t.uid)).length };
    cuentas.sort((a, b) => String(b.ultimaEntrada).localeCompare(String(a.ultimaEntrada)));
    return json({ tours: resumenTours, cuentas: cuentas.map((p) => ({ uid: p.uid, email: p.email, nombre: p.nombre, plan: p.plan, vence: p.vence || null, admin: !!p.admin, creado: p.creado, ultimaEntrada: p.ultimaEntrada,
      // Lo que pagó y por dónde (los pagos de antes del historial salen de su último pago, que fue por Mercado Pago)
      pausada: !!p.bloqueado, cortesia: !!p.cortesia, pais: p.pais || ultimaSesion(p.uid).pais || "", ciudad: ultimaSesion(p.uid).ciudad || "",
      pagos: Array.isArray(p.pagos) ? p.pagos : p.ultimoPago ? [Object.assign({ moneda: "MXN", metodo: "mercadopago" }, p.ultimoPago)] : [] })) });
  }
  if (partes.length === 4 && m === "PUT") {
    const uid = partes[3], cuerpo = await request.json().catch(() => ({}));
    if (!/^[A-Za-z0-9_-]{2,80}$/.test(uid) || !(PLANES[cuerpo.plan] || typeof cuerpo.pausada === "boolean")) return error(400, "Datos inválidos");
    const p = await perfil(env, uid);
    if (!p) return error(404, "No existe esa cuenta");
    if (p.admin) return error(400, "La cuenta del dueño no se cambia aquí");
    if (PLANES[cuerpo.plan]) {
      p.plan = cuerpo.plan;
      delete p.vence;   // lo que asigna el dueño a mano no caduca
      p.cortesia = cuerpo.plan !== "gratis"; // dado por el dueño sin pago
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
  if (partes[1] === "yo" && m === "GET") return json({ email: yo.email, nombre: yo.nombre, foto: yo.foto, admin: !!yo.admin, plan, lab: await labDe(env, yo), guias: yo.guiasVistas || [] });
  // Tutoriales guiados: cada cuenta ve el de cada herramienta una sola vez (se anota en su perfil)
  if (partes[1] === "guias" && partes.length === 3 && m === "POST" && /^[a-z0-9-]{2,40}$/.test(partes[2])) {
    const clave = "cuentas/" + yo.uid + "/perfil.json", o = await env.R2.get(clave); if (!o) return error(404, "Sin cuenta");
    const p = await o.json(); p.guiasVistas = [...new Set((p.guiasVistas || []).concat([partes[2]]))].slice(0, 100);
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
      return json({ tours });
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
  if (!(await esDueno(env, uid, id))) return error(404, "No existe ese tour");
  const base = "tours/" + id + "/";

  if (partes.length === 3) {
    if (m === "GET") return servirR2(env, request, base + "proyecto.json", "no-store");
    if (m === "PUT") {
      const largo = +request.headers.get("content-length") || 0;
      if (largo > MAX_PROYECTO) return error(413, "El proyecto pesa demasiado");
      const txt = await request.text();
      if (txt.length > MAX_PROYECTO) return error(413, "El proyecto pesa demasiado");
      let p;
      try { p = JSON.parse(txt); } catch (e) { return error(400, "JSON inválido"); }
      if (!p || !p.proyecto || !Array.isArray(p.escenas)) return error(400, "Proyecto incompleto");
      if (!pasa(plan.esferas, p.escenas.length)) return limite(plan.marca ? "Tu cuenta de prueba incluye " + plan.esferas + " esferas por tour. Para practicar más, borra una que ya no uses, o pasa a Pro para subir sin límite." : "Tu plan " + plan.nombre + " incluye " + plan.esferas + " esferas por tour. Mejora tu plan para subir más.", "esferas");
      await env.R2.put(base + "proyecto.json", txt, { httpMetadata: { contentType: tipoDe("x.json") } });
      const portada = typeof p.proyecto.thumbnail === "string" && rutaValida(p.proyecto.thumbnail) ? p.proyecto.thumbnail : "";
      await guardarIndice(env, uid, id, { nombre: p.proyecto.nombre || "Tour", escenas: p.escenas.length, inicial: p.proyecto.escenaInicial || "", portada });
      return json({ ok: true });
    }
    if (m === "DELETE") {
      const n = await borrarPrefijo(env, base) + await borrarPrefijo(env, "publicado/" + id + "/");
      await env.R2.delete([indiceDe(uid, id), "privados/" + id]);
      await usoDe(env, uid, true);
      return json({ ok: true, borrados: n });
    }
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
    const nombre = String(pr.nombre || "Recorrido virtual 360").slice(0, 90);
    const desc = (typeof pr.descripcion === "string" && pr.descripcion.replace(/\s+/g, " ").trim().slice(0, 200)) || "Recorrido virtual 360";
    const pon = (v) => ({ element: (el) => el.setAttribute("content", v) });
    const quita = { element: (el) => el.remove() };
    const pagina = await env.ASSETS.fetch(new Request(new URL("/", request.url)));
    const html = await conCarga(new HTMLRewriter(), p, pr.cargaPropia === undefined && (await cargaEnViejos(env).catch(() => false)))
      .on("body", { element: (el) => { el.setAttribute("data-modo", "tour"); el.setAttribute("data-exportado", "1"); } })
      .on("title", { element: (el) => el.setInnerContent(nombre) })
      .on('meta[property="og:title"]', pon(nombre)).on('meta[property="og:site_name"]', pon(nombre))
      .on('meta[property="og:description"]', pon(desc)).on('meta[name="description"]', pon(desc))
      .on('meta[property^="og:image"]', quita).on('meta[name="twitter:image"]', quita).on('meta[property="og:url"]', quita)
      .on('link[href^="/"]', { element: (el) => el.setAttribute("href", "https://mozari.app" + el.getAttribute("href")) })
      // Las librerías viajan dentro del .zip, junto al index.html
      .on('script[src^="/lib/"]', { element: (el) => el.setAttribute("src", el.getAttribute("src").slice(1)) })
      .transform(pagina).text();
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
    await env.R2.put("publicado/" + id + "/proyecto.json", JSON.stringify(p), { httpMetadata: { contentType: tipoDe("x.json"), cacheControl: "no-cache" } });
    await guardarIndice(env, uid, id, { publicado: new Date().toISOString() });
    return json({ ok: true });
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

    const s = await rutasSesion(request, env, (p) => adoptarTours(env, p));
    if (s) return s;

    if (url.pathname === "/webhooks/mercadopago") return webhookMercadoPago(request, env);

    // Links cortos para compartir: mozari.app/planes, /pro y /desarrollos
    const corto = { "/planes": "/#planes", "/precios": "/#planes", "/pro": "/entrar?comprar=pro", "/desarrollos": "/entrar?comprar=desarrollos" }[url.pathname.replace(/\/$/, "")];
    if (corto && request.method === "GET") return Response.redirect(url.origin + corto, 302);

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
      if (!(await esDueno(env, yo.uid, id))) return error(404, "No existe");
      return servirR2(env, request, "tours/" + id + "/" + ruta, ruta.endsWith(".json") ? "no-store" : "private, max-age=31536000, immutable");
    }

    // Página principal: el escaparate para quien no ha entrado, el estudio para quien sí
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const yo = await cuentaDe(request, env);
      const r = await conAsset(env, request, yo ? "/" : "/escaparate");
      const h = new Headers(r.headers);
      h.set("cache-control", "no-store");
      return new Response(r.body, { status: r.status, headers: h });
    }
    return env.ASSETS.fetch(request);
  },
};
