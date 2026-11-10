// Mozari · cuentas con Google y sesión
//
// Entrar:   /entrar  → Google → /auth/google  → cookie de sesión firmada (30 días) → estudio
// Salir:    /salir
//
// La cookie lleva { uid, exp } firmado con HMAC-SHA256 (secreto SESION_SECRETO). Nadie puede
// fabricarla sin el secreto. Cada cuenta vive en R2 en cuentas/<uid>/perfil.json.
//
// Secretos del Worker (se ponen en Cloudflare, nunca en el código):
//   GOOGLE_CLIENT_SECRET (y opcional SESION_SECRETO; si no está, se crea solo)
// Variables: GOOGLE_CLIENT_ID (no es secreto)
// Variable: ADMIN (correo del dueño de Mozari: ve el panel de cuentas y adopta los tours viejos)
import { mandarBienvenida } from "./correos.js";

const COOKIE = "mz_sesion", ESTADO = "mz_estado", COMPRAR = "mz_comprar", PENDIENTE = "mz_pendiente", DIAS = 30;
// Cada cuenta puede tener la sesión abierta en 2 dispositivos (el dueño de Mozari, sin límite).
// Al entrar en un tercero, Mozari le muestra los 2 activos y elige cuál cerrar.
const LIMITE_DISP = 2;
// Si venía de "Elegir Pro" en el escaparate, después de entrar abre el pago de ese plan
// "desarrollos" o "desarrollos:ALUMNOS" (plan y cupón que eligió antes de entrar)
const COMPRA = /^(pro|desarrollos)?(?::([A-Z0-9-]{3,24}))?$/;
const destino = (url, c) => {
  const m = c ? COMPRA.exec(c) : null, q = [];
  if (m && m[1]) q.push("comprar=" + m[1]);
  if (m && m[2]) q.push("cupon=" + m[2]);
  return url.origin + "/" + (q.length ? "?" + q.join("&") : "");
};
const PAUSADA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cuenta en pausa · Mozari</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0B0B;color:#F2F5EC;font:15px/1.5 system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}p{color:#9CA38F;max-width:420px}a{color:#F2F5EC}</style></head>
<body><div><h1 style="font-weight:600;letter-spacing:.2em">MOZARI</h1><p>Tu cuenta está en pausa. Si crees que es un error, escríbenos a <a href="mailto:hola@mozari.app">hola@mozari.app</a>.</p></div></body></html>`;

// Cupo de cuentas: cuántas cuentas puede tener Mozari por ahora (beta). Quien entra para comprar una licencia
// o con un link de regalo pasa siempre. El dueño lo cambia en el Panel (config/cupo.json). Al llenarse, quien
// llega queda en la lista de espera (lista-espera/<correo>.json) y ve «Cupo lleno», con la opción de comprar.
export const CUPO_INICIAL = 300;
export async function leerCupo(env) {
  const o = await env.R2.get("config/cupo.json"), c = o ? await o.json().catch(() => ({})) : {};
  return Number.isFinite(+c.cupo) && +c.cupo >= 0 ? Math.floor(+c.cupo) : CUPO_INICIAL;
}
export async function contarCuentas(env) {
  let n = 0, cursor;
  do {
    const l = await env.R2.list({ prefix: "cuentas/", delimiter: "/", cursor, limit: 1000 });
    n += (l.delimitedPrefixes || []).length;
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return n;
}
const claveEspera = (email) => "lista-espera/" + String(email || "").toLowerCase().replace(/[^a-z0-9@._+-]/g, "_").slice(0, 120) + ".json";
async function anotarEspera(env, g) {
  const k = claveEspera(g.email), o = await env.R2.get(k), antes = o ? await o.json().catch(() => null) : null, ahora = new Date().toISOString();
  const d = Object.assign({ email: g.email, nombre: g.name || "", fecha: ahora, veces: 0 }, antes || {}, { ultima: ahora });
  d.veces = (+d.veces || 0) + 1;
  await env.R2.put(k, JSON.stringify(d), { httpMetadata: { contentType: "application/json" } });
}
const paginaCupoLleno = (email) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cupo lleno · Mozari</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F4F5F2;color:#0B0B0B;font:15px/1.55 Poppins,system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
.c{max-width:440px}h1{font-weight:600;letter-spacing:.3em;font-size:18px;margin:0 0 28px}h2{font-size:26px;margin:0 0 10px}p{color:#4A4D45;margin:0 0 14px}
a.b{display:inline-block;margin-top:10px;padding:12px 22px;border-radius:999px;background:#0B0B0B;color:#fff;text-decoration:none;font-weight:600}small{display:block;margin-top:18px;color:#7A7D74}</style></head>
<body><div class="c"><h1>MOZARI</h1><h2>Cupo lleno</h2><p>Por ahora Mozari está abierto a un número limitado de cuentas y ya se llenó.</p>
<p>Te anotamos en la lista de espera con <b>${String(email || "").replace(/[&<>"']/g, "")}</b>. Te escribimos en cuanto se abran más lugares.</p>
<a class="b" href="/#planes">¿Ya quieres entrar? Con una licencia entras directo</a><small>Pro y Desarrollos no tienen cupo.</small></div></body></html>`;

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const txt = new TextEncoder();

// El secreto que firma las sesiones: si no viene como secreto del Worker, se crea solo una vez
// y se guarda en el almacén privado (R2 no es público). Así nadie tiene que copiarlo a mano.
let secretoCache = null;
async function secreto(env) {
  if (env.SESION_SECRETO && env.SESION_SECRETO.length >= 32) return env.SESION_SECRETO;
  if (secretoCache) return secretoCache;
  const o = await env.R2.get("sistema/sesion-secreto");
  if (o) return (secretoCache = await o.text());
  const nuevo = b64u(crypto.getRandomValues(new Uint8Array(48)));
  await env.R2.put("sistema/sesion-secreto", nuevo);
  return (secretoCache = nuevo);
}
async function llave(env) {
  return crypto.subtle.importKey("raw", txt.encode(await secreto(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function firmar(env, datos) {
  const cuerpo = b64u(txt.encode(JSON.stringify(datos)));
  const firma = await crypto.subtle.sign("HMAC", await llave(env), txt.encode(cuerpo));
  return cuerpo + "." + b64u(firma);
}
// Links firmados que no son sesión (por ejemplo, el de «ya no quiero recibir novedades»)
export const firmarLink = (env, datos, dias = 3650) => firmar(env, Object.assign({}, datos, { exp: Math.floor(Date.now() / 1000) + dias * 86400 }));
export const verificarLink = (env, token) => verificar(env, token);
async function verificar(env, token) {
  const [cuerpo, firma] = String(token || "").split(".");
  if (!cuerpo || !firma) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await llave(env), deB64u(firma), txt.encode(cuerpo));
    if (!ok) return null;
    const d = JSON.parse(new TextDecoder().decode(deB64u(cuerpo)));
    return d.exp > Date.now() / 1000 ? d : null;
  } catch (e) { return null; }
}

export function leerCookie(request, nombre) {
  const c = request.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + nombre + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
const cookie = (url, nombre, valor, segundos) =>
  nombre + "=" + encodeURIComponent(valor) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + segundos + (url.protocol === "https:" ? "; Secure" : "");

const perfilClave = (uid) => "cuentas/" + uid + "/perfil.json";
export async function perfil(env, uid) {
  const o = await env.R2.get(perfilClave(uid));
  return o ? o.json() : null;
}

// Dispositivos con sesión abierta: cuentas/<uid>/sesiones.json  [{ id, nombre, tipo, ciudad, creada, ultima }]
const sesionesClave = (uid) => "cuentas/" + uid + "/sesiones.json";
async function leerSesiones(env, uid) {
  const o = await env.R2.get(sesionesClave(uid));
  const l = o ? await o.json().catch(() => []) : [], limite = Date.now() - DIAS * 864e5;
  return (Array.isArray(l) ? l : []).filter((x) => x && x.id && Date.parse(x.creada) > limite); // las de más de 30 días ya vencieron
}
const guardarSesiones = (env, uid, l) => env.R2.put(sesionesClave(uid), JSON.stringify(l), { httpMetadata: { contentType: "application/json" } });
function dispositivoDe(request) {
  const ua = request.headers.get("user-agent") || "";
  const tipo = /iPhone|Android.*Mobile/.test(ua) ? "celular" : /iPad|Android|Tablet/.test(ua) ? "tablet" : "compu";
  const so = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? (tipo === "celular" ? "Celular Android" : "Tablet Android") : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "Dispositivo";
  const nav = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
  const cf = request.cf || {};
  return { nombre: so + (nav ? " · " + nav : ""), tipo, ciudad: String(cf.city || "").slice(0, 40), pais: paisDe(request) };
}

// País de la petición (lo da Cloudflare): 2 letras, sin los códigos de «desconocido» (XX) ni de Tor (T1)
export const paisDe = (request) => { const c = String((request.cf && request.cf.country) || "").toUpperCase(); return /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" ? c : ""; };

// Devuelve la cuenta de quien hace la petición, o null
export async function cuentaDe(request, env) {
  const s = await verificar(env, leerCookie(request, COOKIE)).catch(() => null);
  if (!s || s.pend) return null;
  const [p, ses] = await Promise.all([perfil(env, s.uid), s.sid ? leerSesiones(env, s.uid) : null]);
  if (!p || p.bloqueado) return null;
  // País de la cuenta para el Panel de dueño: se guarda una sola vez, la primera vez que se sabe
  const pais = paisDe(request);
  if (pais && !p.pais) { p.pais = pais; await env.R2.put(perfilClave(s.uid), JSON.stringify(p), { httpMetadata: { contentType: "application/json" } }); }
  if (s.sid) {
    // Si cerraron este dispositivo desde otro, la sesión ya no vale
    const yo = ses.find((x) => x.id === s.sid);
    if (!yo) return null;
    if (Date.now() - Date.parse(yo.ultima) > 3600e3) { yo.ultima = new Date().toISOString(); await guardarSesiones(env, s.uid, ses); }
    Object.defineProperty(p, "sesion", { value: s.sid, enumerable: false });
  }
  return p;
}

// Crea la cuenta la primera vez; después solo actualiza nombre y foto
async function guardarCuenta(env, g) {
  const uid = "g" + g.sub, antes = await perfil(env, uid), ahora = new Date().toISOString();
  const p = Object.assign({ uid, plan: "gratis", creado: ahora }, antes || {}, {
    email: g.email, nombre: g.name || g.email, foto: g.picture || "", ultimaEntrada: ahora,
  });
  if (env.ADMIN && g.email.toLowerCase() === env.ADMIN.toLowerCase()) p.admin = true;
  await env.R2.put(perfilClave(uid), JSON.stringify(p), { httpMetadata: { contentType: "application/json" } });
  return { p, nueva: !antes };
}

async function iniciarSesion(request, url, env, g, adopcion, comprar) {
  // Cuenta nueva con el cupo lleno: a la lista de espera (salvo que venga a comprar o con un link de regalo)
  const esDueno = env.ADMIN && String(g.email || "").toLowerCase() === env.ADMIN.toLowerCase();
  if (!esDueno && !comprar && !(await perfil(env, "g" + g.sub))) {
    const [cupo, n] = await Promise.all([leerCupo(env), contarCuentas(env)]);
    if (n >= cupo) {
      await anotarEspera(env, g);
      const h = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      h.append("set-cookie", cookie(url, ESTADO, "", 0)); h.append("set-cookie", cookie(url, COMPRAR, "", 0));
      return new Response(paginaCupoLleno(g.email), { status: 200, headers: h });
    }
  }
  const { p, nueva } = await guardarCuenta(env, g);
  // Correo de bienvenida (si el dueño lo prendió en su panel). Si falla, la entrada sigue igual.
  if (nueva) {
    try { if (await mandarBienvenida(env, p, url.origin)) { p.bienvenida = new Date().toISOString(); await env.R2.put(perfilClave(p.uid), JSON.stringify(p), { httpMetadata: { contentType: "application/json" } }); } }
    catch (e) { /* sin correo, pero con cuenta */ }
  }
  if (p.bloqueado) return new Response(PAUSADA, { status: 403, headers: { "content-type": "text/html; charset=utf-8", "set-cookie": cookie(url, COMPRAR, "", 0) } });
  if (nueva && adopcion) await adopcion(p);
  const ses = await leerSesiones(env, p.uid);
  if (!p.admin && ses.length >= LIMITE_DISP) {
    // Ya hay 2 dispositivos: que elija cuál cerrar (el pase dura 10 minutos y no sirve como sesión)
    const pase = await firmar(env, { uid: p.uid, pend: 1, comprar: comprar || "", exp: Math.floor(Date.now() / 1000) + 600 });
    return new Response(null, { status: 302, headers: [["location", url.origin + "/dispositivos"], ["set-cookie", cookie(url, PENDIENTE, pase, 600)], ["set-cookie", cookie(url, ESTADO, "", 0)], ["set-cookie", cookie(url, COMPRAR, "", 0)]] });
  }
  return entrar(request, url, env, p, ses, comprar);
}
async function entrar(request, url, env, p, ses, comprar) {
  const sid = b64u(crypto.getRandomValues(new Uint8Array(12))), ahora = new Date().toISOString();
  ses.push(Object.assign({ id: sid }, dispositivoDe(request), { creada: ahora, ultima: ahora }));
  await guardarSesiones(env, p.uid, ses);
  const token = await firmar(env, { uid: p.uid, sid, exp: Math.floor(Date.now() / 1000) + DIAS * 86400 });
  return new Response(null, { status: 302, headers: [["location", destino(url, comprar)], ["set-cookie", cookie(url, COOKIE, token, DIAS * 86400)], ["set-cookie", cookie(url, ESTADO, "", 0)], ["set-cookie", cookie(url, COMPRAR, "", 0)], ["set-cookie", cookie(url, PENDIENTE, "", 0)]] });
}

// Pantalla "ya estás en 2 dispositivos": elige cuál cerrar para entrar en este
const ICO_DISP = {
  celular: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  tablet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4.5" y="2.5" width="15" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  compu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8 20h8M12 16.5V20"/></svg>',
};
const escH = (t) => String(t || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function haceCuanto(iso) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 10 ? "activo ahora" : m < 60 ? "activo hace " + m + " min" : m < 1440 ? "activo hace " + Math.round(m / 60) + " h" : "activo hace " + Math.round(m / 1440) + " días";
}
function paginaDispositivos(ses, aqui) {
  const filas = ses.map((x) => '<form method="post" action="/dispositivos/cerrar" class="disp"><span class="ico">' + (ICO_DISP[x.tipo] || ICO_DISP.compu) + '</span><div><b>' + escH(x.nombre) + "</b><small>" + escH((x.ciudad ? x.ciudad + " · " : "") + haceCuanto(x.ultima)) + '</small></div><input type="hidden" name="sid" value="' + escH(x.id) + '"><button>Cerrar y entrar aquí</button></form>').join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tus dispositivos · Mozari</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0B0B;color:#F2F5EC;font:15px/1.5 Poppins,system-ui,sans-serif;padding:24px;box-sizing:border-box}
main{width:min(460px,100%);display:grid;gap:14px}.marca{letter-spacing:.32em;font-weight:600;font-size:13px;color:#9CA38F}h1{margin:0;font-size:24px;line-height:1.25}p{margin:0;color:#9CA38F}
.disp{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;align-items:center;padding:14px 16px;border-radius:16px;border:1px solid rgba(255,255,255,.1);background:#141414}
.ico{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:rgba(213,255,64,.1);color:#D5FF40;grid-row:span 2}.ico svg{width:22px;height:22px}
.disp b{font-weight:600}.disp small{display:block;color:#9CA38F;font-size:12.5px}
.disp button{grid-column:2;justify-self:start;margin-top:6px;border:0;border-radius:999px;padding:8px 16px;background:#D5FF40;color:#0B0B0B;font:600 13px Poppins,system-ui,sans-serif;cursor:pointer}
.aqui{font-size:13px;padding:10px 14px;border-radius:12px;border:1px dashed rgba(255,255,255,.18);color:#C9CFBD}.cancelar{color:#9CA38F;font-size:13px;text-align:center}</style></head>
<body><main><span class="marca">MOZARI</span><h1>Tu cuenta ya está abierta en ${LIMITE_DISP} dispositivos</h1><p>Cada cuenta se puede usar en ${LIMITE_DISP} dispositivos. Cierra uno para entrar en este.</p>
<div class="aqui">Quieres entrar desde: <b>${escH(aqui.nombre)}</b></div>${filas}<a class="cancelar" href="/salir">Cancelar</a></main></body></html>`;
}

// Rutas /entrar, /auth/google y /salir. Devuelve una respuesta o null si no es una de ellas.
export async function rutasSesion(request, env, adopcion) {
  const url = new URL(request.url);
  if (url.pathname === "/salir") {
    // Al salir, este dispositivo deja libre su lugar
    const s = await verificar(env, leerCookie(request, COOKIE)).catch(() => null);
    if (s && s.sid && !s.pend) { const ses = await leerSesiones(env, s.uid); const resto = ses.filter((x) => x.id !== s.sid); if (resto.length !== ses.length) await guardarSesiones(env, s.uid, resto); }
    const h = new Headers({ location: url.origin + "/" });
    h.append("set-cookie", cookie(url, COOKIE, "", 0)); h.append("set-cookie", cookie(url, PENDIENTE, "", 0));
    return new Response(null, { status: 302, headers: h });
  }
  if (url.pathname === "/dispositivos" || url.pathname === "/dispositivos/cerrar") {
    const pase = await verificar(env, leerCookie(request, PENDIENTE)).catch(() => null);
    if (!pase || !pase.pend) return Response.redirect(url.origin + "/", 302);
    const ses = await leerSesiones(env, pase.uid);
    if (url.pathname === "/dispositivos") return new Response(paginaDispositivos(ses, dispositivoDe(request)), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    if (request.method !== "POST") return Response.redirect(url.origin + "/dispositivos", 302);
    const sid = String((await request.formData().catch(() => new FormData())).get("sid") || "");
    const p = await perfil(env, pase.uid);
    if (!p || p.bloqueado) return Response.redirect(url.origin + "/", 302);
    const resto = ses.filter((x) => x.id !== sid);
    if (resto.length === ses.length || resto.length >= LIMITE_DISP) return Response.redirect(url.origin + "/dispositivos", 302);
    return entrar(request, url, env, p, resto, pase.comprar);
  }
  if (url.pathname === "/entrar") {
    const q = url.searchParams.get("comprar") || "", cq = (url.searchParams.get("cupon") || "").trim().toUpperCase();
    const comprar = (/^(pro|desarrollos)$/.test(q) ? q : "") + (/^[A-Z0-9-]{3,24}$/.test(cq) ? ":" + cq : "");
    // Ya con sesión: directo al estudio (y al pago, si eligió un plan)
    if (await cuentaDe(request, env)) return Response.redirect(destino(url, comprar), 302);
    // Solo para probar en la computadora: entra con cualquier correo sin Google
    if (env.DEV === "1" && url.hostname === "localhost" && url.searchParams.get("dev")) {
      const email = url.searchParams.get("dev");
      return iniciarSesion(request, url, env, { sub: "dev-" + email.replace(/[^a-z0-9]/gi, ""), email, name: email.split("@")[0] }, adopcion, comprar);
    }
    if (!env.GOOGLE_CLIENT_ID) return new Response("Falta configurar el acceso con Google", { status: 503 });
    const estado = b64u(crypto.getRandomValues(new Uint8Array(24)));
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: url.origin + "/auth/google", response_type: "code",
      scope: "openid email profile", state: estado, prompt: "select_account",
    });
    const h = new Headers({ location: "https://accounts.google.com/o/oauth2/v2/auth?" + params });
    h.append("set-cookie", cookie(url, ESTADO, estado, 600));
    if (comprar) h.append("set-cookie", cookie(url, COMPRAR, comprar, 900));
    return new Response(null, { status: 302, headers: h });
  }
  if (url.pathname === "/auth/google") {
    const volver = (m) => Response.redirect(url.origin + "/?error=" + encodeURIComponent(m), 302);
    const estado = leerCookie(request, ESTADO);
    if (!estado || estado !== url.searchParams.get("state")) return volver("La sesión tardó demasiado. Intenta de nuevo.");
    const code = url.searchParams.get("code");
    if (!code) return volver("No se completó la entrada con Google.");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: url.origin + "/auth/google", grant_type: "authorization_code" }),
    });
    if (!r.ok) return volver("Google no aceptó la entrada. Intenta de nuevo.");
    const { id_token } = await r.json();
    // El token llega directo de Google por HTTPS: basta revisar a quién va dirigido y que el correo esté verificado
    let g;
    try { g = JSON.parse(new TextDecoder().decode(deB64u(id_token.split(".")[1]))); } catch (e) { return volver("Respuesta inválida de Google."); }
    if (g.aud !== env.GOOGLE_CLIENT_ID || !/^(https:\/\/)?accounts\.google\.com$/.test(g.iss) || !g.email_verified) return volver("Esa cuenta de Google no está verificada.");
    return iniciarSesion(request, url, env, g, adopcion, leerCookie(request, COMPRAR));
  }
  return null;
}
