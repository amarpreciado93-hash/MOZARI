// Mozari · De dónde llega cada cuenta (anuncios y campañas) y el correo que se deja desde el celular
// Pedido de Amar (20 nov 2026): los anuncios ya no mandan a WhatsApp, mandan a mozari.app. Para saber qué anuncio sirve:
// 1. Quien llega con un link de campaña (utm_… o fbclid) o desde otra página queda anotado en una cookie propia de
//    30 días (mz_origen). Al crear su cuenta, eso se guarda en su perfil (origen).
// 2. Mozari no se usa en el celular: ahí la portada pide solo el correo y manda el link para abrirlo en la compu
//    (prospectos/<id>.json, id = huella del correo). Al crear la cuenta con ese correo, o desde ese link, la cuenta
//    hereda el origen que traía en el celular.
// 3. El panel de dueño suma por campaña: correos que se dejaron, cuentas, cuántas hicieron tour y cuánto pagaron.
import { json, error } from "./comun.js";
import { contador, enviar, correoCompu, claveBajaCorreo, enlaceBaja } from "./correos.js";

export const C_ORIGEN = "mz_origen", C_PROSPECTO = "mz_prospecto";
// Topes del link por correo: es una puerta pública que manda correos, así que va medida
export const PROSPECTOS_DIA = 80, PROSPECTO_DIA_IP = 4;
const DIAS = 30, JSONH = { httpMetadata: { contentType: "application/json" } };
const limpio = (v, n) => String(v == null ? "" : v).replace(/[<>"'`\\\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const leerCookie = (request, nombre) => { const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + nombre + "=([^;]+)")); try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; } };
const ID = /^[a-f0-9]{20}$/, CLIC = /^[\w-]{8,500}$/, CORREO = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,24}$/i;

// Las páginas que más gente mandan, con el nombre que se ve en el panel
const REDES = [[/^accounts\.google\./, ""], [/^mail\.|(^|\.)outlook\.|(^|\.)live\.com$/, "correo"], [/(^|\.)facebook\.com$|(^|\.)fb\.com$|^fb\.me$/, "facebook"], [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)tiktok\.com$/, "tiktok"], [/(^|\.)youtube\.com$|^youtu\.be$/, "youtube"], [/(^|\.)google\.[a-z.]+$/, "google"], [/(^|\.)bing\.com$/, "bing"],
  [/^t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, "x"], [/(^|\.)linkedin\.com$|^lnkd\.in$/, "linkedin"], [/(^|\.)whatsapp\.com$|^wa\.me$/, "whatsapp"]];
const ordenar = (o) => {
  const r = {};
  for (const [k, n] of [["fuente", 40], ["medio", 40], ["campana", 80], ["anuncio", 80]]) { const v = limpio(o && o[k], n); if (v) r[k] = k === "fuente" || k === "medio" ? v.toLowerCase() : v; }
  if (o && CLIC.test(String(o.clic || ""))) r.clic = String(o.clic);
  if (o && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(String(o.fecha || ""))) r.fecha = String(o.fecha);
  return r.fuente || r.campana ? r : null;
};
// De dónde llega esta visita: [origen, viene de un link de campaña]. null si entró directo.
export function origenDe(request, url) {
  const q = url.searchParams, o = { fuente: q.get("utm_source"), medio: q.get("utm_medium"), campana: q.get("utm_campaign"), anuncio: q.get("utm_content"), clic: q.get("fbclid"), fecha: new Date().toISOString() };
  const campana = !!(limpio(o.fuente, 40) || limpio(o.campana, 80));
  let ref = "";
  try { const r = new URL(request.headers.get("referer") || ""); if (r.hostname !== url.hostname) ref = r.hostname.toLowerCase().replace(/^(www|m|l|lm)\./, ""); } catch (e) { /* sin página anterior */ }
  if (!limpio(o.fuente, 40)) {
    const red = ref ? REDES.find(([re]) => re.test(ref)) : null;
    // fbclid sin más datos: llegó de Facebook o Instagram (de un anuncio o de una publicación, no se sabe)
    o.fuente = red ? red[1] : ref || (CLIC.test(String(o.clic || "")) ? "facebook" : "");
  }
  const r = ordenar(o);
  return r ? [r, campana] : null;
}
export function leerOrigen(request) {
  try { return ordenar(JSON.parse(leerCookie(request, C_ORIGEN) || "null")); } catch (e) { return null; }
}
// Al servir la portada: anota el origen (si no había, o si ahora llega de una campaña) y el link del correo (?p=)
export function cookiesOrigen(request, url) {
  const fin = "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + DIAS * 86400 + (url.protocol === "https:" ? "; Secure" : ""), out = [];
  const o = origenDe(request, url);
  if (o && (o[1] || !leerOrigen(request))) out.push(C_ORIGEN + "=" + encodeURIComponent(JSON.stringify(o[0])) + fin);
  const p = url.searchParams.get("p") || "";
  if (ID.test(p)) out.push(C_PROSPECTO + "=" + p + fin);
  return out;
}

// ---------- El correo que se deja desde el celular ----------
const PROSPECTO = (id) => "prospectos/" + id + ".json", PENDIENTE = (id) => "pendientes/prospecto/" + id;
export async function idProspecto(email) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(email).trim().toLowerCase()));
  return [...new Uint8Array(b)].slice(0, 10).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const leerProspecto = async (env, id) => { const o = await env.R2.get(PROSPECTO(id)); return o ? await o.json().catch(() => null) : null; };
// Lo que el panel suma va también en los datos del archivo: así la lista no tiene que abrir cada prospecto
const guardarProspecto = (env, p) => {
  const o = p.origen || {}, e = encodeURIComponent;
  return env.R2.put(PROSPECTO(p.id), JSON.stringify(p), { httpMetadata: JSONH.httpMetadata, customMetadata: { f: e(o.fuente || ""), m: e(o.medio || ""), c: e(o.campana || ""), a: e(o.anuncio || ""), d: p.fecha || "", u: p.cuenta || "" } });
};
// Manda el link: "ok", "tope" (hoy ya no caben: sale después), "baja" (pidió no recibir correos) o "error"
async function mandarLink(env, pr, base, firma) {
  if (await env.R2.head(await claveBajaCorreo(pr.email))) return "baja";
  const kd = "correos/prospectos/" + new Date().toISOString().slice(0, 10), od = await env.R2.get(kd), n = od ? +(await od.text()) || 0 : 0;
  if (n >= PROSPECTOS_DIA) return "tope";
  const baja = enlaceBaja(base, await firma({ bajaCorreo: pr.email })), c = correoCompu({ base, prospecto: true, link: base + "/?p=" + pr.id, baja });
  const cuenta = await contador(env), r = await enviar(env, cuenta, { para: pr.email, asunto: c.asunto, html: c.html, texto: c.texto, baja });
  await cuenta.guardar();
  if (r !== "ok") return r === "tope" ? "tope" : "error";
  await env.R2.put(kd, String(n + 1));
  return "ok";
}
// POST /prospecto {correo} · público, sin sesión. Siempre contesta igual (no dice si ese correo ya estaba).
export async function pedirLink(request, env, url, firma, dispositivo) {
  if (request.method !== "POST") return error(405, "Método no permitido");
  const de = request.headers.get("origin");
  if (de && de !== url.origin) return error(403, "Origen no permitido");
  const c = await request.json().catch(() => null); if (!c || typeof c !== "object") return error(400, "Solicitud inválida");
  // Trampa para robots: el campo escondido lleno o el formulario enviado en menos de 1.2 s. Se contesta «ok» y no se guarda.
  if (limpio(c.sitio, 60) || (+c.tiempo > 0 && +c.tiempo < 1200)) return json({ ok: true });
  const email = String(c.correo == null ? "" : c.correo).trim().toLowerCase();
  if (email.length > 120 || !CORREO.test(email)) return error(400, "Revisa tu correo: parece que le falta algo.");
  const hoy = new Date().toISOString().slice(0, 10), ip = request.headers.get("cf-connecting-ip") || "local";
  const kt = "prospectos-tope/" + hoy + "/" + (await idProspecto(ip)), ot = await env.R2.get(kt), nt = ot ? +(await ot.text()) || 0 : 0;
  if (nt >= PROSPECTO_DIA_IP) return error(429, "Ya te mandamos el link hoy. Revisa tu correo (y la carpeta de spam).");
  await env.R2.put(kt, String(nt + 1));
  const id = await idProspecto(email), ahora = new Date().toISOString(), base = env.DEV ? url.origin : "https://" + (env.DOMINIO || url.hostname);
  let pr = await leerProspecto(env, id);
  // El mismo correo otra vez en 24 h: ya tiene su link, no se manda de nuevo
  if (pr && pr.enviado && Date.now() - Date.parse(pr.enviado) < 864e5) return json({ ok: true });
  if (!pr) pr = { id, email, fecha: ahora, origen: leerOrigen(request), dispositivo: dispositivo || "", pais: (request.cf && request.cf.country) || "", enviado: null, cuenta: null };
  pr.veces = (pr.veces || 0) + 1;
  const r = await mandarLink(env, pr, base, firma).catch(() => "error");
  if (r === "ok") pr.enviado = ahora;
  await guardarProspecto(env, pr);
  // No cupo hoy (o falló): queda apuntado y sale en la siguiente hora en que haya lugar
  if (r === "tope" || r === "error") { await env.R2.put(PENDIENTE(id), ""); return json({ ok: true, despues: true }); }
  return json({ ok: true });
}
// Cada hora: los links que no cupieron en su día. Los de más de 3 días ya no se mandan.
export async function mandarProspectosPendientes(env, base, firma, max = 10) {
  if (!env.ENVIOS) return 0;
  const l = await env.R2.list({ prefix: "pendientes/prospecto/", limit: 60 });
  let mandados = 0;
  for (const o of l.objects) {
    if (mandados >= max) break;
    const id = o.key.split("/").pop(), pr = ID.test(id) ? await leerProspecto(env, id) : null;
    if (!pr || pr.enviado || pr.cuenta || Date.now() - Date.parse(pr.fecha) > 3 * 864e5) { await env.R2.delete(o.key); continue; }
    const r = await mandarLink(env, pr, base, firma).catch(() => "error");
    if (r === "tope") break;
    if (r === "ok") { pr.enviado = new Date().toISOString(); await guardarProspecto(env, pr); mandados++; }
    if (r !== "error") await env.R2.delete(o.key);
  }
  return mandados;
}
// Al crear la cuenta: el origen del correo que dejó en el celular (por su correo o por el link que abrió) o el de la cookie
export async function origenDeCuenta(env, request, email, uid) {
  let pr = null;
  try {
    pr = await leerProspecto(env, await idProspecto(email));
    if (!pr) { const c = leerCookie(request, C_PROSPECTO) || ""; if (ID.test(c)) pr = await leerProspecto(env, c); }
  } catch (e) { /* sin prospecto */ }
  const cookie = leerOrigen(request);
  if (!pr) return cookie;
  if (!pr.cuenta) { pr.cuenta = uid; pr.cuentaFecha = new Date().toISOString(); try { await guardarProspecto(env, pr); await env.R2.delete(PENDIENTE(pr.id)); } catch (e) { /* la cuenta se crea igual */ } }
  return Object.assign({}, pr.origen || cookie || {}, { correo: true });
}
// Panel de dueño: los correos que se dejaron, con su origen (sin abrir cada archivo)
export async function listaProspectos(env) {
  const out = [], d = (v) => { try { return decodeURIComponent(v || ""); } catch (e) { return ""; } };
  let cur, vueltas = 0;
  do {
    const l = await env.R2.list({ prefix: "prospectos/", cursor: cur, limit: 1000, include: ["customMetadata"] });
    for (const o of l.objects) { const m = o.customMetadata || {}; out.push({ fuente: d(m.f), medio: d(m.m), campana: d(m.c), anuncio: d(m.a), fecha: m.d || "", cuenta: !!m.u }); }
    cur = l.truncated ? l.cursor : undefined;
  } while (cur && ++vueltas < 20);
  return out;
}
