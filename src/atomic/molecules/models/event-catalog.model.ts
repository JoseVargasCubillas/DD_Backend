import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

// Tabla `event_catalog`: copia del calendario fijo del frontend (una fila por
// edición, kind 'entry') más una fila 'meta' con la última sincronización. La
// llena el botón "Actualizar calendario" del admin y la lee el polling de
// HubSpot para resolver ediciones que no tienen fila en `events`.
export interface IEventCatalogDocument extends SqlDocumentMethods<IEventCatalogDocument> {
  kind: 'entry' | 'meta';
  // kind === 'entry'
  slug?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  modality?: string;
  // kind === 'meta'
  syncedAt?: string;
  syncedBy?: string;
  count?: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const EventCatalog = createSqlModel<IEventCatalogDocument>({
  table: 'event_catalog',
  defaults: () => ({}),
});
