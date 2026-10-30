// Mozari · cobros: Mercado Pago (México, en pesos) y PayPal (resto del mundo, en dólares).
// Licencias de pago único y paquetes de espacio; el cliente elige cómo pagar.
//
// 1. El estudio pide /api/pagos/checkout {plan, periodo} → se crea una orden en R2 (pagos/<ref>.json)
//    y una "preferencia" en Mercado Pago → el cliente paga en Mercado Pago (tarjeta, OXXO, saldo).
// 2. Mercado Pago avisa a /webhooks/mercadopago y además regresa al cliente a /?pago=ok.
//    En los dos casos NO se confía en lo que llega: se consulta el pago directo a Mercado Pago
//    con nuestra llave y solo si está aprobado, en pesos y por el monto exacto, se activa el plan.
// 3. Activar es idempotente: el mismo pago nunca suma tiempo dos veces.
//
// Secretos del Worker: MP_ACCESS_TOKEN (Mercado Pago) y PAYPAL_CLIENT_ID + PAYPAL_SECRET (PayPal, app "Live").
// PayPal: se crea una orden con el monto en USD, el cliente la aprueba en PayPal y al regresar el servidor
// la CAPTURA (ahí se cobra); solo si quedó COMPLETED, en USD y por el monto exacto, se activa la licencia.
// Si el cliente no regresa, la orden no se captura y no se le cobra nada.
// Sin secretos y con DEV=1 (solo en la computadora) los pagos se simulan.

import { json, error } from "./comun.js";
import { perfil } from "./sesion.js";
import { PLANES, COBROS, COBROS_USD, PERIODOS, sumarMeses, montoLicencia, ESPACIO_PAQUETE } from "./planes.js";

const MP = "https://api.mercadopago.com";
const ordenClave = (ref) => "pagos/" + ref + ".json";
const REF = /^mz-[a-z0-9]{6,40}$/;
const simulado = (env) => !env.MP_ACCESS_TOKEN && env.DEV === "1";
const ppSimulado = (env) => !(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET) && env.DEV === "1";
const PP = (env) => (env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com");
let ppToken = null;
async function paypal(env, ruta, opciones = {}) {
  if (!ppToken || ppToken.vence < Date.now()) {
    const t = await fetch(PP(env) + "/v1/oauth2/token", { method: "POST", headers: { authorization: "Basic " + btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_SECRET), "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
    if (!t.ok) throw new Error("PayPal no aceptó las llaves (" + t.status + ")");
    const d = await t.json();
    ppToken = { valor: d.access_token, vence: Date.now() + (d.expires_in - 120) * 1000 };
  }
  const r = await fetch(PP(env) + ruta, Object.assign({}, opciones, { headers: Object.assign({ authorization: "Bearer " + ppToken.valor, "content-type": "application/json" }, opciones.headers || {}) }));
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, d };
}
// Captura (cobra) una orden de PayPal aprobada y, si quedó pagada por lo correcto, activa la licencia
async function capturarPayPal(env, orden) {
  if (orden.aplicado) return orden;
  if (!/^[A-Z0-9]{8,40}$/.test(orden.paypal || "")) return orden;
  let r = await paypal(env, "/v2/checkout/orders/" + orden.paypal + "/capture", { method: "POST", headers: { "paypal-request-id": orden.ref + "-cap" } });
  if (!r.ok) r = await paypal(env, "/v2/checkout/orders/" + orden.paypal); // ya capturada antes, o aún sin aprobar
  const o = r.d || {}, pu = (o.purchase_units || [])[0] || {}, cap = ((pu.payments || {}).captures || [])[0];
  if (o.status === "COMPLETED" && cap && cap.status === "COMPLETED") {
    const ok = (pu.custom_id || pu.reference_id) === orden.ref && cap.amount && cap.amount.currency_code === "USD" && Math.abs(+cap.amount.value - orden.monto) < 0.01;
    if (!ok) { orden.estado = "revisar"; orden.nota = "Monto, moneda u orden no coinciden"; await guardar(env, ordenClave(orden.ref), orden); return orden; }
    return activar(env, orden, cap.id);
  }
  if (cap && cap.status === "PENDING") { orden.estado = "pendiente"; await guardar(env, ordenClave(orden.ref), orden); }
  return orden;
}

async function leer(env, clave) { const o = await env.R2.get(clave); return o ? o.json() : null; }
const guardar = (env, clave, datos) => env.R2.put(clave, JSON.stringify(datos), { httpMetadata: { contentType: "application/json" } });

async function mp(env, ruta, opciones = {}) {
  const r = await fetch(MP + ruta, Object.assign({}, opciones, {
    headers: Object.assign({ authorization: "Bearer " + env.MP_ACCESS_TOKEN, "content-type": "application/json" }, opciones.headers || {}),
  }));
  if (!r.ok) throw new Error("Mercado Pago " + r.status);
  return r.json();
}

// Suma el periodo pagado a la cuenta. Si ya tenía ese mismo plan vigente, se suma al final.
async function activar(env, orden, pagoId) {
  if (orden.aplicado) return orden;
  const p = await perfil(env, orden.uid);
  if (!p) return orden;
  const ahora = new Date();
  if (orden.plan === "espacio") p.extraBytes = (+p.extraBytes || 0) + ESPACIO_PAQUETE * (orden.cantidad || 1);
  else if (orden.periodo === "unico") { p.plan = orden.plan; delete p.vence; } // licencia para siempre
  else {
    const vigente = p.plan === orden.plan && p.vence && new Date(p.vence) > ahora;
    const desde = vigente ? new Date(p.vence) : ahora;
    p.plan = orden.plan;
    p.vence = sumarMeses(desde, PERIODOS[orden.periodo].meses).toISOString();
  }
  p.ultimoPago = { ref: orden.ref, fecha: ahora.toISOString(), monto: orden.monto };
  await guardar(env, "cuentas/" + p.uid + "/perfil.json", p);
  Object.assign(orden, { estado: "aprobado", aplicado: ahora.toISOString(), pago: String(pagoId), vence: p.vence || null });
  await guardar(env, ordenClave(orden.ref), orden);
  return orden;
}

// Consulta un pago en Mercado Pago y, si es bueno, activa su orden
async function revisarPago(env, pagoId) {
  if (!/^\d{1,20}$/.test(String(pagoId || ""))) return null;
  const pago = await mp(env, "/v1/payments/" + pagoId);
  const ref = pago.external_reference;
  if (!REF.test(ref || "")) return null;
  const orden = await leer(env, ordenClave(ref));
  if (!orden) return null;
  if (pago.status === "approved") {
    if (pago.currency_id !== "MXN" || Math.abs(+pago.transaction_amount - orden.monto) > 0.01) {
      orden.estado = "revisar"; orden.nota = "Monto o moneda no coinciden"; orden.pago = String(pagoId);
      await guardar(env, ordenClave(ref), orden);
      return orden;
    }
    return activar(env, orden, pagoId);
  }
  if (!orden.aplicado) {
    orden.estado = pago.status === "pending" || pago.status === "in_process" ? "pendiente" : "rechazado";
    orden.pago = String(pagoId);
    await guardar(env, ordenClave(ref), orden);
  }
  return orden;
}

const resumen = (o) => ({ ref: o.ref, plan: o.plan, periodo: o.periodo, monto: o.monto, estado: o.estado, vence: o.vence || null });

// /api/pagos/... (con sesión)
export async function apiPagos(request, env, partes, yo) {
  const m = request.method, url = new URL(request.url);
  if (partes[2] === "precios" && m === "GET") {
    const pais = (request.cf && request.cf.country) || "";
    const precios = (mon) => ({ pro: montoLicencia(yo, "pro", mon), desarrollos: montoLicencia(yo, "desarrollos", mon), espacio: montoLicencia(yo, "espacio", mon) });
    return json({ pais, sugerido: pais && pais !== "MX" ? "paypal" : "mercadopago", mxn: precios("MXN"), usd: precios("USD"),
      metodos: { mercadopago: !!env.MP_ACCESS_TOKEN || simulado(env), paypal: !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET) || ppSimulado(env) } });
  }

  if (partes[2] === "checkout" && m === "POST") {
    const c = await request.json().catch(() => ({}));
    if (!COBROS[c.plan]) return error(400, "Plan inválido");
    c.periodo = "unico";
    if (yo.admin) return error(400, "Tu cuenta ya tiene todo incluido");
    const conPayPal = c.metodo === "paypal";
    const montoHoy = montoLicencia(yo, c.plan, conPayPal ? "USD" : "MXN");
    if (!montoHoy) return error(400, "Ya tienes esa licencia");
    const ref = "mz-" + Date.now().toString(36) + crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    if (conPayPal) {
      if (!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET) && !ppSimulado(env)) return error(503, "El pago con PayPal aún no está activo. Usa Mercado Pago o escríbenos.");
      const nombre = c.plan === "espacio" ? "Mozari +10 GB de espacio" : "Mozari " + PLANES[c.plan].nombre + " · licencia de pago único";
      const orden = { ref, uid: yo.uid, email: yo.email, plan: c.plan, periodo: "unico", monto: montoHoy, moneda: "USD", metodo: "paypal", estado: "creado", creado: new Date().toISOString() };
      await guardar(env, ordenClave(ref), orden);
      if (ppSimulado(env)) return json({ ref, url: url.origin + "/api/pagos/simular?ref=" + ref });
      const r = await paypal(env, "/v2/checkout/orders", {
        method: "POST", headers: { "paypal-request-id": ref },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [{ reference_id: ref, custom_id: ref, description: nombre, amount: { currency_code: "USD", value: montoHoy.toFixed(2) } }],
          payment_source: { paypal: { experience_context: { brand_name: "Mozari", locale: "es-MX", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", return_url: url.origin + "/?pago=ok&metodo=paypal&external_reference=" + ref, cancel_url: url.origin + "/?pago=error" } } },
        }),
      });
      const link = r.ok && (r.d.links || []).find((l) => l.rel === "payer-action" || l.rel === "approve");
      if (!link) return error(502, "PayPal no respondió. Intenta de nuevo en un momento.");
      orden.paypal = r.d.id; await guardar(env, ordenClave(ref), orden);
      return json({ ref, url: link.href });
    }
    if (!env.MP_ACCESS_TOKEN && !simulado(env)) return error(503, "Los pagos aún no están activos. Escríbenos y te activamos el plan.");
    const monto = montoHoy, plan = c.plan === "espacio" ? { nombre: "+10 GB de espacio" } : PLANES[c.plan], periodo = PERIODOS.unico;
    const orden = { ref, uid: yo.uid, email: yo.email, plan: c.plan, periodo: c.periodo, monto, moneda: "MXN", estado: "creado", creado: new Date().toISOString() };
    await guardar(env, ordenClave(ref), orden);
    if (simulado(env)) return json({ ref, url: url.origin + "/api/pagos/simular?ref=" + ref });
    const pref = await mp(env, "/checkout/preferences", {
      method: "POST",
      headers: { "x-idempotency-key": ref },
      body: JSON.stringify({
        items: [{ id: c.plan + "-unico", title: "Mozari " + plan.nombre + (c.plan === "espacio" ? "" : " · licencia de pago único"), quantity: 1, unit_price: monto, currency_id: "MXN" }],
        payer: { email: yo.email },
        external_reference: ref,
        back_urls: { success: url.origin + "/?pago=ok", pending: url.origin + "/?pago=pendiente", failure: url.origin + "/?pago=error" },
        auto_return: "approved",
        notification_url: url.origin + "/webhooks/mercadopago?ref=" + ref,
        statement_descriptor: "MOZARI",
      }),
    });
    orden.preferencia = pref.id;
    await guardar(env, ordenClave(ref), orden);
    return json({ ref, url: pref.init_point });
  }

  // Al regresar de Mercado Pago: confirma el pago sin esperar al aviso
  if (partes[2] === "verificar" && m === "POST") {
    const c = await request.json().catch(() => ({}));
    let orden = null;
    if (c.payment_id && env.MP_ACCESS_TOKEN) orden = await revisarPago(env, c.payment_id).catch(() => null);
    if (!orden && REF.test(c.ref || "")) orden = await leer(env, ordenClave(c.ref));
    if (!orden || orden.uid !== yo.uid) return error(404, "No encontramos ese pago");
    if (orden.metodo === "paypal" && !orden.aplicado && env.PAYPAL_CLIENT_ID) orden = await capturarPayPal(env, orden).catch(() => orden);
    return json(resumen(orden));
  }

  // Solo en la computadora: hace como que Mercado Pago aprobó el pago
  if (partes[2] === "simular" && m === "GET" && (simulado(env) || ppSimulado(env))) {
    const ref = url.searchParams.get("ref") || "";
    const orden = REF.test(ref) ? await leer(env, ordenClave(ref)) : null;
    if (!orden || orden.uid !== yo.uid) return error(404, "No existe esa orden");
    await activar(env, orden, "simulado");
    return Response.redirect(url.origin + "/?pago=ok&external_reference=" + ref, 302);
  }
  return error(404, "Ruta desconocida");
}

// /webhooks/mercadopago (público: Mercado Pago avisa aquí). Siempre responde 200 para que no reintente sin fin.
export async function webhookMercadoPago(request, env) {
  if (!env.MP_ACCESS_TOKEN) return new Response("ok");
  const url = new URL(request.url);
  const c = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const tipo = c.type || c.topic || url.searchParams.get("type") || url.searchParams.get("topic");
  const id = (c.data && c.data.id) || url.searchParams.get("data.id") || (tipo === "payment" ? url.searchParams.get("id") : null);
  if (tipo === "payment" && id) {
    try { await revisarPago(env, id); }
    catch (e) { return new Response("reintentar", { status: 500 }); }
  }
  return new Response("ok");
}
