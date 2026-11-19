// Mozari · VOZ DEL TOUR, CON GUION (Laboratorio «voz-ia», pedido de Amar 18 nov 2026)
//
// Amar hacía la narración en tres programas: el guion en un chat, la voz en ElevenLabs y la mezcla en un editor.
// Aquí, en Interfaz → «Voz del tour»: Mozari escribe el guion (la IA de Cloudflare, env.AI), ElevenLabs lo lee
// (env.ELEVENLABS_KEY, secreto del Worker) y el MP3 queda como la voz de todo el recorrido: suena cuando el tour
// empieza y sigue aunque se cambie de esfera. La mezcla con la música ya la hace el tour (baja mientras habla).
// (La primera versión hacía una voz por esfera, en Media → Audios. Amar: «está súper escondida… que no se reproduzca
// en cada esfera, que se reproduzca en el tour general».)
//
// Sin sorpresas de cobro:
//   · cada cuenta tiene sus letras de voz al mes según su plan (VOZ_LETRAS); la cuenta de prueba no genera voz
//   · hay un tope para todo Mozari al mes (VOZ_TOPE_MES)
//   · la llave de ElevenLabs solo puede hacer voz y lleva su propio tope: 100,000 créditos por mes de los 300,000
//     del plan de Amar (así Mozari no se come los créditos de sus videos); si se acaba, se pausa y aquí se avisa
//
// Qué voces se ofrecen y con qué modelo lo decide el dueño en su panel (config/voz.json), de las voces de su cuenta
// de ElevenLabs. En desarrollo (DEV sin llave) no se llama a nadie: guion y voz de prueba (un tono).
//
//   cuentas/<uid>/voz.json   { mes, letras, guiones }   lo usado en el mes
//   config/voz-uso.json      { mes, letras }            lo usado por todo Mozari en el mes
//   config/voz.json          { modelo, voces: [{ id, nombre, tono, muestra }] }

import { json, error } from "./comun.js";

export const VOZ_LETRAS = { gratis: 0, pro: 15000, desarrollos: 40000 }; // letras de voz al mes (unas 900 por minuto)
export const VOZ_TOPE_MES = 90000;                                       // todo Mozari, al mes (hora y media de voz); va por debajo del tope de la llave
export const VOZ_MAX = 1200;                                             // letras por voz (poco más de un minuto)
const GUIONES_MES = 400;                                                 // guiones escritos por cuenta al mes
const MODELOS_GUION = ["@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"]; // el segundo, si el primero falla
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
  return u.mes === mesHoy() ? { mes: u.mes, letras: +u.letras || 0, guiones: +u.guiones || 0 } : { mes: mesHoy(), letras: 0, guiones: 0 };
}
async function usoTodos(env) {
  const u = (await deJson(env, "config/voz-uso.json")) || {};
  return u.mes === mesHoy() ? { mes: u.mes, letras: +u.letras || 0 } : { mes: mesHoy(), letras: 0 };
}
// El dueño no tiene límite propio (sí el tope de todo Mozari)
const topeDe = (yo, plan) => (yo.admin ? null : VOZ_LETRAS[plan.id] || 0);
const conectadas = (env) => !!env.ELEVENLABS_KEY || dePrueba(env);

// GET api/voz: las voces que hay y lo que le queda a la cuenta este mes
export async function vozEstado(env, yo, plan) {
  const c = await confVoz(env), u = await usoVoz(env, yo.uid);
  return json({ activo: conectadas(env) && c.voces.length > 0, voces: c.voces, usadas: u.letras, tope: topeDe(yo, plan), max: VOZ_MAX });
}

// ---------- El guion ----------
const LARGOS = { corta: 38, media: 75, larga: 150 }; // palabras: a unas 2.5 por segundo son 15, 30 y 60 segundos
const TONOS = { cercano: "cercano y tranquilo, como alguien que conoce el lugar y lo enseña con gusto", elegante: "sobrio y elegante, sin adornos", directo: "directo y claro, al grano" };
function mensajesGuion(d) {
  const n = LARGOS[d.largo];
  const sistema = "Escribes el guion de la voz que presenta un recorrido virtual 360 de una casa, un departamento, un local o un desarrollo en México. " +
    "La voz suena una sola vez, cuando el recorrido empieza, y acompaña a quien lo va viendo mientras pasa de un espacio a otro.\n\nReglas:\n" +
    "- Español de México, natural, como lo diría una persona al mostrar el lugar. Frases cortas, fáciles de decir en voz alta.\n" +
    "- Habla SOLO de lo que te dan: el nombre del proyecto y las notas. Cada dato que digas tiene que estar ahí, casi con las mismas palabras. No inventes medidas, precios, amenidades, materiales, ubicaciones, vistas, sensaciones ni promesas. Si dudas de un dato, no lo digas.\n" +
    "- Los espacios del recorrido son solo contexto para que sepas qué se va a ver. No los enumeres: menciona uno o dos como mucho, y solo si ayudan.\n" +
    "- Si no hay notas, presenta el lugar en dos o tres frases e invita a recorrerlo a su ritmo, sin inventar detalles.\n" +
    "- Sin frases de anuncio ni clichés: nada de «no es solo», «más que un», «imagina», «el lugar de tus sueños», «bienvenido», «bienvenida», «te damos la bienvenida», «descubre», «déjate llevar», «un espacio pensado para ti».\n" +
    "- Los números y las abreviaturas van escritos como se dicen: «manzana cinco», «doscientos metros cuadrados».\n" +
    "- Sin emojis, sin comillas, sin títulos, sin listas, sin acotaciones. Un solo párrafo.\n" +
    "- Tono: " + TONOS[d.tono] + ".\n" +
    "- Largo: unas " + n + " palabras (entre " + (n - 8) + " y " + (n + 8) + ").\n\nResponde únicamente con el guion.";
  const pedido = ["Proyecto: " + (d.proyecto || "(sin nombre)"), d.espacios.length && "Espacios del recorrido (solo contexto): " + d.espacios.slice(0, 8).join(", "), "Notas de quien lo vende: " + (d.notas || "(ninguna)")].filter(Boolean).join("\n");
  return [{ role: "system", content: sistema }, { role: "user", content: pedido }];
}
// La respuesta de la IA cambia de forma según el modelo: se busca el texto donde venga
function textoIA(r) {
  if (!r) return "";
  if (typeof r === "string") return r;
  if (typeof r.response === "string") return r.response;
  if (typeof r.output_text === "string") return r.output_text;
  const c = Array.isArray(r.choices) && r.choices[0];
  if (c && c.message && typeof c.message.content === "string") return c.message.content;
  if (Array.isArray(r.output)) return r.output.map((o) => (o && Array.isArray(o.content) ? o.content.filter((x) => x && (x.type === "output_text" || x.type === "text")).map((x) => x.text || "").join("") : "")).join("");
  if (r.result && r.result !== r) return textoIA(r.result);
  return "";
}
function limpiarGuion(t) {
  t = String(t || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^\s*(guion|guión|narración|texto)\s*:\s*/i, "").replace(/[*_#`]/g, "").replace(/\s+/g, " ").trim().replace(/^["«“]+|["»”]+$/g, "").trim();
  if (t.length > VOZ_MAX) { const c = t.slice(0, VOZ_MAX), fin = Math.max(c.lastIndexOf(". "), c.lastIndexOf("? "), c.lastIndexOf("! ")); t = fin > 200 ? c.slice(0, fin + 1) : c; }
  return t;
}
const guionPrueba = (d) => "Este es " + (d.proyecto || "el recorrido") + ". " + (d.notas ? d.notas.replace(/[.\s]*$/, ".") : "Recórrelo a tu ritmo.") + (d.espacios.length ? " Empieza por " + d.espacios[0] + "." : "");

// POST api/tours/<id>/voz/guion  { proyecto, espacios, notas, largo, tono } → { texto }
export async function vozGuion(request, env, yo) {
  const c = await request.json().catch(() => ({})), u = await usoVoz(env, yo.uid);
  if (u.guiones >= GUIONES_MES) return error(429, "Este mes ya pediste muchos guiones. Escribe este tú o espera al día 1.");
  const d = { proyecto: corto(c.proyecto, 90), espacios: (Array.isArray(c.espacios) ? c.espacios : []).map((x) => corto(x, 40)).filter(Boolean).slice(0, 20), notas: corto(c.notas, 800),
    largo: LARGOS[c.largo] ? c.largo : "media", tono: TONOS[c.tono] ? c.tono : "cercano" };
  if (!d.proyecto && !d.notas) return error(400, "Ponle nombre a tu tour o escribe de qué quieres hablar");
  let texto = "";
  if (env.DEV) texto = guionPrueba(d);
  else if (!env.AI) return error(503, "El guion automático no está disponible. Escríbelo tú en el recuadro.");
  else for (const modelo of MODELOS_GUION) {
    try { texto = limpiarGuion(textoIA(await env.AI.run(modelo, { messages: mensajesGuion(d), max_tokens: /gpt-oss/.test(modelo) ? 2000 : 600, temperature: 0.7 }))); }
    catch (e) { console.error("voz: el guion falló con " + modelo, String((e && e.message) || e).slice(0, 300)); texto = ""; }
    if (texto.length >= 20) break;
  }
  if (texto.length < 20) return error(502, "No se pudo escribir el guion. Inténtalo otra vez o escríbelo tú.");
  u.guiones++; await aJson(env, "cuentas/" + yo.uid + "/voz.json", u);
  return json({ texto });
}

// ---------- La voz ----------
// Lo que se manda a leer: las abreviaturas de los planos, como se dicen (el guion guardado no se toca)
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

// POST api/tours/<id>/voz/audio  { texto, voz } → { ruta, peso, letras, usadas, tope, voz }
// usoDe y limite vienen del estudio (el espacio de la cuenta y su respuesta de «llegaste al límite»)
export async function vozAudio(request, env, yo, plan, base, usoDe, limite) {
  const c = await request.json().catch(() => ({})), texto = corto(c.texto, VOZ_MAX + 50), conf = await confVoz(env), voz = conf.voces.find((v) => v.id === c.voz);
  if (texto.length < 5) return error(400, "Escribe primero el guion");
  if (texto.length > VOZ_MAX) return error(400, "El guion pasa de " + VOZ_MAX.toLocaleString("es-MX") + " letras (poco más de un minuto). Acórtalo un poco.");
  if (!conectadas(env) || !conf.voces.length) return error(503, NO_HAY);
  if (!voz) return error(400, "Elige una voz");
  const u = await usoVoz(env, yo.uid), tope = topeDe(yo, plan), todos = await usoTodos(env);
  if (tope !== null && u.letras + texto.length > tope) return limite(tope ? "Este mes ya usaste tus " + tope.toLocaleString("es-MX") + " letras de voz. Se renuevan el día 1; mientras, puedes subir tu propio audio." : "Las voces de Mozari vienen con las licencias Pro y Desarrollos. Con tu cuenta de prueba puedes subir tu propio audio.", "voz");
  if (todos.letras + texto.length > VOZ_TOPE_MES) return error(503, "Las voces de Mozari llegaron a su tope de este mes y vuelven el día 1. Mientras, puedes subir tu propio audio.");
  if (plan.bytes !== null) { const esp = await usoDe(env, yo.uid); if (esp.bytes + texto.length * 1100 > plan.bytes) return limite("No queda espacio en tu cuenta para guardar la voz. Borra un tour o una esfera que ya no uses.", "espacio"); }
  let audio, ext = "mp3";
  if (dePrueba(env)) { audio = wavPrueba(texto.length / 15); ext = "wav"; }
  else { const r = await leerEleven(env, conf, voz.id, aVoz(texto)); if (!r.audio) return error(r.status, r.error); audio = r.audio; }
  const ruta = "archivos/voz-" + Date.now().toString(36) + "." + ext;
  await env.R2.put(base + ruta, audio, { httpMetadata: { contentType: ext === "mp3" ? "audio/mpeg" : "audio/wav" } });
  u.letras += texto.length; todos.letras += texto.length;
  await Promise.all([aJson(env, "cuentas/" + yo.uid + "/voz.json", u), aJson(env, "config/voz-uso.json", todos)]);
  return json({ ruta, peso: audio.byteLength, letras: texto.length, usadas: u.letras, tope, voz: voz.nombre });
}

// ---------- Panel de dueño ----------
//   GET  api/admin/voz            cómo está: llave, IA, modelo, voces elegidas y lo usado en el mes
//   PUT  api/admin/voz            { modelo, voces: [{ id, nombre, tono, muestra }] }
//   GET  api/admin/voz/catalogo   las voces y los modelos de la cuenta de ElevenLabs, y su saldo
//   POST api/admin/voz/prueba     escribe un guion corto con cada modelo de IA (para ver que responden)
export async function adminVoz(request, env, partes) {
  const m = request.method;
  if (partes.length === 3 && m === "GET") {
    const c = await confVoz(env), t = await usoTodos(env);
    return json({ llave: !!env.ELEVENLABS_KEY, ia: !!env.AI, prueba: dePrueba(env), modelo: c.modelo, voces: c.voces, usoMes: t.letras, topeMes: VOZ_TOPE_MES, porPlan: VOZ_LETRAS, max: VOZ_MAX });
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
  if (partes[3] === "prueba" && partes.length === 4 && m === "POST") {
    if (!env.AI) return error(503, "La IA de Cloudflare no está conectada a este Worker");
    const d = { proyecto: "Lomas del Encino", espacios: ["Acceso", "Casa club", "Lago", "Lotes"], notas: "Desarrollo campestre a diez minutos de León, con casa club y lago.", largo: "corta", tono: "cercano" }, salida = [];
    for (const modelo of MODELOS_GUION) {
      try { const r = await env.AI.run(modelo, { messages: mensajesGuion(d), max_tokens: /gpt-oss/.test(modelo) ? 2000 : 600, temperature: 0.7 }); salida.push({ modelo, forma: r && typeof r === "object" ? Object.keys(r).slice(0, 12) : typeof r, texto: limpiarGuion(textoIA(r)) }); }
      catch (e) { salida.push({ modelo, error: String((e && e.message) || e).slice(0, 300) }); }
    }
    return json({ salida });
  }
  return error(404, "Ruta desconocida");
}
