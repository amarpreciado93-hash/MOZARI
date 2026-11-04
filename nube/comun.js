// Mozari · piezas compartidas por los dos Workers (estudio y tours)
//
// Estructura en R2 (bucket "mozari"):
//   tours/<id>/proyecto.json              borrador que edita el estudio
//   tours/<id>/escenas/<esc>/...          piezas de cada esfera (preview, niveles, escena.json)
//   tours/<id>/archivos/...               imágenes de acciones, logos, música
//   publicado/<id>/proyecto.json          copia congelada que ve el público
//   indice/<id>                           vacío; su metadata guarda nombre, portada y fechas

export const TIPOS = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", svg: "image/svg+xml",
  json: "application/json; charset=utf-8", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
  mp4: "video/mp4", html: "text/html; charset=utf-8", pdf: "application/pdf",
};

export const ID_TOUR = /^[a-z0-9][a-z0-9-]{2,60}$/;
// Rutas de archivo: solo letras, números, guiones, puntos y diagonales; sin "..".
export const RUTA = /^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,200}$/;

export const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": TIPOS.json, "cache-control": "no-store", ...extra } });

export const error = (status, mensaje) => json({ error: mensaje }, status);

export function rutaValida(r) {
  return RUTA.test(r) && !r.includes("..") && !r.includes("//");
}

export function tipoDe(ruta) {
  const ext = ruta.split(".").pop().toLowerCase();
  return TIPOS[ext] || "application/octet-stream";
}

// Pantalla de carga con la marca del cliente (Laboratorio «carga-logo»). El servidor la escribe dentro
// de la página, así desde el primer instante se ve el logo del proyecto y nunca el de Mozari.
// Plan Gratis (o tour con marca de prueba): se queda la de Mozari, es lo que se paga por quitar.
const HEX = /^#[0-9a-fA-F]{6}$/;
const luz = (c) => { const n = parseInt(c.slice(1), 16), v = [n >> 16, (n >> 8) & 255, n & 255].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const contraste = (a, b) => { const [x, y] = [luz(a), luz(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
// Tours publicados antes de esta función (no traen la marca cargaPropia): también la llevan si su plan
// era de pago al publicar, salvo que el dueño la haya regresado a "Solo yo" o "Probadores" en el Laboratorio.
export async function cargaEnViejos(env) {
  const o = await env.R2.get("config/laboratorio.json");
  const c = (o ? await o.json().catch(() => ({})) : {}) || {}, f = c["carga-logo"];
  return !(+c._v >= 2 && f && (f.modo === "yo" || f.modo === "probadores"));
}
export function datosCarga(p, viejos = false) {
  const pr = (p && p.proyecto) || {};
  if (pr.marcaMozari !== false && pr.marcaMozari !== undefined) return null;
  if (!(pr.cargaPropia === true || (pr.cargaPropia === undefined && pr.marcaMozari === false && viejos))) return null;
  const sk = (p && p.skin) || {}, lg = sk.logo || {}, f = pr.ficha || {};
  const color = (c, d) => (HEX.test(c || "") ? c : d);
  let img = "", fondo = color(sk.panel, "#111111"), acento = color(sk.acento, "#FFFFFF");
  if (lg.tipo === "propio" && typeof lg.img === "string" && rutaValida(lg.img)) img = lg.img;
  else if (f.logo === "propio" && typeof f.logoImg === "string" && rutaValida(f.logoImg)) { img = f.logoImg; fondo = color(f.fondo, "#ECEAE6"); acento = color(f.acento, "#8A5A3C"); }
  const texto = luz(fondo) > 0.35 ? "#1C1C1C" : "#F2F5EC";
  if (contraste(acento, fondo) < 1.8) acento = texto;
  const nombre = !img || sk.nombre !== false ? String(pr.nombre || "").slice(0, 90) : "";
  return { img, fondo, acento, texto, nombre };
}
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function conCarga(rw, p, viejos = false) {
  const d = datosCarga(p, viejos);
  if (!d) return rw;
  const centro = (d.img ? '<img class="splash-logo" src="' + d.img + '" alt="">' : "") + (d.nombre ? '<b class="splash-nombre">' + escHtml(d.nombre) + "</b>" : "") + '<div class="splash-barra"><i></i></div>';
  return rw
    .on("#splash", { element: (el) => { el.setAttribute("class", "splash propia" + (d.img ? "" : " sin-logo")); el.setAttribute("style", "--c-fondo:" + d.fondo + ";--c-acento:" + d.acento + ";--c-texto:" + d.texto); } })
    .on(".splash-centro", { element: (el) => el.setInnerContent(centro, { html: true }) })
    .on(".splash-credito", { element: (el) => el.remove() });
}

// Sirve un objeto de R2 con caché del navegador, If-None-Match y Range (los videos se adelantan por partes)
export async function servirR2(env, request, clave, cache) {
  const conRango = request.headers.has("range");
  const obj = await env.R2.get(clave, conRango ? { range: request.headers } : { onlyIf: request.headers });
  if (obj === null) return error(404, "No existe");
  const h = new Headers();
  h.set("accept-ranges", "bytes");
  if (conRango && obj.range && "body" in obj) {
    obj.writeHttpMetadata(h);
    if (!h.get("content-type")) h.set("content-type", tipoDe(clave));
    const rg = obj.range, ini = rg.suffix !== undefined ? obj.size - rg.suffix : rg.offset || 0;
    const largo = rg.suffix !== undefined ? rg.suffix : rg.length ?? obj.size - ini;
    h.set("content-range", "bytes " + ini + "-" + (ini + largo - 1) + "/" + obj.size);
    h.set("content-length", String(largo));
    h.set("etag", obj.httpEtag);
    h.set("cache-control", cache);
    h.set("access-control-allow-origin", "*");
    return new Response(obj.body, { status: 206, headers: h });
  }
  obj.writeHttpMetadata(h);
  if (!h.get("content-type")) h.set("content-type", tipoDe(clave));
  h.set("etag", obj.httpEtag);
  h.set("cache-control", cache);
  h.set("access-control-allow-origin", "*");
  if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers: h });
  return new Response(obj.body, { headers: h });
}

// Borra todo lo que empieza con un prefijo (en lotes de 1000)
export async function borrarPrefijo(env, prefijo) {
  let cursor, total = 0;
  do {
    const l = await env.R2.list({ prefix: prefijo, cursor, limit: 1000 });
    const claves = l.objects.map((o) => o.key);
    if (claves.length) { await env.R2.delete(claves); total += claves.length; }
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return total;
}
