import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export type ShipmentStatus = 'pending' | 'processing' | 'label_created' | 'rejected' | 'error';

export interface IShipmentItem {
  bookId: string;
  slug: string;
  title: string;
  quantity: number;
  unitPrice: number;
}

export interface IShipmentTrackingEvent {
  date: string;
  description: string;
  location: string;
}

// Solicitud de envío de libros capturada por un asesor. Queda `pending` hasta
// que un admin la aprueba (ahí se genera la guía real en Envia) o la rechaza.
export type ShipmentSource = 'advisor' | 'web';

export interface IShipmentDocument extends SqlDocumentMethods<IShipmentDocument> {
  status: ShipmentStatus;
  // 'advisor': captura de un asesor, requiere aprobación. 'web': compra pagada
  // en la tienda; la guía sale sola y esta fila es solo su espejo para verla,
  // rastrearla y reintentarla desde el mismo lugar.
  source: ShipmentSource;
  // Solo source === 'web': pedido (Order) que originó el envío.
  orderId: string;
  advisorId: string;
  advisorName: string;
  customer: { name: string; phone: string; email: string };
  address: {
    street: string;
    colony: string;
    postalCode: string;
    city: string;
    state: string;
    references: string;
  };
  items: IShipmentItem[];
  notes: string;
  // Avisos no bloqueantes detectados al capturar (calle sin número, etc.).
  warnings: string[];
  // Cotización estimada al capturar; el costo real queda en shippingCost.
  quotedPrice: number | null;
  carrier: string;
  service: string;
  shippingCost: number | null;
  trackingNumber: string;
  labelUrl: string;
  trackUrl: string;
  // Estado reportado por Envia/paquetería (texto tal cual) y su clasificación.
  enviaStatus: string;
  deliveryState: 'unknown' | 'in_transit' | 'delivered' | 'incident';
  enviaEvents: IShipmentTrackingEvent[];
  enviaCheckedAt: Date | string | null;
  rejectionReason: string;
  error: string;
  // Resultado de cada aviso al aprobar/rechazar ("Cliente (WhatsApp): enviado",
  // "Asesor (correo): omitido (sin correo)"…), para saber por qué no llegó.
  notifications: string[];
  reviewedAt: Date | string | null;
  reviewedBy: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Shipment = createSqlModel<IShipmentDocument>({
  table: 'shipments',
  defaults: () => ({
    status: 'pending',
    source: 'advisor',
    orderId: '',
    notes: '',
    warnings: [],
    quotedPrice: null,
    carrier: '',
    service: '',
    shippingCost: null,
    trackingNumber: '',
    labelUrl: '',
    trackUrl: '',
    enviaStatus: '',
    deliveryState: 'unknown',
    enviaEvents: [],
    enviaCheckedAt: null,
    rejectionReason: '',
    error: '',
    notifications: [],
    reviewedAt: null,
    reviewedBy: '',
  }),
});
