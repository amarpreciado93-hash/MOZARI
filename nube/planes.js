// Mozari · planes y límites
//
// El servidor es quien manda: aunque alguien cambie la página, no puede pasar sus límites.
// null = sin límite.

const GB = 1024 ** 3;

export const PLANES = {
  gratis:      { nombre: "Gratis",      tours: 1,    esferas: 5,    bytes: 2 * GB,   lotificacion: false, marca: true,  precio: 0,   lanzamiento: 0 },
  pro:         { nombre: "Pro",         tours: null, esferas: null, bytes: 10 * GB,  lotificacion: false, marca: false, precio: 990,  lanzamiento: 990 },
  desarrollos: { nombre: "Desarrollos", tours: null, esferas: null, bytes: 50 * GB,  lotificacion: true,  marca: false, precio: 4990, lanzamiento: 4990 },
};

// Licencias de PAGO ÚNICO (pesos MXN): se paga una vez y el plan no vence. El hosting va incluido
// dentro de los GB de cada licencia; quien necesita más compra paquetes de espacio (también de una vez).
export const COBROS = {
  pro:         { unico: 990 },
  desarrollos: { unico: 4990 },
  espacio:     { unico: 390 },      // +10 GB para siempre (aunque se llene, 10 años de hosting quedan pagados)
};
export const ESPACIO_PAQUETE = 10 * GB;
// Los mismos productos en dólares para quien paga fuera de México con PayPal. Suben lo necesario para que,
// tras la comisión de PayPal (~4.45% + 0.30 USD + IVA) y el cambio a pesos (~3.5%), quede lo mismo que en México.
export const COBROS_USD = { pro: 59, desarrollos: 299, espacio: 25 };
export const PERIODOS = { unico: { nombre: "pago único", meses: 0 }, mes: { nombre: "1 mes", meses: 1 }, anio: { nombre: "1 año", meses: 12 } };
// Lo que paga hoy una cuenta por una licencia (si ya tiene Pro, para subir a Desarrollos paga la diferencia)
export function montoLicencia(cuenta, plan, moneda) {
  const tabla = moneda === "USD" ? COBROS_USD : { pro: COBROS.pro.unico, desarrollos: COBROS.desarrollos.unico, espacio: COBROS.espacio.unico };
  if (plan === "espacio") return tabla.espacio;
  const base = tabla[plan];
  if (!base) return null;
  const actual = planDe(cuenta);
  if (actual.id === plan && !actual.vence) return null;              // ya la tiene
  if (plan === "desarrollos" && actual.id === "pro" && !actual.vence) return base - tabla.pro;
  return base;
}

// Suma meses a una fecha (si cae en un día que no existe, se va al último del mes)
export function sumarMeses(desde, meses) {
  const d = new Date(desde), dia = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + meses);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d;
}

// El plan de una cuenta. El dueño de Mozari no tiene límites.
// Un plan pagado tiene fecha "vence"; al pasar, la cuenta vuelve a Gratis (sus tours no se borran).
// Un plan que asignó el dueño a mano (sin "vence") no caduca.
export function planDe(cuenta) {
  if (cuenta.admin) return Object.assign({ id: "desarrollos" }, PLANES.desarrollos, { tours: null, esferas: null, bytes: null });
  let id = PLANES[cuenta.plan] ? cuenta.plan : "gratis";
  const vence = cuenta.vence || null, vencido = !!vence && new Date(vence) < new Date();
  const anterior = vencido && id !== "gratis" ? id : null;
  if (vencido) id = "gratis";
  const extra = +cuenta.extraBytes || 0; // paquetes de espacio comprados (se quedan aunque cambie el plan)
  const base = Object.assign({ id }, PLANES[id], { vence: vencido ? null : vence, vencido: anterior });
  if (extra && base.bytes !== null) base.bytes += extra;
  base.extraBytes = extra;
  return base;
}

export const pasa = (limite, valor) => limite === null || valor <= limite;

// ¿El proyecto usa la lotificación? (lotes, o capas copiadas con el terreno)
export const usaLotificacion = (p) => Object.values(p.capas || {}).some((l) => (l || []).some((c) => c && c.lote));
