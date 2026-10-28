// Mozari · Worker del ESTUDIO (privado, detrás de Cloudflare Access)
//
//   /                         la app del estudio (archivos estáticos de /estudio)
//   GET    /api/yo            quién entró
//   GET    /api/tours         lista de tours
//   POST   /api/tours         crea un tour            { nombre }
//   GET    /api/tours/:id     proyecto (borrador)
//   PUT    /api/tours/:id     guarda el proyecto
//   DELETE /api/tours/:id     borra el tour completo
//   PUT    /api/tours/:id/f/<ruta>        sube un archivo (piezas de esfera, imágenes, audio)
//   DELETE /api/tours/:id/f/<prefijo>/    borra una carpeta (por ejemplo una esfera)
//   POST   /api/tours/:id/publicar        congela el borrador como versión pública
//   GET    /api/uso           espacio usado en R2
//   GET    /t/:id/<ruta>      lee archivos del tour (el estudio los usa para mostrar las esferas)

import { json, error, rutaValida, tipoDe, servirR2, borrarPrefijo, ID_TOUR } from "./comun.js";
import { usuario } from "./acceso.js";

const MAX_PROYECTO = 8 * 1024 * 1024;   // 8 MB de JSON (incluye miniaturas en base64)
const MAX_ARCHIVO = 25 * 1024 * 1024;   // 25 MB por archivo
const LIMITE_GRATIS = 10 * 1024 ** 3;   // 10 GB gratis en R2

function idNuevo(nombre) {
  const base = String(nombre || "tour").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "tour";
  const azar = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 5);
  return (base.length < 3 ? "tour-" + base : base) + "-" + azar;
}

async function guardarIndice(env, id, datos) {
  const prev = await env.R2.head("indice/" + id);
  const meta = Object.assign({}, prev ? prev.customMetadata : {}, datos, { actualizado: new Date().toISOString() });
  Object.keys(meta).forEach((k) => (meta[k] = String(meta[k]).slice(0, 400)));
  await env.R2.put("indice/" + id, "", { customMetadata: meta });
}

async function api(request, env, partes, quien) {
  const m = request.method;
  // /api/yo
  if (partes[1] === "yo" && m === "GET") return json({ email: quien.email });

  // /api/uso
  if (partes[1] === "uso" && m === "GET") {
    let cursor, bytes = 0, objetos = 0;
    do {
      const l = await env.R2.list({ cursor, limit: 1000 });
      l.objects.forEach((o) => { bytes += o.size; objetos++; });
      cursor = l.truncated ? l.cursor : undefined;
    } while (cursor);
    return json({ bytes, objetos, limiteGratis: LIMITE_GRATIS });
  }

  if (partes[1] !== "tours") return error(404, "Ruta desconocida");

  // /api/tours
  if (partes.length === 2) {
    if (m === "GET") {
      const l = await env.R2.list({ prefix: "indice/", include: ["customMetadata"], limit: 1000 });
      const tours = l.objects.map((o) => Object.assign({ id: o.key.slice(7) }, o.customMetadata))
        .sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado)));
      return json({ tours });
    }
    if (m === "POST") {
      const cuerpo = await request.json().catch(() => ({}));
      const nombre = String(cuerpo.nombre || "Tour nuevo").slice(0, 80);
      const id = idNuevo(nombre);
      const proyecto = { version: 2, proyecto: { nombre, escenaInicial: "", musica: { volumen: 0.6, repetir: true } }, escenas: [], capas: {} };
      await env.R2.put("tours/" + id + "/proyecto.json", JSON.stringify(proyecto), { httpMetadata: { contentType: tipoDe("x.json") } });
      await guardarIndice(env, id, { nombre, creado: new Date().toISOString(), publicado: "" });
      return json({ id, proyecto }, 201);
    }
    return error(405, "Método no permitido");
  }

  const id = partes[2];
  if (!ID_TOUR.test(id)) return error(400, "Tour inválido");
  const base = "tours/" + id + "/";

  // /api/tours/:id
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
      if (!(await env.R2.head("indice/" + id))) return error(404, "No existe ese tour");
      await env.R2.put(base + "proyecto.json", txt, { httpMetadata: { contentType: tipoDe("x.json") } });
      await guardarIndice(env, id, { nombre: p.proyecto.nombre || "Tour", escenas: p.escenas.length, inicial: p.proyecto.escenaInicial || "" });
      return json({ ok: true });
    }
    if (m === "DELETE") {
      const n = await borrarPrefijo(env, base) + await borrarPrefijo(env, "publicado/" + id + "/");
      await env.R2.delete("indice/" + id);
      return json({ ok: true, borrados: n });
    }
    return error(405, "Método no permitido");
  }

  // /api/tours/:id/publicar
  if (partes[3] === "publicar" && partes.length === 4 && m === "POST") {
    const obj = await env.R2.get(base + "proyecto.json");
    if (!obj) return error(404, "No existe ese tour");
    await env.R2.put("publicado/" + id + "/proyecto.json", await obj.text(), { httpMetadata: { contentType: tipoDe("x.json"), cacheControl: "no-cache" } });
    await guardarIndice(env, id, { publicado: new Date().toISOString() });
    return json({ ok: true });
  }

  // /api/tours/:id/f/<ruta>
  if (partes[3] === "f" && partes.length > 4) {
    const ruta = partes.slice(4).join("/");
    const valida = (m === "DELETE" && ruta.endsWith("/")) ? rutaValida(ruta.slice(0, -1)) : rutaValida(ruta);
    if (valida) {
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
    return error(400, "Ruta de archivo inválida");
  }
  return error(404, "Ruta desconocida");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const segs = url.pathname.replace(/^\/+/, "").split("/");

    if (segs[0] === "api" || segs[0] === "t") {
      const quien = await usuario(request, env);
      if (!quien) return error(401, "Necesitas entrar con tu cuenta de Mozari");
      if (segs[0] === "api") {
        try { return await api(request, env, segs, quien); }
        catch (e) { return error(500, "Algo falló en el servidor"); }
      }
      // /t/:id/<ruta> — archivos del borrador para mostrar las esferas en el estudio
      const id = segs[1], ruta = segs.slice(2).join("/");
      if (!ID_TOUR.test(id || "") || !rutaValida(ruta)) return error(400, "Ruta inválida");
      if (request.method !== "GET" && request.method !== "HEAD") return error(405, "Método no permitido");
      return servirR2(env, request, "tours/" + id + "/" + ruta, ruta.endsWith(".json") ? "no-store" : "private, max-age=31536000, immutable");
    }
    return env.ASSETS.fetch(request);
  },
};
