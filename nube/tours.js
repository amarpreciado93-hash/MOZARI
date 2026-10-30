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
const EN_PAUSA = pagina("Tour no disponible", "Este tour no está disponible por ahora.");
const html = (cuerpo, status) => new Response(cuerpo, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") return error(405, "Solo lectura");
    const url = new URL(request.url);
    const segs = url.pathname.replace(/^\/+/, "").split("/");
    const id = segs[0];

    // Íconos de la pestaña (los mismos de Mozari)
    if (segs.length === 1 && /^(favicon\.(ico|svg)|apple-touch-icon\.png|icon-(192|512)\.png|og\.jpg)$/.test(id)) return env.ASSETS.fetch(request);
    if (!id || !ID_TOUR.test(id)) return new Response(INICIO, { status: id ? 404 : 200, headers: { "content-type": "text/html; charset=utf-8" } });
    if (segs.length === 1) return Response.redirect(url.origin + "/" + id + "/" + url.search, 301);

    const ruta = segs.slice(1).join("/");
    // Cuenta en pausa (lo decide el dueño de Mozari): sus tours no se muestran
    if ((ruta === "" || ruta === "index.html" || ruta === "proyecto.json") && (await env.R2.head("pausados/" + id))) return ruta === "proyecto.json" ? error(404, "No disponible") : html(EN_PAUSA, 403);
    // Página del visor (la misma para todos los tours; ella lee proyecto.json de su carpeta)
    if (ruta === "" || ruta === "index.html") {
      const pub = await env.R2.get("publicado/" + id + "/proyecto.json");
      if (!pub) return new Response(NO_PUBLICADO, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
      // Al compartir el link se ve el nombre del tour y su portada (o la vista de su esfera de inicio)
      let nombre = "Recorrido virtual 360", imagen = "";
      try {
        const p = await pub.json(), pr = p.proyecto || {};
        if (pr.nombre) nombre = String(pr.nombre).slice(0, 90);
        const base = url.origin + "/" + id + "/";
        if (typeof pr.thumbnail === "string" && rutaValida(pr.thumbnail)) imagen = base + pr.thumbnail;
        else if (pr.escenaInicial && /^[A-Za-z0-9_-]{1,80}$/.test(pr.escenaInicial)) imagen = base + "escenas/" + pr.escenaInicial + "/1/f/0/0.jpg";
      } catch (e) { /* sin datos: textos genéricos */ }
      const desc = "Recorrido virtual 360 · Muévete por el lugar como si estuvieras ahí.";
      const meta = (sel, v) => ({ element: (el) => el.setAttribute("content", v) });
      // El mismo programa del estudio, pero en modo "tour": solo el visor, sin herramientas
      const pagina = await env.ASSETS.fetch(new Request(url.origin + "/", { headers: request.headers }));
      let rw = new HTMLRewriter().on("body", { element: (el) => el.setAttribute("data-modo", "tour") })
        .on("title", { element: (el) => el.setInnerContent(nombre) })
        .on('meta[property="og:title"]', meta(0, nombre))
        .on('meta[property="og:description"]', meta(0, desc))
        .on('meta[name="description"]', meta(0, desc))
        .on('meta[property="og:url"]', meta(0, url.origin + "/" + id + "/"))
        .on('meta[property="og:site_name"]', meta(0, nombre));
      if (imagen) rw = rw.on('meta[property="og:image"]', meta(0, imagen)).on('meta[name="twitter:image"]', meta(0, imagen))
        .on('meta[property="og:image:width"]', { element: (el) => el.remove() }).on('meta[property="og:image:height"]', { element: (el) => el.remove() })
        .on('meta[property="og:image:alt"]', meta(0, nombre));
      const r = rw.transform(pagina);
      const h = new Headers(r.headers);
      h.set("cache-control", "no-cache");
      return new Response(r.body, { status: 200, headers: h });
    }
    if (!rutaValida(ruta)) return error(400, "Ruta inválida");
    if (ruta === "proyecto.json") return servirR2(env, request, "publicado/" + id + "/proyecto.json", "no-cache");
    // Solo se sirven piezas de esferas y archivos del tour, nunca el borrador
    if (!ruta.startsWith("escenas/") && !ruta.startsWith("archivos/")) return error(404, "No existe");
    if (ruta.endsWith(".json") || request.headers.has("range")) return servirR2(env, request, "tours/" + id + "/" + ruta, ruta.endsWith(".json") ? "no-cache" : "public, max-age=31536000, immutable");
    // Piezas de las esferas: nunca cambian. Se guardan en la caché de Cloudflare cerca del visitante
    // (la segunda vez ya no se pide a R2) y, si R2 falla un instante, se reintenta antes de rendirse.
    const cache = caches.default, llave = new Request(url.origin + url.pathname, { method: "GET" });
    const guardada = await cache.match(llave);
    if (guardada) return guardada;
    let r = null;
    for (let i = 0; i < 3; i++) {
      try { r = await servirR2(env, new Request(llave), "tours/" + id + "/" + ruta, "public, max-age=31536000, immutable"); } catch (e) { r = null; }
      if (r && (r.status === 200 || r.status === 404)) break;
      await new Promise((ok) => setTimeout(ok, 150 * (i + 1)));
    }
    if (!r) return error(503, "Intenta de nuevo");
    if (r.status === 200) ctx.waitUntil(cache.put(llave, r.clone()));
    return r;
  },
};
