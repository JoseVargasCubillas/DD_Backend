import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export interface IWaClickDocument extends SqlDocumentMethods<IWaClickDocument> {
  /** Etiqueta lógica del botón: 'events-sales' | 'events-waitlist' | 'events-direct' | 'contact-channel' | 'nav-cta' | etc. */
  source: string;
  /** Ruta (`window.location.pathname`) desde la que se hizo click. */
  page?: string;
  /** Mensaje pre-cargado, útil para filtrar campañas. */
  message?: string;
  /** ID anónimo del visitante (localStorage, sobrevive entre sesiones). */
  anonId?: string;
  /** Referrer si hubiera. */
  referrer?: string;
  userAgent?: string;
  /** IP normalizada (opcional). */
  ip?: string;
  meta?: Record<string, unknown>;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const WaClick = createSqlModel<IWaClickDocument>({
  table: 'wa_clicks',
  defaults: () => ({
    source: 'other',
    meta: {},
  }),
});
