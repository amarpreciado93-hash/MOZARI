// Mozari · Worker de TOURS (público, solo lectura)
//
//   /<id>/                    el visor del tour (el mismo programa del estudio en modo "tour")
//   /<id>/proyecto.json       la versión PUBLICADA (no el borrador)
//   /<id>/<ruta>              piezas de las esferas y archivos del tour
//
// Este Worker no tiene ninguna forma de escribir ni borrar: aunque alguien lo intente, no puede.

import { error, rutaValida, servirR2, ID_TOUR, conCarga, cargaEnViejos, rutasEdicion } from "./comun.js";

const pagina = (titulo, texto) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${titulo}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0B0B;color:#F2F5EC;font:15px/1.5 system-ui,sans-serif;text-align:center}p{color:#9CA38F}</style></head>
<body><div><h1 style="font-weight:600;letter-spacing:.2em">${titulo}</h1><p>${texto}</p></div></body></html>`;
const INICIO = pagina("MOZARI", "Abre el link completo de tu tour.");
const NO_PUBLICADO = pagina("Tour no disponible", "Este tour todavía no está publicado.");
const EN_PAUSA = pagina("Tour no disponible", "Este tour no está disponible por ahora.");
// Ícono de la pestaña (pedido de Amar, nov 2026): en las licencias de pago no queda rastro de Mozari. Si el cliente
// subió su ícono (Interfaz), sale ese; si no, uno neutro (una esfera de líneas). En la cuenta de prueba, el de Mozari.
const ICONO_NEUTRO = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#151515"/><g fill="none" stroke="#fff" stroke-width="3.2"><circle cx="32" cy="32" r="17"/><ellipse cx="32" cy="32" rx="7.5" ry="17"/><path d="M15 32h34"/></g></svg>');
export function iconoPropio(p, base) {
  if (!p || !p.proyecto || p.proyecto.marcaMozari !== false) return null;
  const i = p.skin && p.skin.icono;
  return typeof i === "string" && /^archivos\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|svg)$/.test(i) && rutaValida(i) ? base + i : ICONO_NEUTRO;
}
const conIcono = (rw, icono) => !icono ? rw : rw.on('link[rel="icon"]', { element: (el) => el.remove() }).on('link[rel="apple-touch-icon"]', { element: (el) => el.remove() })
  .on("head", { element: (el) => el.append('<link rel="icon" href="' + icono.replace(/"/g, "%22") + '">' + (icono.startsWith("data:") ? "" : '<link rel="apple-touch-icon" href="' + icono.replace(/"/g, "%22") + '">'), { html: true }) });
const html = (cuerpo, status) => new Response(cuerpo, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") return error(405, "Solo lectura");
    const url = new URL(request.url);
    const segs = url.pathname.replace(/^\/+/, "").split("/");
    const id = segs[0];

    // Íconos de la pestaña (los mismos de Mozari)
    if (segs.length === 1 && /^(favicon\.(ico|svg)|apple-touch-icon\.png|icon-(192|512)\.png|og\.jpg)$/.test(id)) return env.ASSETS.fetch(request);
    // Librerías del visor (la esfera 360, etc.): se sirven desde Mozari mismo, sin depender de otro servidor
    if (id === "lib" && segs.length === 2 && /^[a-z0-9.-]+\.js$/.test(segs[1])) return env.ASSETS.fetch(request);
    if (!id || !ID_TOUR.test(id)) return new Response(INICIO, { status: id ? 404 : 200, headers: { "content-type": "text/html; charset=utf-8" } });
    if (segs.length === 1) return Response.redirect(url.origin + "/" + id + "/" + url.search, 301);

    const ruta = segs.slice(1).join("/");
    // Cuenta en pausa (lo decide el dueño de Mozari) o tour en modo privado (lo decide su dueño): no se muestra
    if (ruta === "landing/") return Response.redirect(url.origin + "/" + id + "/landing" + url.search, 301);
    if (ruta === "" || ruta === "index.html" || ruta === "proyecto.json" || ruta === "landing") {
      const [pausa, privado] = await Promise.all([env.R2.head("pausados/" + id), env.R2.head("privados/" + id)]);
      if (pausa || privado) return ruta === "proyecto.json" ? error(404, "No disponible") : html(EN_PAUSA, 403);
    }
    // Landing del desarrollo (Laboratorio «landing»): una página ligera que lee proyecto.json de su carpeta.
    // Solo existe si el tour se publicó con la landing prendida; el 360 se carga dentro cuando lo piden.
    if (ruta === "landing") {
      const pub = await env.R2.get("publicado/" + id + "/proyecto.json");
      let p = null; try { p = pub ? await pub.json() : null; } catch (e) { p = null; }
      const L = p && p.proyecto && p.proyecto.landing;
      if (!L || !L.activa) return html(pagina("Página no disponible", "Este desarrollo no tiene landing publicada."), 404);
      let r = await env.ASSETS.fetch(new Request(url.origin + "/landing", { headers: request.headers }));
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) r = await env.ASSETS.fetch(new Request(new URL(r.headers.get("location"), url.origin), { headers: request.headers }));
      const pr = p.proyecto, nombre = String(pr.nombre || "Recorrido virtual").slice(0, 90);
      const desc = String((L.portada && L.portada.texto) || pr.descripcion || "Conoce el desarrollo y recórrelo en 360°.").replace(/\s+/g, " ").trim().slice(0, 200);
      const base = url.origin + "/" + id + "/";
      const foto = [L.portada && L.portada.foto, pr.thumbnail].find((x) => typeof x === "string" && rutaValida(x));
      const imagen = foto ? base + foto : pr.escenaInicial && /^[A-Za-z0-9_-]{1,80}$/.test(pr.escenaInicial) ? base + "escenas/" + pr.escenaInicial + "/1/f/0/0.jpg" : "";
      const meta = (v) => ({ element: (el) => el.setAttribute("content", v) });
      let rw = new HTMLRewriter().on("title", { element: (el) => el.setInnerContent(nombre) })
        .on('meta[property="og:title"]', meta(nombre)).on('meta[property="og:description"]', meta(desc)).on('meta[name="description"]', meta(desc))
        .on('meta[property="og:url"]', meta(base + "landing"));
      if (imagen) rw = rw.on('meta[property="og:image"]', meta(imagen));
      rw = conIcono(rw, iconoPropio(p, base));
      const out = rw.transform(r), h = new Headers(out.headers);
      h.set("cache-control", "no-cache"); h.set("content-type", "text/html; charset=utf-8");
      return new Response(out.body, { status: 200, headers: h });
    }
    // Página del visor (la misma para todos los tours; ella lee proyecto.json de su carpeta)
    if (ruta === "" || ruta === "index.html") {
      const pub = await env.R2.get("publicado/" + id + "/proyecto.json");
      if (!pub) return new Response(NO_PUBLICADO, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
      // Al compartir el link se ve el nombre del tour y su portada (o la vista de su esfera de inicio)
      let nombre = "Recorrido virtual 360", imagen = "", descripcion = "", p = null;
      try {
        p = await pub.json(); const pr = p.proyecto || {};
        if (pr.nombre) nombre = String(pr.nombre).slice(0, 90);
        if (typeof pr.descripcion === "string") descripcion = pr.descripcion.replace(/\s+/g, " ").trim().slice(0, 200);
        const base = url.origin + "/" + id + "/";
        if (typeof pr.thumbnail === "string" && rutaValida(pr.thumbnail)) imagen = base + pr.thumbnail;
        else if (pr.escenaInicial && /^[A-Za-z0-9_-]{1,80}$/.test(pr.escenaInicial)) imagen = base + "escenas/" + pr.escenaInicial + "/1/f/0/0.jpg";
      } catch (e) { /* sin datos: textos genéricos */ }
      const desc = descripcion || "Recorrido virtual 360 · Muévete por el lugar como si estuvieras ahí.";
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
      // Pantalla de carga con el logo del proyecto (si el plan y el Laboratorio lo permiten)
      const viejo = !!(p && p.proyecto && p.proyecto.cargaPropia === undefined && p.proyecto.marcaMozari === false);
      rw = conCarga(rw, p, viejo && (await cargaEnViejos(env).catch(() => false)));
      rw = conIcono(rw, iconoPropio(p, url.origin + "/" + id + "/"));
      const r = rw.transform(pagina);
      const h = new Headers(r.headers);
      h.set("cache-control", "no-cache");
      return new Response(r.body, { status: 200, headers: h });
    }
    if (!rutaValida(ruta)) return error(400, "Ruta inválida");
    if (ruta === "proyecto.json") return servirR2(env, request, "publicado/" + id + "/proyecto.json", "no-cache");
    // Solo se sirven piezas de esferas y archivos del tour, nunca el borrador
    if (!ruta.startsWith("escenas/") && !ruta.startsWith("archivos/")) return error(404, "No existe");
    // Esfera editada (piso retocado o ajustes de imagen): cada pieza sale de lo editado o, si no cambió, del original
    const ed = rutasEdicion(ruta);
    const claveDe = async () => { if (!ed) return "tours/" + id + "/" + ruta; for (const c of ed.slice(0, -1)) if (await env.R2.head("tours/" + id + "/" + c)) return "tours/" + id + "/" + c; return "tours/" + id + "/" + ed[ed.length - 1]; };
    if (ruta.endsWith(".json") || request.headers.has("range")) return servirR2(env, request, await claveDe(), ruta.endsWith(".json") ? "no-cache" : "public, max-age=31536000, immutable");
    // Piezas de las esferas: nunca cambian. Se guardan en la caché de Cloudflare cerca del visitante
    // (la segunda vez ya no se pide a R2) y, si R2 falla un instante, se reintenta antes de rendirse.
    const cache = caches.default, llave = new Request(url.origin + url.pathname, { method: "GET" });
    const guardada = await cache.match(llave);
    if (guardada) return guardada;
    let r = null;
    const clave = await claveDe();
    for (let i = 0; i < 3; i++) {
      try { r = await servirR2(env, new Request(llave), clave, "public, max-age=31536000, immutable"); } catch (e) { r = null; }
      if (r && (r.status === 200 || r.status === 404)) break;
      await new Promise((ok) => setTimeout(ok, 150 * (i + 1)));
    }
    if (!r) return error(503, "Intenta de nuevo");
    if (r.status === 200) ctx.waitUntil(cache.put(llave, r.clone()));
    return r;
  },
};
