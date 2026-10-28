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
  mp4: "video/mp4", html: "text/html; charset=utf-8",
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

// Sirve un objeto de R2 con caché del navegador y soporte de If-None-Match
export async function servirR2(env, request, clave, cache) {
  const obj = await env.R2.get(clave, { onlyIf: request.headers });
  if (obj === null) return error(404, "No existe");
  const h = new Headers();
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
