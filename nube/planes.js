// Mozari · planes y límites
//
// El servidor es quien manda: aunque alguien cambie la página, no puede pasar sus límites.
// null = sin límite.

const GB = 1024 ** 3;

export const PLANES = {
  gratis:      { nombre: "Gratis",      tours: 1,    esferas: 5,    bytes: 2 * GB,   lotificacion: false, marca: true,  precio: 0,   lanzamiento: 0 },
  pro:         { nombre: "Pro",         tours: null, esferas: null, bytes: 20 * GB,  lotificacion: false, marca: false, precio: 399, lanzamiento: 299 },
  desarrollos: { nombre: "Desarrollos", tours: null, esferas: null, bytes: 100 * GB, lotificacion: true,  marca: false, precio: 999, lanzamiento: 799 },
};

// Lo que se cobra (pesos MXN). Precio de lanzamiento; el año cuesta 10 meses.
export const COBROS = {
  pro:         { mes: 299, anio: 2990 },
  desarrollos: { mes: 799, anio: 7990 },
};
export const PERIODOS = { mes: { nombre: "1 mes", meses: 1 }, anio: { nombre: "1 año", meses: 12 } };

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
  return Object.assign({ id }, PLANES[id], { vence: vencido ? null : vence, vencido: anterior });
}

export const pasa = (limite, valor) => limite === null || valor <= limite;

// ¿El proyecto usa la lotificación? (lotes, o capas copiadas con el terreno)
export const usaLotificacion = (p) => Object.values(p.capas || {}).some((l) => (l || []).some((c) => c && c.lote));
