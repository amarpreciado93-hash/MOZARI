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
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2", // tipografías propias (Laboratorio «tipografias»)
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

// Mejora de esferas (Laboratorio «mejora»): lo retocado (quitar el tripié, borrar objetos) vive en escenas/<esfera>/ret<N>/
// (las piezas de las caras que cambiaron y la vista previa). El visor pide escenas/<esfera>/e<retoques>-<ajuste>/…: cada
// pieza sale de aj<M>/ (ajustes horneados, de la primera versión: ahora se pintan en vivo y no hay carpeta); si no, de
// la carpeta ret de su cara; y si no, del original. El link cambia con cada edición, así nadie ve la versión vieja
// guardada en caché.
export function rutasEdicion(ruta) {
  // e<retoques>-<ajuste>/…  ·  retoques: «3» (el piso, de la primera versión) o cara+carpeta juntas: «d3f5» = la cara d en ret3/ y la f en ret5/
  const m = /^(escenas\/[A-Za-z0-9_-]{1,80}\/)e(\d{1,4}|(?:[bdflru]\d{1,4}){1,6})-(\d{1,4})\/(.+)$/.exec(ruta);
  if (!m) return null;
  const [, base, n, a, resto] = m, pz = /^\d{1,2}\/([bdflru])\/\d{1,3}\/\d{1,3}\.jpg$/.exec(resto), previa = resto === "preview.jpg", l = [], caras = {};
  let ultima = 0;
  if (/^\d+$/.test(n)) { if (+n > 0) { caras.d = +n; ultima = +n; } }
  else for (const x of n.matchAll(/([bdflru])(\d{1,4})/g)) { caras[x[1]] = +x[2]; if (+x[2] > ultima) ultima = +x[2]; }
  if (+a > 0 && (pz || previa)) l.push(base + "aj" + +a + "/" + resto);
  if (pz && caras[pz[1]] > 0) l.push(base + "ret" + caras[pz[1]] + "/" + resto);
  if (previa && ultima > 0) l.push(base + "ret" + ultima + "/" + resto); // la vista previa va en la carpeta del último retoque
  l.push(base + resto);
  return l;
}

// El prefijo con que se piden las piezas de una esfera editada, según su escena.json (lo mismo que arma el visor)
export function prefijoEdicion(j) {
  if (!j) return "";
  let n = 0;
  if (j.ret && typeof j.ret === "object") n = Object.keys(j.ret).filter((c) => /^[bdflru]$/.test(c) && Array.isArray(j.ret[c]) && j.ret[c][0] > 0).sort().map((c) => c + Math.floor(j.ret[c][0])).join("") || 0;
  else if (j.retoque > 0) n = Math.floor(j.retoque);
  const a = j.ajuste > 0 ? Math.floor(j.ajuste) : 0;
  return n || a ? "e" + n + "-" + a : "";
}

// Mapa satelital de «Ubicación» (Laboratorio «ubicacion»). La llave del proveedor (Esri) la pega el dueño en su panel
// y vive en config/mapa.json. Es una llave de página (viaja en el link de cada mosaico, como en cualquier mapa web):
// en Esri va amarrada a los dominios de Mozari y la cuenta no tiene forma de pago, así que si un mes se acaba lo
// gratis el satélite se apaga solo (el plano se sigue viendo sobre fondo oscuro) y nunca cobra.
export const LLAVE_MAPA = /^[A-Za-z0-9._-]{20,700}$/;
export const ESTILO_MAPA = /^[a-z0-9-]{2,30}(\/[a-z0-9-]{2,30}){1,2}$/;
const satEsri = (llave, estilo) => "https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/" + estilo + "/static/tile/{z}/{y}/{x}?token=" + llave;
export async function confMapa(env) {
  let c = null; try { const o = await env.R2.get("config/mapa.json"); c = o ? await o.json() : null; } catch (e) { c = null; }
  return { esri: c && typeof c.esri === "string" && LLAVE_MAPA.test(c.esri) ? c.esri : "", estilo: c && typeof c.estilo === "string" && ESTILO_MAPA.test(c.estilo) ? c.estilo : "arcgis/imagery" };
}
let satMem = { t: 0, v: "" };
export async function satDe(env) {
  if (!env.DEV && Date.now() - satMem.t < 60000) return satMem.v; // se relee cada minuto (cada copia del programa guarda la suya)
  const c = await confMapa(env), v = c.esri ? satEsri(c.esri, c.estilo) : "";
  satMem = { t: Date.now(), v }; return v;
}
export const olvidarSat = () => { satMem = { t: 0, v: "" }; };
// La página del mapa (mapa.html, la misma para el estudio y para el tour publicado) con su satélite puesto
export const conSat = (rw, sat) => (sat ? rw.on('meta[name="mz-sat"]', { element: (el) => el.setAttribute("content", sat) }) : rw);
// Se pide siempre entera («¿cambió?» daría una respuesta sin cuerpo y, ya con su llave y sus datos, la página saldría
// en blanco o con la copia vieja que guardó el navegador) y se entrega sin la marca de versión del archivo.
export async function paginaMapa(env, request) {
  const h = new Headers(request.headers); ["if-none-match", "if-modified-since", "range"].forEach((k) => h.delete(k));
  const base = new URL(request.url).origin;
  let r = await env.ASSETS.fetch(new Request(base + "/mapa", { headers: h }));
  if (r.status >= 300 && r.status < 400 && r.headers.get("location")) r = await env.ASSETS.fetch(new Request(new URL(r.headers.get("location"), base), { headers: h }));
  return r;
}
export function entregarMapa(out, cache) {
  const h = new Headers(out.headers); ["etag", "last-modified"].forEach((k) => h.delete(k));
  h.set("cache-control", cache); h.set("content-type", "text/html; charset=utf-8");
  return new Response(out.body, { status: 200, headers: h });
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
// forzar: el tour descargado para otro hosting (marca blanca) siempre lleva la carga del proyecto, nunca la de la plataforma
export function datosCarga(p, viejos = false, forzar = false) {
  const pr = (p && p.proyecto) || {};
  if (!forzar && pr.marcaMozari !== false && pr.marcaMozari !== undefined) return null;
  if (!forzar && !(pr.cargaPropia === true || (pr.cargaPropia === undefined && pr.marcaMozari === false && viejos))) return null;
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
export function conCarga(rw, p, viejos = false, forzar = false) {
  const d = datosCarga(p, viejos, forzar);
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
