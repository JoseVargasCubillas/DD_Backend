// GENERADO por `npm run catalog:gen` a partir del calendario fijo del frontend
// (DD_Frontend/src/utils/eventCalendar.ts). NO editar a mano: regenerar y commitear
// cuando cambie el calendario. Lo usa el polling de HubSpot para boletos de ediciones
// que viven solo en el calendario del sitio y no tienen fila en la tabla `events`.

export interface CatalogEvent {
  title: string;
  slug: string;
  startDate: string;
  endDate?: string;
  location: string;
  modality: 'in-person' | 'online' | 'hybrid' | 'unknown';
}

export const EVENT_CATALOG: CatalogEvent[] = [
  {
    "title": "De persona física a moral",
    "slug": "de-persona-fisica-a-moral",
    "startDate": "2026-08-28T09:07:00-06:00",
    "location": "Zoom",
    "modality": "online"
  },
  {
    "title": "Mentalidad empresarial",
    "slug": "mentalidad-empresarial",
    "startDate": "2026-09-03T09:07:00-06:00",
    "location": "CDMX",
    "modality": "in-person"
  },
  {
    "title": "Cumbre: sistema de prospección digital",
    "slug": "cumbre-sistema-prospeccion-digital",
    "startDate": "2026-09-04T09:07:00-06:00",
    "location": "CDMX",
    "modality": "in-person"
  },
  {
    "title": "Taller de estrategia fiscal",
    "slug": "taller-estrategia-fiscal-online-septiembre",
    "startDate": "2026-09-11T09:07:00-06:00",
    "location": "Zoom",
    "modality": "online"
  },
  {
    "title": "Mastermind Panamá",
    "slug": "mastermind-panama",
    "startDate": "2026-09-15T09:07:00-06:00",
    "location": "Panamá",
    "modality": "in-person"
  },
  {
    "title": "Holding",
    "slug": "holding-septiembre",
    "startDate": "2026-09-22T09:07:00-06:00",
    "location": "Zoom",
    "modality": "online"
  },
  {
    "title": "Taller de estrategia fiscal",
    "slug": "taller-estrategia-fiscal-cdmx-septiembre",
    "startDate": "2026-09-25T09:07:00-06:00",
    "location": "CDMX",
    "modality": "in-person"
  },
  {
    "title": "De 48 a 40 horas laborales",
    "slug": "de-48-a-40-horas-laborales",
    "startDate": "2026-10-12T17:00:00-06:00",
    "location": "YouTube",
    "modality": "online"
  },
  {
    "title": "Taller de estrategia fiscal",
    "slug": "taller-estrategia-fiscal-online-octubre",
    "startDate": "2026-10-16T09:07:00-06:00",
    "location": "Zoom",
    "modality": "online"
  },
  {
    "title": "Revisión Estratégica",
    "slug": "revision-estrategica-octubre-2026",
    "startDate": "2026-10-21T09:07:00-06:00",
    "location": "CDMX",
    "modality": "in-person"
  },
  {
    "title": "Taller de estrategia fiscal",
    "slug": "taller-estrategia-fiscal-cdmx-octubre",
    "startDate": "2026-10-22T09:07:00-06:00",
    "location": "CDMX",
    "modality": "in-person"
  },
  {
    "title": "Coaching para el liderazgo",
    "slug": "coaching-para-el-liderazgo",
    "startDate": "2026-10-23T09:07:00-06:00",
    "endDate": "2026-10-24T17:00:00-06:00",
    "location": "CDMX",
    "modality": "in-person"
  },
  {
    "title": "Masterclass Holding",
    "slug": "holding-octubre",
    "startDate": "2026-10-27T09:07:00-06:00",
    "location": "Online",
    "modality": "online"
  },
  {
    "title": "Taller de estrategia fiscal",
    "slug": "taller-estrategia-fiscal-monterrey",
    "startDate": "2026-11-06T09:07:00-06:00",
    "location": "Monterrey",
    "modality": "in-person"
  },
  {
    "title": "El Tablero del CEO",
    "slug": "tablero-del-ceo-noviembre",
    "startDate": "2026-11-10T10:00:00-06:00",
    "location": "Zoom",
    "modality": "online"
  },
  {
    "title": "4E Código Rockefeller",
    "slug": "4e-codigo-rockefeller",
    "startDate": "2026-11-20T09:07:00-06:00",
    "location": "CDMX",
    "modality": "in-person"
  },
  {
    "title": "Holding",
    "slug": "holding-noviembre",
    "startDate": "2026-11-24T09:07:00-06:00",
    "location": "Zoom",
    "modality": "online"
  },
  {
    "title": "Maestría escénica",
    "slug": "maestria-escenica",
    "startDate": "2026-12-04T09:07:00-06:00",
    "location": "CDMX",
    "modality": "in-person"
  },
  {
    "title": "Taller de estrategia fiscal",
    "slug": "taller-estrategia-fiscal-online-diciembre",
    "startDate": "2026-12-10T09:07:00-06:00",
    "location": "Zoom",
    "modality": "online"
  }
] as CatalogEvent[];
