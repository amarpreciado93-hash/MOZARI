// Mozari · respaldos de los datos (no de las fotos)
//
// Copia en respaldos/<sello>/... todo lo que una actualización podría dañar:
//   cuentas (perfil, plan, sesiones, a quién pertenece cada tour), config, cupones, pagos, pausados,
//   anuncios (.json) y el proyecto de cada tour (borrador y publicado). Las esferas y fotos no se tocan
//   con las actualizaciones, así que no se copian: así cada respaldo pesa muy poco.
//
// Cuándo:  cada noche (3 a. m. de México) y en cuanto entra una versión nueva de Mozari.
//          También a mano desde el Panel de dueño → Respaldos.
// Cuántos: se guardan los últimos 30; los más viejos se borran solos.
// Se hace por tandas (POR_VUELTA archivos por vez) para no pasar los límites de Cloudflare: si no
// termina, la siguiente revisión (cada hora) sigue donde se quedó.

const ESTADO = "respaldos/estado.json", GUARDAR = 30, POR_VUELTA = 250, A_LA_VEZ = 10;
const PREFIJOS = ["cuentas/", "config/", "cupones/", "pagos/", "pausados/", "privados/", "novedades/"];
const json = (env, k, v) => env.R2.put(k, JSON.stringify(v), { httpMetadata: { contentType: "application/json" } });

async function leerEstado(env) {
  const o = await env.R2.get(ESTADO);
  return (o && (await o.json().catch(() => null))) || {};
}
async function listar(env, prefijo) {
  const claves = []; let cursor;
  do {
    const l = await env.R2.list({ prefix: prefijo, cursor, limit: 1000 });
    l.objects.forEach((o) => claves.push(o.key));
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return claves;
}
async function armarLista(env) {
  const claves = [];
  for (const p of PREFIJOS) for (const k of await listar(env, p)) if (p !== "novedades/" || k.endsWith(".json")) claves.push(k);
  // Los tours se sacan del índice de cada cuenta (listar tours/ completo traería miles de pedazos de esfera)
  const ids = new Set(claves.map((k) => /^cuentas\/[^/]+\/tours\/([^/]+)$/.exec(k)).filter(Boolean).map((m) => m[1]));
  for (const id of ids) claves.push("tours/" + id + "/proyecto.json", "publicado/" + id + "/proyecto.json");
  return claves;
}
const sellar = () => new Date().toISOString().slice(0, 19).replace(/:/g, "-");

export async function iniciarRespaldo(env, motivo, version) {
  const e = await leerEstado(env);
  if (e.enCurso) return e;
  if (version) e.version = version;
  e.enCurso = { sello: sellar(), motivo, inicio: new Date().toISOString(), pendientes: [], copiados: 0 };
  await json(env, ESTADO, e); // se anota primero para que otra copia del programa no empiece otro igual
  e.enCurso.pendientes = await armarLista(env);
  await json(env, ESTADO, e);
  return e;
}

async function avanzar(env) {
  const e = await leerEstado(env), c = e.enCurso;
  if (!c) return e;
  const lote = c.pendientes.splice(0, POR_VUELTA);
  for (let i = 0; i < lote.length; i += A_LA_VEZ) {
    await Promise.all(lote.slice(i, i + A_LA_VEZ).map(async (k) => {
      const o = await env.R2.get(k); if (!o) return;
      await env.R2.put("respaldos/" + c.sello + "/" + k, await o.arrayBuffer(), { httpMetadata: o.httpMetadata, customMetadata: o.customMetadata });
      c.copiados++;
    }));
  }
  if (!c.pendientes.length) {
    const listo = { sello: c.sello, motivo: c.motivo, archivos: c.copiados, inicio: c.inicio, fin: new Date().toISOString(), version: e.version || null };
    await json(env, "respaldos/" + c.sello + "/LISTO.json", listo);
    e.ultimo = listo; e.enCurso = null;
    await json(env, ESTADO, e);
    await limpiar(env);
  } else await json(env, ESTADO, e);
  return e;
}

// Deja solo los últimos GUARDAR respaldos
async function sellos(env) {
  const s = []; let cursor;
  do {
    const l = await env.R2.list({ prefix: "respaldos/", delimiter: "/", cursor });
    (l.delimitedPrefixes || []).forEach((p) => s.push(p.slice(10, -1)));
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return s.sort();
}
async function limpiar(env) {
  const todos = await sellos(env), viejos = todos.slice(0, Math.max(0, todos.length - GUARDAR));
  for (const s of viejos) {
    const claves = await listar(env, "respaldos/" + s + "/");
    for (let i = 0; i < claves.length; i += 1000) await env.R2.delete(claves.slice(i, i + 1000));
  }
}

// Revisión periódica (cada hora) y al arrancar una versión nueva
export async function vigilarRespaldos(env, forzarMotivo) {
  let e = await leerEstado(env);
  const version = env.VERSION && env.VERSION.id, ahora = new Date();
  if (!e.enCurso) {
    if (forzarMotivo) e = await iniciarRespaldo(env, forzarMotivo, version);
    else if (version && e.version !== version) e = await iniciarRespaldo(env, e.version ? "actualizacion" : "primero", version);
    else if (ahora.getUTCHours() === 9 && (!e.ultimo || ahora - Date.parse(e.ultimo.fin) > 20 * 3600e3)) e = await iniciarRespaldo(env, "noche", version);
  }
  for (let i = 0; i < 3 && e.enCurso; i++) e = await avanzar(env);
  return e;
}

// Panel de dueño: lista de respaldos y respaldar ahora
export async function apiRespaldos(request, env, partes) {
  if (partes.length === 3 && request.method === "GET") {
    const e = await leerEstado(env), lista = [];
    for (const s of (await sellos(env)).reverse()) {
      const o = await env.R2.get("respaldos/" + s + "/LISTO.json");
      if (o) lista.push(await o.json());
    }
    const c = e.enCurso;
    return Response.json({ lista, enCurso: c ? { sello: c.sello, motivo: c.motivo, copiados: c.copiados, faltan: c.pendientes.length } : null, guardar: GUARDAR });
  }
  if (partes.length === 3 && request.method === "POST") {
    const e = await vigilarRespaldos(env, "manual");
    return Response.json({ ok: true, listo: !e.enCurso, ultimo: e.ultimo || null });
  }
  // Regresar el proyecto de un tour a como estaba en un respaldo (lo de antes queda guardado aparte)
  if (partes.length === 5 && partes[4] === "restaurar" && request.method === "POST") {
    const sello = partes[3], { tour } = await request.json().catch(() => ({}));
    if (!/^[\w-]+$/.test(sello) || !/^[\w-]+$/.test(String(tour || ""))) return Response.json({ error: "Datos inválidos" }, { status: 400 });
    let n = 0;
    for (const base of ["tours/", "publicado/"]) {
      const o = await env.R2.get("respaldos/" + sello + "/" + base + tour + "/proyecto.json"); if (!o) continue;
      const hoy = await env.R2.get(base + tour + "/proyecto.json");
      if (hoy) await env.R2.put("restauraciones/" + sellar() + "/" + base + tour + "/proyecto.json", await hoy.arrayBuffer());
      await env.R2.put(base + tour + "/proyecto.json", await o.arrayBuffer(), { httpMetadata: o.httpMetadata });
      n++;
    }
    // También su ficha en Mis Tours (nombre, dueño) como estaba en el respaldo
    if (n) for (const k of await listar(env, "respaldos/" + sello + "/cuentas/")) {
      if (!k.endsWith("/tours/" + tour)) continue;
      const o = await env.R2.get(k);
      if (o) await env.R2.put(k.slice(("respaldos/" + sello + "/").length), "", { customMetadata: o.customMetadata || {} });
    }
    return n ?Response.json({ ok: true }) : Response.json({ error: "Ese tour no está en el respaldo" }, { status: 404 });
  }
  return Response.json({ error: "Ruta desconocida" }, { status: 404 });
}
