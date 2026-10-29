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

// El plan de una cuenta. El dueño de Mozari no tiene límites.
export function planDe(cuenta) {
  if (cuenta.admin) return Object.assign({ id: "desarrollos" }, PLANES.desarrollos, { tours: null, esferas: null, bytes: null });
  const id = PLANES[cuenta.plan] ? cuenta.plan : "gratis";
  return Object.assign({ id }, PLANES[id]);
}

export const pasa = (limite, valor) => limite === null || valor <= limite;

// ¿El proyecto usa la lotificación? (lotes, o capas copiadas con el terreno)
export const usaLotificacion = (p) => Object.values(p.capas || {}).some((l) => (l || []).some((c) => c && c.lote));
