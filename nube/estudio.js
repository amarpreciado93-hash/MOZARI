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
//   GET    /api/uso           espacio que usan tus tours
//   GET    /t/:id/<ruta>      archivos de tu tour (el estudio los usa para mostrar las esferas)
//
// Cada tour pertenece a una cuenta: cuentas/<uid>/tours/<id>. Nadie puede leer, cambiar ni borrar
// tours de otra cuenta. Los tours publicados se ven en el Worker de tours (público, solo lectura).

import { json, error, rutaValida, tipoDe, servirR2, borrarPrefijo, ID_TOUR } from "./comun.js";
import { rutasSesion, cuentaDe } from "./sesion.js";

const MAX_PROYECTO = 8 * 1024 * 1024;   // 8 MB de JSON
const MAX_ARCHIVO = 25 * 1024 * 1024;   // 25 MB por archivo

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

async function api(request, env, partes, yo) {
  const m = request.method, uid = yo.uid;
  if (partes[1] === "yo" && m === "GET") return json({ email: yo.email, nombre: yo.nombre, foto: yo.foto, plan: yo.plan, admin: !!yo.admin });

  if (partes[1] === "uso" && m === "GET") {
    let bytes = 0, objetos = 0, tours = 0, cur;
    do {
      const l = await env.R2.list({ prefix: "cuentas/" + uid + "/tours/", cursor: cur, limit: 1000 });
      for (const t of l.objects) {
        tours++;
        let c;
        do {
          const f = await env.R2.list({ prefix: "tours/" + t.key.split("/").pop() + "/", cursor: c, limit: 1000 });
          f.objects.forEach((o) => { bytes += o.size; objetos++; });
          c = f.truncated ? f.cursor : undefined;
        } while (c);
      }
      cur = l.truncated ? l.cursor : undefined;
    } while (cur);
    return json({ bytes, objetos, tours });
  }

  if (partes[1] !== "tours") return error(404, "Ruta desconocida");

  if (partes.length === 2) {
    if (m === "GET") {
      const l = await env.R2.list({ prefix: "cuentas/" + uid + "/tours/", include: ["customMetadata"], limit: 1000 });
      const tours = l.objects.map((o) => Object.assign({ id: o.key.split("/").pop() }, o.customMetadata))
        .sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado)));
      return json({ tours });
    }
    if (m === "POST") {
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
      await env.R2.put(base + "proyecto.json", txt, { httpMetadata: { contentType: tipoDe("x.json") } });
      await guardarIndice(env, uid, id, { nombre: p.proyecto.nombre || "Tour", escenas: p.escenas.length, inicial: p.proyecto.escenaInicial || "" });
      return json({ ok: true });
    }
    if (m === "DELETE") {
      const n = await borrarPrefijo(env, base) + await borrarPrefijo(env, "publicado/" + id + "/");
      await env.R2.delete(indiceDe(uid, id));
      return json({ ok: true, borrados: n });
    }
    return error(405, "Método no permitido");
  }

  if (partes[3] === "publicar" && partes.length === 4 && m === "POST") {
    const obj = await env.R2.get(base + "proyecto.json");
    if (!obj) return error(404, "No existe ese tour");
    await env.R2.put("publicado/" + id + "/proyecto.json", await obj.text(), { httpMetadata: { contentType: tipoDe("x.json"), cacheControl: "no-cache" } });
    await guardarIndice(env, uid, id, { publicado: new Date().toISOString() });
    return json({ ok: true });
  }

  if (partes[3] === "f" && partes.length > 4) {
    const ruta = partes.slice(4).join("/");
    const valida = (m === "DELETE" && ruta.endsWith("/")) ? rutaValida(ruta.slice(0, -1)) : rutaValida(ruta);
    if (!valida) return error(400, "Ruta de archivo inválida");
    if (m === "PUT") {
      const largo = +request.headers.get("content-length") || 0;
      if (!largo || largo > MAX_ARCHIVO) return error(413, "Archivo vacío o muy pesado");
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

    const s = await rutasSesion(request, env, (p) => adoptarTours(env, p));
    if (s) return s;

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
