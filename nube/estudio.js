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
//   PUT    /api/admin/laboratorio/:clave   { modo: yo|probadores|todos, probadores: [correos] }
//   GET    /t/:id/<ruta>      archivos de tu tour (el estudio los usa para mostrar las esferas)
//
// Cada tour pertenece a una cuenta: cuentas/<uid>/tours/<id>. Nadie puede leer, cambiar ni borrar
// tours de otra cuenta. Los tours publicados se ven en el Worker de tours (público, solo lectura).

import { json, error, rutaValida, tipoDe, servirR2, borrarPrefijo, ID_TOUR } from "./comun.js";
import { rutasSesion, cuentaDe, perfil } from "./sesion.js";
import { PLANES, planDe, pasa, usaLotificacion } from "./planes.js";
import { apiPagos, webhookMercadoPago, CODIGO, cuponClave } from "./pagos.js";
import { EmailMessage } from "cloudflare:email";

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
  "manzana-isla": { nombre: "Manzana en isla", texto: "Manzanas redondas u orgánicas: dibujas el contorno y los lotes se cortan hacia el centro." },
};
const MODOS_LAB = ["yo", "probadores", "todos"];
async function leerLab(env) {
  const o = await env.R2.get("config/laboratorio.json");
  const c = o ? await o.json().catch(() => ({})) : {};
  return Object.fromEntries(Object.keys(LABORATORIO).map((k) => {
    const f = (c && c[k]) || {};
    return [k, { modo: MODOS_LAB.includes(f.modo) ? f.modo : "yo", probadores: Array.isArray(f.probadores) ? f.probadores : [] }];
  }));
}
async function labDe(env, yo) {
  const cfg = await leerLab(env), correo = String(yo.email || "").toLowerCase();
  return Object.keys(cfg).filter((k) => yo.admin || cfg[k].modo === "todos" || (cfg[k].modo === "probadores" && cfg[k].probadores.includes(correo)));
}

async function admin(request, env, partes) {
  const m = request.method;
  if (partes[2] === "laboratorio") {
    if (partes.length === 3 && m === "GET") {
      const cfg = await leerLab(env);
      return json({ funciones: Object.entries(LABORATORIO).map(([clave, f]) => Object.assign({ clave }, f, cfg[clave])) });
    }
    if (partes.length === 4 && m === "PUT" && LABORATORIO[partes[3]]) {
      const cuerpo = await request.json().catch(() => ({}));
      const o = await env.R2.get("config/laboratorio.json");
      const c = (o ? await o.json().catch(() => ({})) : {}) || {};
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
    const cuentas = [];
    let cur;
    do {
      const l = await env.R2.list({ prefix: "cuentas/", cursor: cur, limit: 1000 });
      for (const o of l.objects) if (o.key.endsWith("/perfil.json")) { const p = await (await env.R2.get(o.key)).json(); cuentas.push(p); }
      cur = l.truncated ? l.cursor : undefined;
    } while (cur);
    cuentas.sort((a, b) => String(b.ultimaEntrada).localeCompare(String(a.ultimaEntrada)));
    return json({ cuentas: cuentas.map((p) => ({ uid: p.uid, email: p.email, nombre: p.nombre, plan: p.plan, vence: p.vence || null, admin: !!p.admin, creado: p.creado, ultimaEntrada: p.ultimaEntrada,
      // Lo que pagó y por dónde (los pagos de antes del historial salen de su último pago, que fue por Mercado Pago)
      pausada: !!p.bloqueado, cortesia: !!p.cortesia,
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
  if (partes[1] === "yo" && m === "GET") return json({ email: yo.email, nombre: yo.nombre, foto: yo.foto, admin: !!yo.admin, plan, lab: await labDe(env, yo) });
  if (partes[1] === "pagos") return apiPagos(request, env, partes, yo);
  if (partes[1] === "reportes" && partes.length === 2 && m === "POST") return crearReporte(request, env, yo, plan);
  if (partes[1] === "admin") return yo.admin ? admin(request, env, partes) : error(403, "Solo el dueño de Mozari");

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
        if (l.objects.length >= plan.tours) return limite("Tu plan " + plan.nombre + " incluye " + plan.tours + (plan.tours === 1 ? " tour" : " tours") + ". Mejora tu plan para crear más.", "tours");
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
      if (!pasa(plan.esferas, p.escenas.length)) return limite("Tu plan " + plan.nombre + " incluye " + plan.esferas + " esferas por tour. Mejora tu plan para subir más.", "esferas");
      await env.R2.put(base + "proyecto.json", txt, { httpMetadata: { contentType: tipoDe("x.json") } });
      const portada = typeof p.proyecto.thumbnail === "string" && rutaValida(p.proyecto.thumbnail) ? p.proyecto.thumbnail : "";
      await guardarIndice(env, uid, id, { nombre: p.proyecto.nombre || "Tour", escenas: p.escenas.length, inicial: p.proyecto.escenaInicial || "", portada });
      return json({ ok: true });
    }
    if (m === "DELETE") {
      const n = await borrarPrefijo(env, base) + await borrarPrefijo(env, "publicado/" + id + "/");
      await env.R2.delete(indiceDe(uid, id));
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
    const html = await new HTMLRewriter()
      .on("body", { element: (el) => { el.setAttribute("data-modo", "tour"); el.setAttribute("data-exportado", "1"); } })
      .on("title", { element: (el) => el.setInnerContent(nombre) })
      .on('meta[property="og:title"]', pon(nombre)).on('meta[property="og:site_name"]', pon(nombre))
      .on('meta[property="og:description"]', pon(desc)).on('meta[name="description"]', pon(desc))
      .on('meta[property^="og:image"]', quita).on('meta[name="twitter:image"]', quita).on('meta[property="og:url"]', quita)
      .on('link[href^="/"]', { element: (el) => el.setAttribute("href", "https://mozari.app" + el.getAttribute("href")) })
      .transform(pagina).text();
    return json({ nombre, html, proyecto: p, archivos, bytes: archivos.reduce((s, a) => s + a.bytes, 0) });
  }

  if (partes[3] === "publicar" && partes.length === 4 && m === "POST") {
    const obj = await env.R2.get(base + "proyecto.json");
    if (!obj) return error(404, "No existe ese tour");
    const p = await obj.json();
    // Versión de prueba: todo se puede usar y publicar, pero lo que el plan no cubre sale con marca de agua
    // (Gratis siempre; un tour con lotes sin el plan Desarrollos). Lo decide el servidor, no la página.
    p.proyecto.marcaMozari = !!plan.marca || (!plan.lotificacion && usaLotificacion(p));
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
        if (u.bytes + largo > plan.bytes) return limite("Llegaste al espacio de tu plan " + plan.nombre + " (" + gb(plan.bytes) + "). Mejora tu plan para subir más.", "espacio");
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const segs = url.pathname.replace(/^\/+/, "").split("/");

    // Dominio propio: las páginas viejas (workers.dev, www) mandan a mozari.app.
    // La API, los archivos, el aviso de Mercado Pago y la entrada con Google en curso no se mueven.
    if (env.DOMINIO && url.hostname !== env.DOMINIO && url.hostname !== "localhost" && request.method === "GET" && !["api", "t", "webhooks", "auth"].includes(segs[0])) {
      return Response.redirect("https://" + env.DOMINIO + url.pathname + url.search, 302);
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
