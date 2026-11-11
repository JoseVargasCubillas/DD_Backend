/**
 * Conciliación de asientos: dado lo que un elemento del pedido de HubSpot debe
 * dar (un nombre por asiento) y lo que el contacto ya tiene en un evento,
 * decide qué asientos faltan por emitir. Sin base de datos: recibe los boletos
 * ya cargados, así que es fácil de probar.
 *
 * Reglas
 *  · Un asiento se considera cubierto si ya existe un boleto activo con el mismo
 *    nombre en ese evento: del mismo correo (otro negocio del mismo contacto) o
 *    dado de alta a mano desde Asistentes (otro correo, p. ej. el acompañante).
 *  · Los boletos del MISMO elemento del pedido cuentan siempre, incluso los
 *    dados de baja: dar de baja es una decisión del admin y no se reemite.
 *  · Un elemento nunca pasa de su cantidad: si ya emitió tantos asientos como
 *    la cantidad, un cambio de nombre no genera otro (se corrige en Asistentes).
 */

export interface SeatLike {
  attendeeName: string;
  attendeeEmail: string;
  orderId: string;
  status: string;
}

export const normName = (s: string): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// "hubspot:<deal>:<item>" (todos los asientos presenciales) o "…#2", "…#3"
// (un enlace de grupo por asiento en eventos online).
export const isSameLine = (orderId: string, lineRef: string): boolean =>
  orderId === lineRef || orderId.startsWith(`${lineRef}#`);

export const isManualOrder = (orderId: string): boolean => /^manual:/i.test(String(orderId || ''));

export interface SeatPlan {
  // Nombres de los asientos que hay que emitir ahora.
  missing: string[];
  // Asientos que este elemento ya emitió antes (cualquier estado).
  sameLineCount: number;
  // Nombres cubiertos por boletos que ya existen.
  covered: string[];
  // Faltarían, pero superan la cantidad del elemento (no se emiten).
  capped: string[];
}

export const planSeats = (input: {
  tickets: SeatLike[];
  email: string;
  lineRef: string;
  desired: string[];
}): SeatPlan => {
  const email = input.email.trim().toLowerCase();
  const sameLine = input.tickets.filter((t) => isSameLine(t.orderId, input.lineRef));
  const others = input.tickets.filter(
    (t) =>
      !isSameLine(t.orderId, input.lineRef)
      && t.status !== 'void'
      && ((t.attendeeEmail || '').trim().toLowerCase() === email || isManualOrder(t.orderId)),
  );
  const pool = [...sameLine, ...others];
  const used = new Set<SeatLike>();

  const covered: string[] = [];
  const unmatched: string[] = [];
  for (const name of input.desired) {
    const key = normName(name);
    const hit = pool.find((t) => !used.has(t) && normName(t.attendeeName) === key);
    if (hit) {
      used.add(hit);
      covered.push(name);
    } else {
      unmatched.push(name);
    }
  }

  const capacity = Math.max(0, input.desired.length - sameLine.length);
  return {
    missing: unmatched.slice(0, capacity),
    sameLineCount: sameLine.length,
    covered,
    capped: unmatched.slice(capacity),
  };
};
