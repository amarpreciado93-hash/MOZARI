// Mozari · Worker de TOURS (público, solo lectura)
//
//   /<id>/                    el visor del tour (página estática de /visor)
//   /<id>/proyecto.json       la versión PUBLICADA (no el borrador)
//   /<id>/<ruta>              piezas de las esferas y archivos del tour
//
// Este Worker no tiene ninguna forma de escribir ni borrar: aunque alguien lo intente, no puede.

import { error, rutaValida, servirR2, ID_TOUR } from "./comun.js";

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") return error(405, "Solo lectura");
    const url = new URL(request.url);
    const segs = url.pathname.replace(/^\/+/, "").split("/");
    const id = segs[0];

    if (!id || !ID_TOUR.test(id)) return env.ASSETS.fetch(new Request(url.origin + "/inicio", request));
    if (segs.length === 1) return Response.redirect(url.origin + "/" + id + "/" + url.search, 301);

    const ruta = segs.slice(1).join("/");
    // Página del visor (la misma para todos los tours; ella lee proyecto.json de su carpeta)
    if (ruta === "" || ruta === "index.html") {
      if (!(await env.R2.head("publicado/" + id + "/proyecto.json"))) return error(404, "Este tour no está publicado");
      return env.ASSETS.fetch(new Request(url.origin + "/visor", request));
    }
    if (!rutaValida(ruta)) return error(400, "Ruta inválida");
    if (ruta === "proyecto.json") return servirR2(env, request, "publicado/" + id + "/proyecto.json", "no-cache");
    // Solo se sirven piezas de esferas y archivos del tour, nunca el borrador
    if (!ruta.startsWith("escenas/") && !ruta.startsWith("archivos/")) return error(404, "No existe");
    return servirR2(env, request, "tours/" + id + "/" + ruta, ruta.endsWith(".json") ? "no-cache" : "public, max-age=31536000, immutable");
  },
};
