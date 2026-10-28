// Mozari · verificación de Cloudflare Access
//
// El estudio vive detrás de Cloudflare Access: solo entra quien tú autorices (tu correo).
// Access manda en cada petición un token firmado (Cf-Access-Jwt-Assertion). Aquí se comprueba
// la firma con las llaves públicas de tu equipo, que el token sea para esta aplicación (AUD)
// y que no haya vencido. Si algo falta o no cuadra, se rechaza: nunca se abre por omisión.

let llaves = null, llavesHasta = 0;

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const texto = (bytes) => new TextDecoder().decode(bytes);

async function llavesDe(equipo) {
  if (llaves && Date.now() < llavesHasta) return llaves;
  const r = await fetch("https://" + equipo + "/cdn-cgi/access/certs");
  if (!r.ok) throw new Error("No se pudieron leer las llaves de Access");
  const { keys } = await r.json();
  llaves = {};
  for (const k of keys) {
    llaves[k.kid] = await crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  }
  llavesHasta = Date.now() + 60 * 60 * 1000;
  return llaves;
}

// Devuelve { email } si la petición viene autorizada por Access; si no, null.
export async function usuario(request, env) {
  // Solo para pruebas en la computadora (wrangler dev). En Cloudflare nunca existe DEV.
  if (env.DEV === "1" && new URL(request.url).hostname === "localhost") return { email: "local@mozari" };

  const equipo = env.ACCESS_EQUIPO, aud = env.ACCESS_AUD;
  if (!equipo || !aud) return null;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const cab = JSON.parse(texto(b64url(partes[0])));
    const datos = JSON.parse(texto(b64url(partes[1])));
    const k = (await llavesDe(equipo))[cab.kid];
    if (!k || cab.alg !== "RS256") return null;
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", k, b64url(partes[2]), new TextEncoder().encode(partes[0] + "." + partes[1]));
    if (!ok) return null;
    const ahora = Math.floor(Date.now() / 1000);
    const auds = Array.isArray(datos.aud) ? datos.aud : [datos.aud];
    if (!auds.includes(aud)) return null;
    if (datos.exp && datos.exp < ahora) return null;
    if (datos.iss && datos.iss !== "https://" + equipo) return null;
    return { email: datos.email || "" };
  } catch (e) {
    return null;
  }
}
