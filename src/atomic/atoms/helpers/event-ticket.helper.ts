// Etiquetas de fecha/formato que distinguen una edición de un evento en la
// orden, el recibo y los correos. Son sólo texto de presentación: nunca
// intervienen en el precio.

const MAX_LABEL_LENGTH = 80;

// Los valores de catálogo (sin Event en la DB) llegan del cliente: se limpian
// de saltos de línea / caracteres de control / "<>" y se acotan.
export const sanitizeTicketLabel = (value: unknown): string =>
  typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH)
    : '';

// "Viernes 16 de octubre de 2026"; con fecha de fin en otro día, un rango:
// "4 al 5 de septiembre de 2026".
export const formatEventDateLabel = (value: Date | string, endValue?: Date | string | null): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const part = (d: Date, options: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat('es-MX', { ...options, timeZone: 'America/Mexico_City' }).format(d);

  const end = endValue ? new Date(endValue) : null;
  if (end && !Number.isNaN(end.getTime())) {
    const dayKey = (d: Date): string => part(d, { day: 'numeric', month: 'numeric', year: 'numeric' });
    if (dayKey(end) !== dayKey(date)) {
      const sameMonth =
        part(date, { month: 'numeric', year: 'numeric' }) === part(end, { month: 'numeric', year: 'numeric' });
      return sameMonth
        ? `${part(date, { day: 'numeric' })} al ${part(end, { day: 'numeric' })} de ${part(end, { month: 'long' })} de ${part(end, { year: 'numeric' })}`
        : `${part(date, { day: 'numeric', month: 'long' })} al ${part(end, { day: 'numeric', month: 'long' })} de ${part(end, { year: 'numeric' })}`;
    }
  }

  const label = part(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(',', '');
  return label.charAt(0).toUpperCase() + label.slice(1);
};

// "Online · Zoom" / "Presencial · CDMX" / "Híbrido · CDMX"
export const formatEventFormatLabel = (modality: string | undefined, location: string | undefined): string => {
  const place = (location || '').trim();
  if (modality === 'online') {
    return `Online · ${!place || /^online$/i.test(place) ? 'Zoom' : place}`;
  }
  const label = modality === 'hybrid' ? 'Híbrido' : 'Presencial';
  return place ? `${label} · ${place}` : label;
};

// Título de la orden: "<base> · <lugar> · <fecha>". El lugar es lo que va
// después de la modalidad en el formato ("Zoom", "CDMX", "Sede por confirmar").
export const buildEventTicketTitle = (base: string, eventFormat: string, eventDate: string): string => {
  const place = eventFormat.includes(' · ') ? eventFormat.split(' · ').slice(1).join(' · ') : eventFormat;
  return [base, place, eventDate].filter(Boolean).join(' · ');
};
