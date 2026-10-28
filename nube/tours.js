// Mozari · Worker de TOURS (público, solo lectura)
//
//   /<id>/                    el visor del tour (el mismo programa del estudio en modo "tour")
//   /<id>/proyecto.json       la versión PUBLICADA (no el borrador)
//   /<id>/<ruta>              piezas de las esferas y archivos del tour
//
// Este Worker no tiene ninguna forma de escribir ni borrar: aunque alguien lo intente, no puede.

import { error, rutaValida, servirR2, ID_TOUR } from "./comun.js";

const pagina = (titulo, texto) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${titulo}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0B0B;color:#F2F5EC;font:15px/1.5 system-ui,sans-serif;text-align:center}p{color:#9CA38F}</style></head>
<body><div><h1 style="font-weight:600;letter-spacing:.2em">${titulo}</h1><p>${texto}</p></div></body></html>`;
const INICIO = pagina("MOZARI", "Abre el link completo de tu tour.");
const NO_PUBLICADO = pagina("Tour no disponible", "Este tour todavía no está publicado.");

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") return error(405, "Solo lectura");
    const url = new URL(request.url);
    const segs = url.pathname.replace(/^\/+/, "").split("/");
    const id = segs[0];

    if (!id || !ID_TOUR.test(id)) return new Response(INICIO, { status: id ? 404 : 200, headers: { "content-type": "text/html; charset=utf-8" } });
    if (segs.length === 1) return Response.redirect(url.origin + "/" + id + "/" + url.search, 301);

    const ruta = segs.slice(1).join("/");
    // Página del visor (la misma para todos los tours; ella lee proyecto.json de su carpeta)
    if (ruta === "" || ruta === "index.html") {
      if (!(await env.R2.head("publicado/" + id + "/proyecto.json"))) return new Response(NO_PUBLICADO, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
      // El mismo programa del estudio, pero en modo "tour": solo el visor, sin herramientas
      const pagina = await env.ASSETS.fetch(new Request(url.origin + "/", { headers: request.headers }));
      const r = new HTMLRewriter().on("body", { element: (el) => el.setAttribute("data-modo", "tour") }).transform(pagina);
      const h = new Headers(r.headers);
      h.set("cache-control", "no-cache");
      return new Response(r.body, { status: 200, headers: h });
    }
    if (!rutaValida(ruta)) return error(400, "Ruta inválida");
    if (ruta === "proyecto.json") return servirR2(env, request, "publicado/" + id + "/proyecto.json", "no-cache");
    // Solo se sirven piezas de esferas y archivos del tour, nunca el borrador
    if (!ruta.startsWith("escenas/") && !ruta.startsWith("archivos/")) return error(404, "No existe");
    return servirR2(env, request, "tours/" + id + "/" + ruta, ruta.endsWith(".json") ? "no-cache" : "public, max-age=31536000, immutable");
  },
};
