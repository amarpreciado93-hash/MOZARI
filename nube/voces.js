// Mozari · SONIDO DEL TOUR: LA VOZ (Laboratorio «voz-ia», pedido de Amar 18 nov 2026)
//
// Amar hacía la narración en tres programas: el guion en un chat, la voz en ElevenLabs y la mezcla en un editor.
// Aquí, en la ventana «Sonido del tour» (música y voz juntas): el usuario escribe lo que quiere que se diga,
// ElevenLabs lo lee TAL CUAL (env.ELEVENLABS_KEY, secreto del Worker) y el MP3 queda como la voz de todo el
// recorrido: suena cuando el tour empieza y sigue aunque se cambie de esfera. La mezcla con la música la hace el
// tour (la música baja mientras habla).
//
// Historia: la primera versión hacía una voz por esfera, en Media → Audios («está súper escondida… que se reproduzca
// en el tour general»). La segunda escribía el guion con IA a partir de unas notas. Amar, 19 nov 2026: «la IA
// interpreta lo que queremos decir y ya te genera otro guion. Eso está de más… que únicamente le des el texto
// literalmente de lo que quieres que diga». Se quitó el guion automático (y la IA de Cloudflare de este Worker).
//
// Sin sorpresas de cobro:
//   · cada tour puede crear VOZ_POR_TOUR voces al mes (Amar: «una o dos posibles intentos de voz por desarrollo,
//     porque van a probar las voces a ver cuál les gusta más»). Las muestras de cada voz se oyen sin gastar.
//   · cada cuenta tiene sus letras de voz al mes según su plan (VOZ_LETRAS); la cuenta de prueba no genera voz
//   · hay un tope para todo Mozari al mes (VOZ_TOPE_MES)
//   · la llave de ElevenLabs solo puede hacer voz y lleva su propio tope: 100,000 créditos por periodo, que es lo
//     que da al mes el plan Creator de Amar (lo no usado se acumula hasta el triple); si se acaba, se pausa y aquí se avisa
//
// Qué voces se ofrecen y con qué modelo lo decide el dueño en su panel (config/voz.json), de las voces de su cuenta
// de ElevenLabs. En desarrollo (DEV sin llave) no se llama a nadie: voz de prueba (un tono).
//
//   cuentas/<uid>/voz.json   { mes, letras, tours: { <id>: voces creadas } }   lo usado en el mes
//   config/voz-uso.json      { mes, letras }            lo usado por todo Mozari en el mes
//   config/voz.json          { modelo, voces: [{ id, nombre, tono, muestra }] }

import { json, error } from "./comun.js";

export const VOZ_LETRAS = { gratis: 0, pro: 5000, desarrollos: 12000 };  // letras de voz al mes (unas 900 por minuto; un tour ocupa una voz)
export const VOZ_POR_TOUR = 2;                                           // voces que cada tour puede crear al mes (el dueño no tiene límite)
export const VOZ_TOPE_MES = 90000;                                       // todo Mozari, al mes (hora y media de voz); va por debajo del tope de la llave
export const VOZ_MAX = 1200;                                             // letras por voz (poco más de un minuto)
const VOCES_PRUEBA = [{ id: "prueba-ana", nombre: "Ana", tono: "Cálida", muestra: "" }, { id: "prueba-luis", nombre: "Luis", tono: "Seria", muestra: "" }];

const mesHoy = () => new Date().toISOString().slice(0, 7);
const deJson = async (env, k) => { const o = await env.R2.get(k); return o ? o.json().catch(() => null) : null; };
const aJson = (env, k, v) => env.R2.put(k, JSON.stringify(v), { httpMetadata: { contentType: "application/json" } });
const dePrueba = (env) => !!env.DEV && !env.ELEVENLABS_KEY;
const corto = (t, n) => String(t == null ? "" : t).replace(/\s+/g, " ").trim().slice(0, n);

// Cómo describe ElevenLabs cada voz («male · mexican · middle_aged · casual · es»), dicho en español y de la voz
// («Voz de hombre · mexicana · adulta · casual»). Lo que no se sabe traducir no se muestra; el idioma va aparte.
const TONO_ES = { male: "Voz de hombre", female: "Voz de mujer", neutral: "Voz neutra", "non-binary": "Voz neutra",
  mexican: "mexicana", "latin american": "latina", latin: "latina", spanish: "española", peninsular: "española", castilian: "española", colombian: "colombiana", argentinian: "argentina", argentine: "argentina",
  chilean: "chilena", peruvian: "peruana", venezuelan: "venezolana", american: "estadounidense", british: "británica", australian: "australiana",
  young: "joven", middle_aged: "adulta", "middle aged": "adulta", "middle-aged": "adulta", old: "madura",
  casual: "casual", gentle: "suave", soft: "suave", professional: "profesional", pleasant: "agradable", classy: "elegante", chill: "relajada", relaxed: "relajada", deep: "grave", calm: "tranquila", mature: "madura",
  confident: "segura", warm: "cálida", hyped: "enérgica", energetic: "enérgica", sassy: "atrevida", crisp: "clara", clear: "clara", serious: "seria", upbeat: "alegre", raspy: "rasposa", husky: "ronca",
  formal: "formal", meditative: "serena", excited: "entusiasta", intense: "intensa", resonant: "resonante", authoritative: "firme", "well-rounded": "equilibrada", friendly: "amable", natural: "natural", smooth: "tersa" };
const TONOS_YA = new Set(Object.values(TONO_ES));
export const tonoEs = (t) => [...new Set(String(t || "").split(/\s*·\s*/).map((x) => x.trim()).filter(Boolean).map((x) => TONO_ES[x.toLowerCase()] || (TONOS_YA.has(x) ? x : "")).filter(Boolean))].join(" · ");
// El nombre con el que viene («[Suspense] Eduardo - Mexican Spanish») → el que se ofrece («Eduardo»); el dueño lo puede cambiar
const nombreCorto = (n) => corto(String(n || "").replace(/^\s*\[[^\]]*\]\s*/, "").split(/\s+[-–—]\s+/)[0] || n, 40) || "Voz";

export async function confVoz(env) {
  const c = (await deJson(env, "config/voz.json")) || {};
  const voces = (Array.isArray(c.voces) ? c.voces : []).filter((v) => v && /^[A-Za-z0-9_-]{6,60}$/.test(v.id || "")).slice(0, 12)
    .map((v) => ({ id: v.id, nombre: corto(v.nombre || "Voz", 40), tono: /\b(male|female|middle_aged)\b|·\s*(en|es)\s*$/.test(v.tono || "") ? tonoEs(v.tono) : corto(v.tono, 60), muestra: /^https:\/\/[^\s"<>]+$/.test(v.muestra || "") ? String(v.muestra).slice(0, 400) : "" }));
  return { modelo: /^[a-z0-9_.-]{3,60}$/.test(c.modelo || "") ? c.modelo : "eleven_multilingual_v2", voces: voces.length ? voces : dePrueba(env) ? VOCES_PRUEBA : [] };
}
async function usoVoz(env, uid) {
  const u = (await deJson(env, "cuentas/" + uid + "/voz.json")) || {};
  return u.mes === mesHoy() ? { mes: u.mes, letras: +u.letras || 0, tours: u.tours && typeof u.tours === "object" ? u.tours : {} } : { mes: mesHoy(), letras: 0, tours: {} };
}
async function usoTodos(env) {
  const u = (await deJson(env, "config/voz-uso.json")) || {};
  return u.mes === mesHoy() ? { mes: u.mes, letras: +u.letras || 0 } : { mes: mesHoy(), letras: 0 };
}
// El dueño no tiene límite propio (sí el tope de todo Mozari)
const topeDe = (yo, plan) => (yo.admin ? null : VOZ_LETRAS[plan.id] || 0);
const conectadas = (env) => !!env.ELEVENLABS_KEY || dePrueba(env);

const idTour = (t) => (/^[a-z0-9-]{1,80}$/.test(t || "") ? t : "");
// GET api/voz?tour=<id>: las voces que hay, lo que le queda a la cuenta este mes y las voces que ese tour ya creó
export async function vozEstado(env, yo, plan, tour) {
  const c = await confVoz(env), u = await usoVoz(env, yo.uid);
  return json({ activo: conectadas(env) && c.voces.length > 0, voces: c.voces, usadas: u.letras, tope: topeDe(yo, plan), max: VOZ_MAX, porTour: yo.admin ? null : VOZ_POR_TOUR, creadas: +u.tours[idTour(tour)] || 0 });
}

// ---------- La voz ----------
// Lo que se manda a leer es el texto del usuario tal cual; solo las abreviaturas de los planos van como se dicen
// («Mz 5» → «manzana 5»), porque nadie quiere oír «eme zeta cinco». El texto guardado no se toca.
export const aVoz = (t) => String(t).replace(/\bmza?\.?\s*(\d+)/gi, "manzana $1").replace(/\blt\.?\s*(\d+)/gi, "lote $1").replace(/(\d)\s*m(?:2|²)(?![A-Za-z0-9])/gi, "$1 metros cuadrados")
  .replace(/(\d)\s*km\b/gi, "$1 kilómetros").replace(/(\d)\s*min\b/gi, "$1 minutos").replace(/\bav\.\s*/gi, "avenida ").replace(/\bblvd\.?\s*/gi, "bulevar ").replace(/\s+/g, " ").trim();
// Voz de prueba (desarrollo): un tono que dura lo que duraría el texto
function wavPrueba(seg) {
  const hz = 8000, n = Math.max(hz, Math.min(hz * 60, Math.round(seg * hz))), b = new Uint8Array(44 + n), v = new DataView(b.buffer), w = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, hz, true); v.setUint32(28, hz, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(24 * Math.sin((i / hz) * 2 * Math.PI * 220));
  return b.buffer;
}
const NO_HAY = "Las voces de Mozari no están disponibles por ahora. Mientras, puedes subir tu propio audio.";
async function leerEleven(env, conf, vozId, texto) {
  const RESPALDO = "eleven_multilingual_v2";
  const pedir = (modelo, conIdioma) => fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(vozId) + "?output_format=mp3_44100_128", { method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify(Object.assign({ text: texto, model_id: modelo, apply_text_normalization: "auto" }, conIdioma ? { language_code: "es" } : {})) }).catch(() => null);
  const conIdioma = /v2_5|v3|v4/.test(conf.modelo); // los modelos nuevos aceptan que se les fije el idioma; el multilingüe v2 no
  const noLoAcepta = (x) => x && (x.status === 400 || x.status === 422);
  let r = await pedir(conf.modelo, conIdioma);
  if (noLoAcepta(r) && conIdioma) r = await pedir(conf.modelo, false);
  // Un modelo nuevo puede pedir las cosas de otra forma: antes de fallarle al usuario, sale con el de siempre
  if (noLoAcepta(r) && conf.modelo !== RESPALDO) { console.error("voz: " + conf.modelo + " no aceptó el pedido; sale con " + RESPALDO); r = await pedir(RESPALDO, false); }
  if (!r) return { status: 502, error: "No se pudo conectar con el servicio de voz. Inténtalo otra vez." };
  if (r.ok) { const audio = await r.arrayBuffer(); return audio.byteLength > 500 ? { audio } : { status: 502, error: "La voz salió vacía. Inténtalo otra vez." }; }
  const d = await r.json().catch(() => ({})), det = d && d.detail, est = String((det && det.status) || ""), msg = String((det && (det.message || det)) || "").slice(0, 300);
  console.error("voz: ElevenLabs respondió " + r.status + " " + est + " " + msg);
  if (r.status === 402 || /quota|credit|payment|insufficient|balance/i.test(est + " " + msg)) return { status: 503, error: NO_HAY };
  if (r.status === 404 || /voice_not_found/i.test(est)) return { status: 400, error: "Esa voz ya no está disponible. Elige otra." };
  if (r.status === 401 || r.status === 403) return { status: 503, error: NO_HAY };
  if (r.status === 429) return { status: 429, error: "Hay muchas voces generándose. Inténtalo en un minuto." };
  return { status: 502, error: "No se pudo generar la voz. Inténtalo otra vez." };
}

// POST api/tours/<id>/voz/audio  { texto, voz } → { ruta, peso, letras, usadas, tope, voz, creadas, porTour }
// usoDe y limite vienen del estudio (el espacio de la cuenta y su respuesta de «llegaste al límite»)
export async function vozAudio(request, env, yo, plan, base, usoDe, limite, tour) {
  const c = await request.json().catch(() => ({})), texto = corto(c.texto, VOZ_MAX + 50), conf = await confVoz(env), voz = conf.voces.find((v) => v.id === c.voz);
  if (texto.length < 5) return error(400, "Escribe primero lo que quieres que diga la voz");
  if (texto.length > VOZ_MAX) return error(400, "El texto pasa de " + VOZ_MAX.toLocaleString("es-MX") + " letras (poco más de un minuto). Acórtalo un poco.");
  if (!conectadas(env) || !conf.voces.length) return error(503, NO_HAY);
  if (!voz) return error(400, "Elige una voz");
  const u = await usoVoz(env, yo.uid), tope = topeDe(yo, plan), todos = await usoTodos(env), t = idTour(tour), creadas = +u.tours[t] || 0;
  if (!yo.admin && creadas >= VOZ_POR_TOUR) return error(429, "Este tour ya creó sus " + VOZ_POR_TOUR + " voces de este mes. Quédate con la que tienes o sube tu propio audio; el día 1 puedes crear otra.");
  if (tope !== null && u.letras + texto.length > tope) return limite(tope ? "Este mes ya usaste tus " + tope.toLocaleString("es-MX") + " letras de voz. Se renuevan el día 1; mientras, puedes subir tu propio audio." : "Las voces de Mozari vienen con las licencias Pro y Desarrollos. Con tu cuenta de prueba puedes subir tu propio audio.", "voz");
  if (todos.letras + texto.length > VOZ_TOPE_MES) return error(503, "Las voces de Mozari llegaron a su tope de este mes y vuelven el día 1. Mientras, puedes subir tu propio audio.");
  if (plan.bytes !== null) { const esp = await usoDe(env, yo.uid); if (esp.bytes + texto.length * 1100 > plan.bytes) return limite("No queda espacio en tu cuenta para guardar la voz. Borra un tour o una esfera que ya no uses.", "espacio"); }
  let audio, ext = "mp3";
  if (dePrueba(env)) { audio = wavPrueba(texto.length / 15); ext = "wav"; }
  else { const r = await leerEleven(env, conf, voz.id, aVoz(texto)); if (!r.audio) return error(r.status, r.error); audio = r.audio; }
  const ruta = "archivos/voz-" + Date.now().toString(36) + "." + ext;
  await env.R2.put(base + ruta, audio, { httpMetadata: { contentType: ext === "mp3" ? "audio/mpeg" : "audio/wav" } });
  u.letras += texto.length; todos.letras += texto.length;
  if (t) { u.tours[t] = creadas + 1; const ks = Object.keys(u.tours); if (ks.length > 400) delete u.tours[ks[0]]; }
  await Promise.all([aJson(env, "cuentas/" + yo.uid + "/voz.json", u), aJson(env, "config/voz-uso.json", todos)]);
  return json({ ruta, peso: audio.byteLength, letras: texto.length, usadas: u.letras, tope, voz: voz.nombre, creadas: t ? u.tours[t] : 0, porTour: yo.admin ? null : VOZ_POR_TOUR });
}

// ---------- Panel de dueño ----------
//   GET  api/admin/voz            cómo está: llave, modelo, voces elegidas y lo usado en el mes
//   PUT  api/admin/voz            { modelo, voces: [{ id, nombre, tono, muestra }] }
//   GET  api/admin/voz/catalogo   las voces y los modelos de la cuenta de ElevenLabs, y su saldo
export async function adminVoz(request, env, partes) {
  const m = request.method;
  if (partes.length === 3 && m === "GET") {
    const c = await confVoz(env), t = await usoTodos(env);
    return json({ llave: !!env.ELEVENLABS_KEY, prueba: dePrueba(env), modelo: c.modelo, voces: c.voces, usoMes: t.letras, topeMes: VOZ_TOPE_MES, porPlan: VOZ_LETRAS, porTour: VOZ_POR_TOUR, max: VOZ_MAX });
  }
  if (partes.length === 3 && m === "PUT") {
    const c = await request.json().catch(() => ({})), antes = (await deJson(env, "config/voz.json")) || {};
    const voces = Array.isArray(c.voces) ? c.voces.filter((v) => v && /^[A-Za-z0-9_-]{6,60}$/.test(v.id || "")).slice(0, 12).map((v) => ({ id: v.id, nombre: corto(v.nombre || "Voz", 40), tono: corto(v.tono, 60), muestra: /^https:\/\/[^\s"<>]+$/.test(v.muestra || "") ? String(v.muestra).slice(0, 400) : "" })) : antes.voces || [];
    const modelo = typeof c.modelo === "string" ? c.modelo.trim() : antes.modelo || "eleven_multilingual_v2";
    if (!/^[a-z0-9_.-]{3,60}$/.test(modelo)) return error(400, "Ese modelo de voz no es válido");
    await aJson(env, "config/voz.json", { modelo, voces });
    return json({ ok: true, modelo, voces });
  }
  if (partes[3] === "catalogo" && partes.length === 4 && m === "GET") {
    if (!env.ELEVENLABS_KEY) return error(503, "Falta la llave de ElevenLabs (secreto ELEVENLABS_KEY del Worker)");
    const h = { "xi-api-key": env.ELEVENLABS_KEY }, pedir = (u) => fetch("https://api.elevenlabs.io" + u, { headers: h }).then(async (r) => ({ s: r.status, d: await r.json().catch(() => null) })).catch(() => ({ s: 0, d: null }));
    const [v, mo, sub] = await Promise.all([pedir("/v1/voices"), pedir("/v1/models"), pedir("/v1/user/subscription")]);
    if (v.s !== 200) return error(502, "ElevenLabs no dio las voces (respuesta " + v.s + "). Revisa que la llave tenga permiso de voces y de texto a voz.");
    const voces = ((v.d && v.d.voices) || []).map((x) => { const l = x.labels || {}; return { id: x.voice_id, nombre: nombreCorto(x.name), completo: corto(x.name, 80), tono: tonoEs([l.gender, l.accent, l.age, l.descriptive || l.description].filter(Boolean).join(" · ")), idioma: corto(l.language, 8), muestra: x.preview_url || "", tipo: x.category || "" }; }).filter((x) => x.id);
    const modelos = (Array.isArray(mo.d) ? mo.d : []).filter((x) => x && x.can_do_text_to_speech).map((x) => ({ id: x.model_id, nombre: corto(x.name, 60) }));
    const s = sub.d || {}, saldo = sub.s === 200 ? { plan: corto(s.tier, 30), usadas: +s.character_count || 0, incluidas: +s.character_limit || 0, renueva: s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toISOString().slice(0, 10) : "" } : null;
    return json({ voces, modelos, saldo });
  }
  return error(404, "Ruta desconocida");
}
