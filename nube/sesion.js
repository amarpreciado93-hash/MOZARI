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

const COOKIE = "mz_sesion", ESTADO = "mz_estado", COMPRAR = "mz_comprar", DIAS = 30;
// Si venía de "Elegir Pro" en el escaparate, después de entrar abre el pago de ese plan
const destino = (url, c) => url.origin + "/" + (/^(pro|desarrollos)$/.test(c || "") ? "?comprar=" + c : "");

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

// Devuelve la cuenta de quien hace la petición, o null
export async function cuentaDe(request, env) {
  const s = await verificar(env, leerCookie(request, COOKIE)).catch(() => null);
  if (!s) return null;
  const p = await perfil(env, s.uid);
  return p && !p.bloqueado ? p : null;
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

async function iniciarSesion(url, env, g, adopcion, comprar) {
  const { p, nueva } = await guardarCuenta(env, g);
  if (nueva && adopcion) await adopcion(p);
  const token = await firmar(env, { uid: p.uid, exp: Math.floor(Date.now() / 1000) + DIAS * 86400 });
  return new Response(null, { status: 302, headers: [["location", destino(url, comprar)], ["set-cookie", cookie(url, COOKIE, token, DIAS * 86400)], ["set-cookie", cookie(url, ESTADO, "", 0)], ["set-cookie", cookie(url, COMPRAR, "", 0)]] });
}

// Rutas /entrar, /auth/google y /salir. Devuelve una respuesta o null si no es una de ellas.
export async function rutasSesion(request, env, adopcion) {
  const url = new URL(request.url);
  if (url.pathname === "/salir") {
    return new Response(null, { status: 302, headers: { location: url.origin + "/", "set-cookie": cookie(url, COOKIE, "", 0) } });
  }
  if (url.pathname === "/entrar") {
    const q = url.searchParams.get("comprar") || "";
    const comprar = /^(pro|desarrollos)$/.test(q) ? q : "";
    // Ya con sesión: directo al estudio (y al pago, si eligió un plan)
    if (await cuentaDe(request, env)) return Response.redirect(url.origin + "/" + (comprar ? "?comprar=" + comprar : ""), 302);
    // Solo para probar en la computadora: entra con cualquier correo sin Google
    if (env.DEV === "1" && url.hostname === "localhost" && url.searchParams.get("dev")) {
      const email = url.searchParams.get("dev");
      return iniciarSesion(url, env, { sub: "dev-" + email.replace(/[^a-z0-9]/gi, ""), email, name: email.split("@")[0] }, adopcion, comprar);
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
    return iniciarSesion(url, env, g, adopcion, leerCookie(request, COMPRAR));
  }
  return null;
}
