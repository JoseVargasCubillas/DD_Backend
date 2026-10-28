import { randomBytes } from 'node:crypto';
import { env } from '../../../config/env.js';
import { Shipment, IShipmentDocument, IShipmentItem, ShipmentStatus } from '../../molecules/models/shipment.model.js';
import { ShippingAdvisor, IShippingAdvisorDocument } from '../../molecules/models/shipping-advisor.model.js';
import { IBookDocument } from '../../molecules/models/book.model.js';
import { Order, IOrderDocument, IOrderShippingAddress } from '../../molecules/models/order.model.js';
import { User } from '../../molecules/models/user.model.js';
import { ORDER_STATUS } from '../../atoms/constants/status.constant.js';
import { getBookBySlug, listBooks } from './book.service.js';
import {
  generateShippingLabel,
  getShippingRates,
  isEnviaConfigured,
  ShippingLabel,
  ShippingPackage,
  ShippingRateOption,
  trackShipment,
} from './shipping.service.js';
import { buildShippingPackages } from '../../atoms/helpers/shipping-packages.helper.js';
import { validateDeliveryAddress, normalizeMxPhone } from './address-validation.service.js';
import { sendWhatsappTemplate, type TemplateParam } from './whatsapp-cloud.service.js';
import { ADMIN_NOTICE_EMAIL, sendShipmentAdminNotice, sendShipmentNoticeEmail } from './email.service.js';

// Flujo: el asesor captura el envio desde su link (sin login) -> queda `pending`
// -> un admin lo revisa y aprueba (se genera la guia real en Envia) o lo
// rechaza con un motivo. Nada se cobra en Envia hasta la aprobacion.

const makeError = (message: string, statusCode: number, extra: Record<string, unknown> = {}): Error =>
  Object.assign(new Error(message), { statusCode, ...extra });

const nowIso = (): string => new Date().toISOString();
const DUPLICATE_WINDOW_MS = 48 * 3600 * 1000;
const MAX_TRACKING_REFRESH = 40;

// ── Asesores (links) ─────────────────────────────────────────

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const newToken = (): string => randomBytes(24).toString('base64url');

export const findActiveAdvisorByToken = async (token: string): Promise<IShippingAdvisorDocument | null> => {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const advisor = await ShippingAdvisor.findOne({ token });
  return advisor && advisor.isActive ? advisor : null;
};

export const listAdvisors = async () => {
  const [advisors, shipments] = await Promise.all([ShippingAdvisor.find({}), Shipment.find({})]);
  return advisors
    .sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime())
    .map((advisor) => {
      const own = shipments.filter((s) => s.advisorId === advisor._id);
      return {
        _id: advisor._id,
        name: advisor.name,
        phone: advisor.phone,
        email: advisor.email ?? '',
        token: advisor.token,
        isActive: advisor.isActive,
        lastUsedAt: advisor.lastUsedAt ?? null,
        createdAt: advisor.createdAt,
        shipmentsCount: own.length,
        pendingCount: own.filter((s) => s.status === 'pending').length,
      };
    });
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const parseAdvisorEmail = (raw: unknown): string => {
  const email = String(raw ?? '').trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw makeError('El correo del asesor no es válido', 400);
  return email;
};

export const createAdvisor = async (input: { name?: string; phone?: string; email?: string }) => {
  const name = String(input.name || '').trim();
  if (name.length < 2) throw makeError('El nombre del asesor es requerido', 400);
  return ShippingAdvisor.create({
    name,
    phone: String(input.phone || '').trim(),
    email: parseAdvisorEmail(input.email),
    token: newToken(),
  });
};

export const updateAdvisor = async (
  id: string,
  input: { name?: string; phone?: string; email?: string; isActive?: boolean },
) => {
  const advisor = await ShippingAdvisor.findById(id);
  if (!advisor) throw makeError('Asesor no encontrado', 404);
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (name.length < 2) throw makeError('El nombre del asesor es requerido', 400);
    advisor.name = name;
  }
  if (input.phone !== undefined) advisor.phone = String(input.phone).trim();
  if (input.email !== undefined) advisor.email = parseAdvisorEmail(input.email);
  if (input.isActive !== undefined) advisor.isActive = Boolean(input.isActive);
  return advisor.save();
};

// Genera un token nuevo: el link anterior deja de funcionar al instante.
export const rotateAdvisorToken = async (id: string) => {
  const advisor = await ShippingAdvisor.findById(id);
  if (!advisor) throw makeError('Asesor no encontrado', 404);
  advisor.token = newToken();
  return advisor.save();
};

// ── Validación ───────────────────────────────────────────────

export interface ShipmentDraft {
  customer?: { name?: string; phone?: string; email?: string };
  address?: {
    street?: string;
    colony?: string;
    postalCode?: string;
    city?: string;
    state?: string;
    references?: string;
  };
  items?: Array<{ slug?: string; quantity?: number }>;
  notes?: string;
}

interface NormalizedDraft {
  customer: IShipmentDocument['customer'];
  address: IShipmentDocument['address'];
  items: IShipmentItem[];
  notes: string;
  books: Array<{ book: IBookDocument; quantity: number }>;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  quote: ShippingRateOption | null;
  duplicate: { id: string; createdAt: string; status: ShipmentStatus } | null;
  normalized: NormalizedDraft | null;
}

const clean = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();

const toShippingAddress = (s: Pick<IShipmentDocument, 'customer' | 'address'>): IOrderShippingAddress => ({
  fullName: s.customer.name,
  phone: s.customer.phone,
  street: s.address.street,
  colony: s.address.colony,
  postalCode: s.address.postalCode,
  city: s.address.city,
  state: s.address.state,
  references: s.address.references,
});

const buildPackages = (books: Array<{ book: IBookDocument; quantity: number }>): ShippingPackage[] =>
  buildShippingPackages(
    books.map(({ book, quantity }) => ({
      type: 'product',
      refId: book._id,
      title: book.title,
      price: Number(book.price),
      quantity,
      weightKg: Number(book.weightKg || 0.5),
      lengthCm: Number(book.lengthCm || 23),
      widthCm: Number(book.widthCm || 16),
      heightCm: Number(book.heightCm || 3),
    })),
  );

const findDuplicate = async (phone: string, excludeId?: string) => {
  const cutoff = Date.now() - DUPLICATE_WINDOW_MS;
  const all = await Shipment.find({});
  const match = all
    .filter(
      (s) =>
        s._id !== excludeId &&
        s.status !== 'rejected' &&
        s.customer?.phone === phone &&
        new Date(String(s.createdAt)).getTime() >= cutoff,
    )
    .sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime())[0];
  return match ? { id: match._id, createdAt: String(match.createdAt), status: match.status } : null;
};

export const validateShipmentDraft = async (
  draft: ShipmentDraft,
  options: { excludeId?: string } = {},
): Promise<ValidationResult> => {
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = clean(draft.customer?.name);
  const email = clean(draft.customer?.email).toLowerCase();
  const street = clean(draft.address?.street);
  const colony = clean(draft.address?.colony);
  const postalCode = String(draft.address?.postalCode ?? '').replace(/\D/g, '');
  const city = clean(draft.address?.city);
  const state = clean(draft.address?.state);
  const references = clean(draft.address?.references);
  const notes = clean(draft.notes);

  if (name.length < 3) errors.push('Escribe el nombre completo del destinatario.');
  else if (!name.includes(' ')) warnings.push('El nombre parece incompleto: verifica que lleve nombre y apellido.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('El correo del cliente no es válido.');

  // Teléfono, calle, colonia, ciudad, CP y estado (incluye contraste con
  // SEPOMEX): mismas reglas que el checkout web.
  const addressCheck = await validateDeliveryAddress({
    phone: draft.customer?.phone,
    street,
    colony,
    postalCode,
    city,
    state,
  });
  errors.push(...addressCheck.errors);
  warnings.push(...addressCheck.warnings);
  const phone = addressCheck.phone;

  const books: Array<{ book: IBookDocument; quantity: number }> = [];
  const items: IShipmentItem[] = [];
  const rawItems = Array.isArray(draft.items) ? draft.items : [];
  if (!rawItems.length) errors.push('Agrega al menos un libro.');
  for (const raw of rawItems) {
    const slug = clean(raw?.slug);
    const quantity = Math.floor(Number(raw?.quantity));
    if (!slug) continue;
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 50) {
      errors.push('La cantidad de cada libro debe ser entre 1 y 50.');
      continue;
    }
    try {
      const book = await getBookBySlug(slug);
      const existing = books.find((b) => b.book._id === book._id);
      if (existing) existing.quantity += quantity;
      else books.push({ book, quantity });
      if (Number(book.stock) <= 0) warnings.push(`"${book.title}" aparece sin inventario; confirma que haya existencia.`);
    } catch {
      errors.push('Uno de los libros seleccionados ya no está disponible.');
    }
  }
  for (const { book, quantity } of books) {
    items.push({ bookId: book._id, slug: book.slug, title: book.title, quantity, unitPrice: Number(book.price) });
  }

  let quote: ShippingRateOption | null = null;
  const formOk = !errors.length;
  if (formOk) {
    if (!isEnviaConfigured()) {
      warnings.push('No se pudo verificar la cobertura de la paquetería (Envia no está configurado).');
    } else {
      const shippingAddress = toShippingAddress({
        customer: { name, phone, email },
        address: { street, colony, postalCode, city, state, references },
      });
      try {
        const rates = await getShippingRates(shippingAddress, buildPackages(books));
        if (!rates.length) {
          errors.push(
            'Ninguna paquetería cubre ese destino. Revisa que el código postal, la ciudad y el estado coincidan.',
          );
        } else {
          quote = [...rates].sort((a, b) => a.totalPrice - b.totalPrice)[0];
        }
      } catch (err) {
        warnings.push(`No se pudo cotizar el envío (${(err as Error).message}). Verifica el domicilio con cuidado.`);
      }
    }
  }

  const duplicate = phone.length === 10 ? await findDuplicate(phone, options.excludeId) : null;

  const normalized: NormalizedDraft | null = formOk
    ? {
        customer: { name, phone, email },
        address: { street, colony, postalCode, city, state, references },
        items,
        notes,
        books,
      }
    : null;

  return { errors, warnings, quote, duplicate, normalized };
};

// ── Captura pública ──────────────────────────────────────────

export const listPublicBooks = async () => {
  const books = await listBooks();
  return books.map((b) => ({ slug: b.slug, title: b.title, format: b.format, inStock: Number(b.stock) > 0 }));
};

export const submitShipment = async (
  advisor: IShippingAdvisorDocument,
  draft: ShipmentDraft,
  options: { confirmDuplicate?: boolean } = {},
): Promise<IShipmentDocument> => {
  const result = await validateShipmentDraft(draft);
  if (result.errors.length || !result.normalized) {
    throw makeError('Hay datos por corregir', 400, { errors: result.errors, warnings: result.warnings });
  }
  if (result.duplicate && !options.confirmDuplicate) {
    throw makeError('Ya hay un envío reciente para este teléfono', 409, {
      code: 'duplicate',
      duplicate: result.duplicate,
      warnings: result.warnings,
    });
  }

  const { customer, address, items, notes } = result.normalized;
  const shipment = await Shipment.create({
    status: 'pending',
    advisorId: advisor._id,
    advisorName: advisor.name,
    customer,
    address,
    items,
    notes,
    warnings: result.warnings,
    quotedPrice: result.quote?.totalPrice ?? null,
  } as Partial<IShipmentDocument>);

  advisor.lastUsedAt = nowIso();
  await advisor.save().catch(() => undefined);

  void notifyAdminOfNewShipment(shipment, result.quote);
  return shipment;
};

export const listAdvisorShipments = async (advisorId: string) => {
  const all = await Shipment.find({});
  return all
    .filter((s) => s.advisorId === advisorId)
    .sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime())
    .slice(0, 30)
    .map((s) => ({
      _id: s._id,
      status: s.status,
      customerName: s.customer.name,
      destination: `${s.address.city}, ${s.address.state}`,
      itemsTitle: s.items.map((i) => `${i.quantity}× ${i.title}`).join(', '),
      carrier: s.carrier,
      trackingNumber: s.trackingNumber,
      trackUrl: s.trackUrl,
      enviaStatus: s.enviaStatus,
      rejectionReason: s.rejectionReason,
      createdAt: s.createdAt,
    }));
};

// ── Notificaciones ───────────────────────────────────────────

const itemsSummary = (items: IShipmentItem[]): string => items.map((i) => `${i.quantity}× ${i.title}`).join(', ');

const notifyAdminOfNewShipment = async (shipment: IShipmentDocument, quote: ShippingRateOption | null) => {
  const destination = `${shipment.address.colony}, ${shipment.address.city}, ${shipment.address.state} CP ${shipment.address.postalCode}`;
  const summary = itemsSummary(shipment.items);

  const tasks: Array<Promise<unknown>> = [
    sendShipmentAdminNotice({
      shipmentId: shipment._id,
      advisorName: shipment.advisorName,
      customerName: shipment.customer.name,
      customerPhone: shipment.customer.phone,
      destination,
      itemsTitle: summary,
      quotedPrice: quote?.totalPrice ?? null,
      warnings: shipment.warnings,
    }),
  ];

  if (env.shipping.notifyWhatsapp) {
    tasks.push(
      whatsappOutcome('Admin', env.shipping.notifyWhatsapp, env.whatsapp.cloud.templates.shipmentAdmin, tplParams([
        ['asesor', shipment.advisorName],
        ['cliente', shipment.customer.name],
        ['libros', summary],
        ['destino', `${shipment.address.city}, ${shipment.address.state} (CP ${shipment.address.postalCode})`],
      ])).then((line) => {
        if (!/enviado/.test(line)) console.warn(`[shipment] aviso WhatsApp a admin: ${line}`);
      }),
    );
  }

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'rejected') console.error('[shipment] aviso a admin falló:', (r.reason as Error)?.message);
  }
};

// Cada aviso devuelve una línea legible con su resultado; se guardan en el
// envío (`notifications`) para que el admin vea por qué no llegó algo.
// Pares [nombre, valor] en el orden de la plantilla. Los nombres son los de las
// variables en Meta (minúsculas, sin acentos); en modo posicional solo cuenta el orden.
const tplParams = (pairs: Array<[string, string]>): TemplateParam[] => pairs.map(([name, value]) => ({ name, value }));

const whatsappOutcome = async (label: string, phone: string, template: string, params: TemplateParam[]): Promise<string> => {
  if (!template) return `${label} (WhatsApp): omitido (plantilla no configurada)`;
  if (!phone) return `${label} (WhatsApp): omitido (sin teléfono)`;
  try {
    const result = await sendWhatsappTemplate({ to: phone, template, params });
    if (result.status === 'sent') return `${label} (WhatsApp): enviado`;
    if (result.status === 'skipped') return `${label} (WhatsApp): omitido (${result.error ?? 'WhatsApp no configurado'})`;
    return `${label} (WhatsApp): falló (${result.error ?? 'error desconocido'})`;
  } catch (err) {
    return `${label} (WhatsApp): falló (${(err as Error).message})`;
  }
};

const emailOutcome = async (label: string, to: string, send: () => Promise<unknown>): Promise<string> => {
  if (!to) return `${label} (correo): omitido (sin correo)`;
  try {
    await send();
    return `${label} (correo): enviado a ${to}`;
  } catch (err) {
    return `${label} (correo): falló (${(err as Error).message})`;
  }
};

const customerNotificationsEnabled = (): boolean =>
  env.envia.env === 'production' || env.shipping.notifyCustomersInTest;

const firstName = (full: string): string => clean(full).split(' ')[0] || 'hola';

const MAX_NOTIFICATION_LINES = 40;

// Agrega al registro de avisos del envío (con fecha) sobre la versión más
// reciente guardada, para no pisar cambios hechos mientras se enviaba.
const saveNotifications = async (shipment: IShipmentDocument, lines: string[]) => {
  try {
    const fresh = (await Shipment.findById(shipment._id)) ?? shipment;
    const stamp = new Intl.DateTimeFormat('es-MX', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City',
    }).format(new Date());
    fresh.notifications = [...(fresh.notifications ?? []), ...lines.map((l) => `${stamp} · ${l}`)].slice(-MAX_NOTIFICATION_LINES);
    await fresh.save();
  } catch (err) {
    console.error('[shipment] no se pudo guardar el registro de avisos:', (err as Error).message);
  }
};

// Al generar la guía: avisa al cliente final y al asesor, por WhatsApp y correo.
const findAdvisorSafe = async (id: string): Promise<IShippingAdvisorDocument | null> => {
  try {
    return await ShippingAdvisor.findById(id);
  } catch {
    return null;
  }
};

// `customerEmail: false` se usa en compras web cuya guía salió al pagar: el
// correo de recibo ya trae el rastreo, así que solo se manda el WhatsApp.
const notifyLabelCreated = async (
  shipment: IShipmentDocument,
  options: { customerEmail?: boolean } = {},
): Promise<void> => {
  const sendCustomerEmail = options.customerEmail !== false;
  const isWeb = shipment.source === 'web';
  const advisor = isWeb ? null : await findAdvisorSafe(shipment.advisorId);
  const carrier = shipment.carrier.toUpperCase();
  const summary = itemsSummary(shipment.items);
  const destination = `${shipment.address.city}, ${shipment.address.state}`;
  const tracking = shipment.trackUrl || '';
  const jobs: Array<Promise<string>> = [];

  if (customerNotificationsEnabled()) {
    jobs.push(
      whatsappOutcome('Cliente', shipment.customer.phone, env.whatsapp.cloud.templates.shipmentCustomer, tplParams([
        ['nombre', firstName(shipment.customer.name)],
        ['paqueteria', carrier],
        ['guia', shipment.trackingNumber],
        ['rastreo', tracking || 'Disponible en unos días con tu paquetería'],
      ])),
    );
    jobs.push(
      !sendCustomerEmail
        ? Promise.resolve('Cliente (correo): omitido (el recibo de compra ya incluye el rastreo)')
        : emailOutcome('Cliente', shipment.customer.email, () =>
        sendShipmentNoticeEmail({
          to: shipment.customer.email,
          subject: 'Tu pedido de libros ya va en camino',
          eyebrow: 'Tu pedido',
          badge: 'Enviado',
          title: 'Tu pedido',
          titleAccent: 'va en camino.',
          lead: `Hola ${firstName(shipment.customer.name)}, ya generamos la guía de envío de tu pedido.`,
          panelLabel: 'Envío',
          panelValue: shipment.trackingNumber,
          rows: [
            ['Libros', summary],
            ['Paquetería', carrier],
            ['Número de guía', shipment.trackingNumber],
            ['Destino', destination],
          ],
          cta: tracking ? { label: 'Rastrear mi envío', detail: carrier, url: tracking } : undefined,
          footerNote: 'diegodiaz.mx · Si tienes dudas sobre tu envío, responde a este correo.',
        }),
      ),
    );
  } else {
    jobs.push(
      Promise.resolve(
        'Cliente: omitido (Envia en modo pruebas; define SHIPPING_TEST_NOTIFY=true para probar avisos al cliente)',
      ),
    );
  }

  if (isWeb) {
    await saveNotifications(shipment, await Promise.all(jobs));
    return;
  }

  jobs.push(
    whatsappOutcome('Asesor', advisor?.phone ?? '', env.whatsapp.cloud.templates.shipmentAdvisor, tplParams([
      ['cliente', shipment.customer.name],
      ['paqueteria', carrier],
      ['guia', shipment.trackingNumber],
      ['rastreo', tracking || 'Sin link de rastreo todavía'],
    ])),
  );
  jobs.push(
    emailOutcome('Asesor', advisor?.email ?? '', () =>
      sendShipmentNoticeEmail({
        to: advisor!.email,
        subject: `Guía generada · ${shipment.customer.name}`,
        eyebrow: 'Envío de libros',
        badge: 'Guía generada',
        title: 'Tu envío',
        titleAccent: 'ya tiene guía.',
        lead: `Administración aprobó el envío de ${shipment.customer.name} y se generó la guía.`,
        panelLabel: 'Guía',
        panelValue: shipment.trackingNumber,
        rows: [
          ['Cliente', shipment.customer.name],
          ['Libros', summary],
          ['Paquetería', carrier],
          ['Número de guía', shipment.trackingNumber],
          ['Destino', destination],
        ],
        cta: tracking ? { label: 'Rastrear envío', detail: carrier, url: tracking } : undefined,
        footerNote: 'diegodiaz.mx · Aviso automático al asesor que capturó el envío.',
      }),
    ),
  );

  await saveNotifications(shipment, await Promise.all(jobs));
};

// Al rechazar: solo se avisa al asesor (el cliente nunca se entera).
const notifyRejected = async (shipment: IShipmentDocument): Promise<void> => {
  const advisor = await findAdvisorSafe(shipment.advisorId);
  const lines = await Promise.all([
    whatsappOutcome('Asesor', advisor?.phone ?? '', env.whatsapp.cloud.templates.shipmentRejected, tplParams([
      ['cliente', shipment.customer.name],
      ['motivo', shipment.rejectionReason],
    ])),
    emailOutcome('Asesor', advisor?.email ?? '', () =>
      sendShipmentNoticeEmail({
        to: advisor!.email,
        subject: `Envío rechazado · ${shipment.customer.name}`,
        eyebrow: 'Envío de libros',
        badge: 'Rechazado',
        title: 'Envío',
        titleAccent: 'por corregir.',
        lead: `Administración no aprobó el envío de ${shipment.customer.name}. Corrige el dato y vuelve a capturarlo.`,
        panelLabel: 'Motivo',
        panelValue: shipment.rejectionReason,
        rows: [
          ['Cliente', shipment.customer.name],
          ['Libros', itemsSummary(shipment.items)],
          ['Destino', `${shipment.address.city}, ${shipment.address.state}`],
        ],
        footerNote: 'diegodiaz.mx · Aviso automático al asesor que capturó el envío.',
      }),
    ),
  ]);
  await saveNotifications(shipment, lines);
};

// Cambio de estado detectado por el rastreo (aplica a ambos orígenes):
// entregado -> cliente y asesor; incidencia -> admin y asesor.
const notifyDeliveryState = async (
  shipment: IShipmentDocument,
  state: 'delivered' | 'incident',
): Promise<void> => {
  const advisor = shipment.source === 'advisor' ? await findAdvisorSafe(shipment.advisorId) : null;
  const carrier = shipment.carrier.toUpperCase();
  const tracking = shipment.trackUrl || '';
  const delivered = state === 'delivered';
  const template = delivered ? env.whatsapp.cloud.templates.shipmentDelivered : env.whatsapp.cloud.templates.shipmentIncident;
  const params = tplParams(
    delivered
      ? [['cliente', shipment.customer.name], ['paqueteria', carrier], ['guia', shipment.trackingNumber]]
      : [
          ['cliente', shipment.customer.name],
          ['paqueteria', carrier],
          ['guia', shipment.trackingNumber],
          ['estatus', shipment.enviaStatus || 'Incidencia en la entrega'],
        ],
  );
  const rows: Array<[string, string]> = [
    ['Cliente', shipment.customer.name],
    ['Libros', itemsSummary(shipment.items)],
    ['Paquetería', carrier],
    ['Número de guía', shipment.trackingNumber],
    ['Estatus', shipment.enviaStatus || (delivered ? 'Entregado' : 'Incidencia')],
  ];
  const mail = (to: string, forCustomer: boolean) =>
    sendShipmentNoticeEmail({
      to,
      subject: delivered ? `Pedido entregado · ${shipment.customer.name}` : `Incidencia en un envío · ${shipment.customer.name}`,
      eyebrow: 'Envío de libros',
      badge: delivered ? 'Entregado' : 'Incidencia',
      title: forCustomer ? 'Tu pedido' : 'Envío',
      titleAccent: delivered ? 'fue entregado.' : 'con incidencia.',
      lead: delivered
        ? `El pedido de ${shipment.customer.name} fue entregado por ${carrier}.`
        : `La paquetería reportó una incidencia con el envío de ${shipment.customer.name}.`,
      panelLabel: 'Guía',
      panelValue: shipment.trackingNumber,
      rows,
      cta: tracking ? { label: 'Ver rastreo', detail: carrier, url: tracking } : undefined,
      footerNote: 'diegodiaz.mx · Aviso automático de seguimiento de envíos.',
    });

  const jobs: Array<Promise<string>> = [];
  if (delivered) {
    if (customerNotificationsEnabled()) {
      jobs.push(whatsappOutcome('Cliente', shipment.customer.phone, template, params));
      jobs.push(emailOutcome('Cliente', shipment.customer.email, () => mail(shipment.customer.email, true)));
    }
  } else {
    jobs.push(whatsappOutcome('Admin', env.shipping.notifyWhatsapp, template, params));
    jobs.push(emailOutcome('Admin', ADMIN_NOTICE_EMAIL, () => mail(ADMIN_NOTICE_EMAIL, false)));
  }
  if (advisor) {
    jobs.push(whatsappOutcome('Asesor', advisor.phone, template, params));
    jobs.push(emailOutcome('Asesor', advisor.email, () => mail(advisor.email, false)));
  }
  await saveNotifications(shipment, [`Estado detectado: ${delivered ? 'entregado' : 'incidencia'}`, ...(await Promise.all(jobs))]);
};

// Compra web que se pagó pero no pudo generar su guía: se avisa al admin para
// que la reintente desde Envíos (el cliente ya pagó).
const notifyWebLabelFailed = async (shipment: IShipmentDocument): Promise<void> => {
  const lines = await Promise.all([
    whatsappOutcome('Admin', env.shipping.notifyWhatsapp, env.whatsapp.cloud.templates.shipmentWebFailed, tplParams([
      ['cliente', shipment.customer.name],
      ['motivo', shipment.error],
      ['pedido', shipment.orderId.slice(-8).toUpperCase()],
    ])),
    emailOutcome('Admin', ADMIN_NOTICE_EMAIL, () =>
      sendShipmentNoticeEmail({
        to: ADMIN_NOTICE_EMAIL,
        subject: `Compra web sin guía · ${shipment.customer.name}`,
        eyebrow: 'Envío de libros',
        badge: 'Sin guía',
        title: 'Compra pagada',
        titleAccent: 'sin guía.',
        lead: `${shipment.customer.name} ya pagó pero no se pudo generar la guía. Entra a Envíos y pulsa "Reintentar guía".`,
        panelLabel: 'Motivo',
        panelValue: shipment.error || 'No se pudo generar la guía',
        rows: [
          ['Cliente', shipment.customer.name],
          ['Teléfono', shipment.customer.phone],
          ['Libros', itemsSummary(shipment.items)],
          ['Destino', `${shipment.address.city}, ${shipment.address.state} CP ${shipment.address.postalCode}`],
          ['Pedido', `#${shipment.orderId.slice(-8).toUpperCase()}`],
        ],
        cta: { label: 'Ir a envíos', detail: 'Reintentar guía', url: `${env.clientUrl}/admin/envios` },
        footerNote: 'diegodiaz.mx · Aviso automático de compras web con falla de guía.',
      }),
    ),
  ]);
  await saveNotifications(shipment, lines);
};

// ── Compras web: espejo como envío ───────────────────────────
// La guía de una compra web sale sola al pagar (payment.service). Aquí se
// registra ese resultado —éxito o falla— como un envío con source 'web' para
// verlo en la misma lista, rastrearlo y reintentarlo si falló.

const orderCustomerEmail = async (order: IOrderDocument): Promise<string> => {
  if (order.contact?.email) return String(order.contact.email).toLowerCase();
  if (!order.user) return '';
  try {
    const user = await User.findById(String(order.user));
    return user?.email ? String(user.email).toLowerCase() : '';
  } catch {
    return '';
  }
};

const upsertWebShipment = async (order: IOrderDocument): Promise<IShipmentDocument> => {
  const existing = await Shipment.findOne({ orderId: order._id });
  if (existing) return existing;
  const shipping = order.shipping;
  if (!shipping) throw makeError('El pedido no tiene domicilio de envío', 409);
  const phone = normalizeMxPhone(shipping.phone);
  return Shipment.create({
    status: 'error',
    source: 'web',
    orderId: order._id,
    advisorId: '',
    advisorName: 'Compra web',
    customer: {
      name: shipping.fullName,
      phone: phone.length === 10 ? phone : String(shipping.phone || ''),
      email: await orderCustomerEmail(order),
    },
    address: {
      street: shipping.street,
      colony: shipping.colony,
      postalCode: shipping.postalCode,
      city: shipping.city,
      state: shipping.state,
      references: shipping.references ?? '',
    },
    items: order.items
      .filter((i) => i.type === 'product')
      .map((i) => ({
        bookId: i.refId,
        slug: i.refId,
        title: i.title,
        quantity: i.quantity ?? 1,
        unitPrice: Number(i.price),
      })),
    createdAt: String(order.paidAt ?? order.createdAt ?? nowIso()),
  } as Partial<IShipmentDocument>);
};

export const recordWebShipmentLabel = async (order: IOrderDocument, label: ShippingLabel): Promise<void> => {
  const shipment = await upsertWebShipment(order);
  shipment.status = 'label_created';
  shipment.carrier = label.carrier;
  shipment.service = label.service;
  shipment.shippingCost = label.totalPrice;
  shipment.trackingNumber = label.trackingNumber;
  shipment.labelUrl = label.labelUrl;
  shipment.trackUrl = label.trackUrl;
  shipment.error = '';
  shipment.reviewedAt = nowIso();
  shipment.reviewedBy = 'Automático (compra web)';
  await shipment.save();
  void notifyLabelCreated(shipment, { customerEmail: false }).catch((err) =>
    console.error('[shipment] avisos de guía web fallaron:', (err as Error).message),
  );
};

export const recordWebShipmentFailure = async (order: IOrderDocument, message: string): Promise<void> => {
  const shipment = await upsertWebShipment(order);
  const alreadyKnown = shipment.status === 'error' && shipment.error === message;
  shipment.status = 'error';
  shipment.error = message;
  await shipment.save();
  if (!alreadyKnown) {
    void notifyWebLabelFailed(shipment).catch((err) =>
      console.error('[shipment] aviso de falla de guía web falló:', (err as Error).message),
    );
  }
};

// Compras web anteriores a este módulo: las que ya tienen guía se reflejan
// tal cual; las pagadas sin guía solo si son recientes (30 días), para no
// llenar la lista con pedidos viejos que se atendieron fuera del sistema.
const BACKFILL_UNLABELED_DAYS = 30;
let backfillPromise: Promise<void> | null = null;

const runBackfill = async (): Promise<void> => {
  const [orders, shipments] = await Promise.all([Order.find({}), Shipment.find({})]);
  const known = new Set(shipments.filter((s) => s.orderId).map((s) => s.orderId));
  const cutoff = Date.now() - BACKFILL_UNLABELED_DAYS * 86400000;

  for (const order of orders) {
    if (known.has(order._id)) continue;
    if (!order.shipping || order.status !== ORDER_STATUS.COMPLETED) continue;
    if (!order.items.some((i) => i.type === 'product')) continue;

    if (order.shippingTrackingNumber) {
      await recordWebShipmentLabelSilently(order);
    } else if (new Date(String(order.paidAt ?? order.createdAt)).getTime() >= cutoff) {
      const shipment = await upsertWebShipment(order);
      shipment.error = 'Compra pagada sin guía generada';
      await shipment.save();
    }
  }
};

const recordWebShipmentLabelSilently = async (order: IOrderDocument): Promise<void> => {
  const shipment = await upsertWebShipment(order);
  shipment.status = 'label_created';
  shipment.carrier = order.shippingCarrier;
  shipment.service = order.shippingService;
  shipment.trackingNumber = order.shippingTrackingNumber;
  shipment.labelUrl = order.shippingLabelUrl;
  shipment.trackUrl = order.shippingTrackUrl;
  shipment.reviewedBy = 'Automático (compra web)';
  await shipment.save();
};

export const ensureWebShipmentsBackfilled = (): Promise<void> => {
  if (!backfillPromise) {
    backfillPromise = runBackfill().catch((err) => {
      backfillPromise = null;
      console.error('[shipment] no se pudo reflejar las compras web existentes:', (err as Error).message);
    });
  }
  return backfillPromise;
};

// ── Admin: lista, detalle y edición ──────────────────────────

const byNewest = (a: IShipmentDocument, b: IShipmentDocument): number =>
  new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime();

export const listShipments = async (params: {
  status?: string;
  source?: string;
  search?: string;
  page?: number;
  limit?: number;
}) => {
  await ensureWebShipmentsBackfilled();
  const all = (await Shipment.find({})).sort(byNewest);
  // Los envíos de asesor creados antes de existir `source` no lo traen:
  // se leen como 'advisor' para que filtros y contadores los incluyan.
  for (const s of all) if (s.source !== 'web') s.source = 'advisor';

  // Los contadores de estatus respetan el origen elegido; los de origen no.
  const bySource = params.source === 'web' || params.source === 'advisor' ? params.source : '';
  const inSource = bySource ? all.filter((s) => s.source === bySource) : all;
  const counts: Record<string, number> = { all: inSource.length };
  for (const s of inSource) counts[s.status] = (counts[s.status] ?? 0) + 1;
  const sources: Record<string, number> = { all: all.length, web: 0, advisor: 0 };
  for (const s of all) sources[s.source] = (sources[s.source] ?? 0) + 1;

  const search = clean(params.search).toLowerCase();
  const filtered = inSource.filter((s) => {
    if (params.status && params.status !== 'all' && s.status !== params.status) return false;
    if (!search) return true;
    return [
      s.customer.name,
      s.customer.phone,
      s.advisorName,
      s.trackingNumber,
      s.address.city,
      s.address.postalCode,
      s.orderId,
    ]
      .join(' ')
      .toLowerCase()
      .includes(search);
  });

  const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));
  const page = Math.max(1, Number(params.page) || 1);
  const pages = Math.max(1, Math.ceil(filtered.length / limit));
  return { items: filtered.slice((page - 1) * limit, page * limit), counts, sources, total: filtered.length, page, pages };
};

export const getShipment = async (id: string): Promise<IShipmentDocument> => {
  const shipment = await Shipment.findById(id);
  if (!shipment) throw makeError('Envío no encontrado', 404);
  return shipment;
};

// Domicilio y paquete a enviar: de los libros capturados (asesor) o del pedido
// pagado (web). Es lo único que cambia entre orígenes al generar la guía.
const resolveLabelContext = async (shipment: IShipmentDocument) => {
  if (shipment.source === 'web') {
    const order = await Order.findById(shipment.orderId);
    if (!order?.shipping) throw makeError('El pedido ya no tiene domicilio de envío', 409);
    const packages = buildShippingPackages(order.items);
    if (!packages.length) throw makeError('El pedido no tiene libros por enviar', 409);
    return { order, address: order.shipping, packages };
  }
  const books = await resolveBooks(shipment.items);
  return { order: null, address: toShippingAddress(shipment), packages: buildPackages(books) };
};

// Cotizaciones disponibles para que el admin elija paquetería al aprobar o reintentar.
export const getShipmentQuotes = async (id: string): Promise<ShippingRateOption[]> => {
  const shipment = await getShipment(id);
  const { address, packages } = await resolveLabelContext(shipment);
  const rates = await getShippingRates(address, packages);
  return [...rates].sort((a, b) => a.totalPrice - b.totalPrice);
};

const resolveBooks = async (items: IShipmentItem[]) => {
  const books: Array<{ book: IBookDocument; quantity: number }> = [];
  for (const item of items) {
    const book = await getBookBySlug(item.slug);
    books.push({ book, quantity: item.quantity });
  }
  return books;
};

export const editShipment = async (id: string, draft: ShipmentDraft): Promise<IShipmentDocument> => {
  const shipment = await getShipment(id);
  if (shipment.source === 'web') {
    throw makeError('Los datos de una compra web los capturó el cliente y no se editan aquí', 409);
  }
  if (shipment.status !== 'pending' && shipment.status !== 'error') {
    throw makeError('Solo se pueden editar envíos pendientes o con error', 409);
  }
  const result = await validateShipmentDraft(draft, { excludeId: id });
  if (result.errors.length || !result.normalized) {
    throw makeError('Hay datos por corregir', 400, { errors: result.errors, warnings: result.warnings });
  }
  const { customer, address, items, notes } = result.normalized;
  shipment.customer = customer;
  shipment.address = address;
  shipment.items = items;
  shipment.notes = notes;
  shipment.warnings = result.warnings;
  shipment.quotedPrice = result.quote?.totalPrice ?? shipment.quotedPrice;
  shipment.error = '';
  return shipment.save();
};

// ── Admin: aprobar / rechazar ────────────────────────────────

export const approveShipment = async (
  id: string,
  reviewer: string,
  choice: { carrier?: string; service?: string } = {},
): Promise<IShipmentDocument> => {
  const shipment = await getShipment(id);
  const isWeb = shipment.source === 'web';
  // Advisor: aprobar una solicitud pendiente (o reintentar una con error).
  // Web: solo existe el reintento de una compra pagada cuya guía falló.
  if (isWeb ? shipment.status !== 'error' : shipment.status !== 'pending' && shipment.status !== 'error') {
    throw makeError(isWeb ? 'Esta compra web ya tiene guía' : 'Este envío ya fue procesado', 409);
  }
  if (!isEnviaConfigured()) throw makeError('Envia no está configurado en el servidor', 500);

  // Marca "processing" antes de llamar a Envia para que un doble clic no
  // genere (y cobre) dos guias.
  shipment.status = 'processing';
  shipment.error = '';
  await shipment.save();

  try {
    const { order, address, packages } = await resolveLabelContext(shipment);

    const rates = [...(await getShippingRates(address, packages))].sort((a, b) => a.totalPrice - b.totalPrice);
    // Web sin elección explícita: se respeta la paquetería que el cliente
    // eligió al pagar si sigue disponible; si no, la más barata.
    const preferred = order?.shippingCarrier && order.shippingService
      ? rates.find((r) => r.carrier === order.shippingCarrier && r.service === order.shippingService)
      : undefined;
    const rate = choice.carrier && choice.service
      ? rates.find((r) => r.carrier === choice.carrier && r.service === choice.service)
      : preferred ?? rates[0];
    if (!rate) {
      throw makeError(
        rates.length
          ? 'La paquetería elegida ya no está disponible para este destino'
          : 'Ninguna paquetería cubre este destino. Revisa el domicilio del pedido.',
        400,
      );
    }

    const label = await generateShippingLabel(address, packages, rate.carrier, rate.service);

    shipment.status = 'label_created';
    shipment.carrier = label.carrier;
    shipment.service = label.service;
    shipment.shippingCost = label.totalPrice;
    shipment.trackingNumber = label.trackingNumber;
    shipment.labelUrl = label.labelUrl;
    shipment.trackUrl = label.trackUrl;
    shipment.reviewedAt = nowIso();
    shipment.reviewedBy = reviewer;
    shipment.deliveryState = 'unknown';
    await shipment.save();

    // Compra web: el pedido también guarda la guía, que es lo que ve el
    // cliente en su recibo.
    if (order) {
      order.shippingCarrier = label.carrier;
      order.shippingService = label.service;
      order.shippingTrackingNumber = label.trackingNumber;
      order.shippingLabelUrl = label.labelUrl;
      order.shippingTrackUrl = label.trackUrl;
      await order.save();
    }

    // Reintento web: el recibo original salió sin guía, así que el cliente
    // recibe aviso completo (WhatsApp y correo).
    void notifyLabelCreated(shipment, { customerEmail: true }).catch((err) =>
      console.error('[shipment] avisos de guía fallaron:', (err as Error).message),
    );
    return shipment;
  } catch (err) {
    shipment.status = 'error';
    shipment.error = (err as Error).message || 'No se pudo generar la guía';
    await shipment.save();
    throw err;
  }
};

export const rejectShipment = async (id: string, reviewer: string, reason: string): Promise<IShipmentDocument> => {
  const shipment = await getShipment(id);
  if (shipment.source === 'web') {
    throw makeError('Una compra web ya está pagada: no se rechaza, solo se reintenta la guía', 409);
  }
  if (shipment.status !== 'pending' && shipment.status !== 'error') {
    throw makeError('Este envío ya fue procesado', 409);
  }
  const cleanReason = clean(reason);
  if (cleanReason.length < 3) throw makeError('Escribe el motivo del rechazo para que el asesor lo corrija', 400);

  shipment.status = 'rejected';
  shipment.rejectionReason = cleanReason;
  shipment.reviewedAt = nowIso();
  shipment.reviewedBy = reviewer;
  await shipment.save();

  void notifyRejected(shipment).catch((err) =>
    console.error('[shipment] avisos de rechazo fallaron:', (err as Error).message),
  );
  return shipment;
};

// ── Rastreo ──────────────────────────────────────────────────

export const refreshShipmentTracking = async (id: string): Promise<IShipmentDocument> => {
  const shipment = await getShipment(id);
  if (shipment.status !== 'label_created' || !shipment.trackingNumber) return shipment;

  const result = await trackShipment(shipment.trackingNumber).catch((err) => {
    console.error('[shipment] rastreo falló:', (err as Error).message);
    return null;
  });
  const previousState = shipment.deliveryState;
  shipment.enviaCheckedAt = nowIso();
  if (result) {
    shipment.enviaStatus = result.status;
    shipment.deliveryState = result.deliveryState;
    shipment.enviaEvents = result.events;
  }
  const saved = await shipment.save();

  // Solo se avisa en la transición: una guía que ya estaba entregada o con
  // incidencia no vuelve a notificar en cada consulta.
  if (result && result.deliveryState !== previousState && (result.deliveryState === 'delivered' || result.deliveryState === 'incident')) {
    void notifyDeliveryState(saved, result.deliveryState).catch((err) =>
      console.error('[shipment] aviso de estado falló:', (err as Error).message),
    );
  }
  return saved;
};

export const refreshAllTracking = async (): Promise<{ checked: number }> => {
  const all = await Shipment.find({});
  // Las consultadas hace más tiempo (o nunca) van primero, así el tope por
  // corrida no deja siempre fuera a las mismas guías.
  const open = all
    .filter((s) => s.status === 'label_created' && s.trackingNumber && s.deliveryState !== 'delivered')
    .sort((a, b) => new Date(String(a.enviaCheckedAt ?? 0)).getTime() - new Date(String(b.enviaCheckedAt ?? 0)).getTime())
    .slice(0, MAX_TRACKING_REFRESH);
  for (const s of open) await refreshShipmentTracking(s._id);
  return { checked: open.length };
};

// Consulta automática cada hora (la primera a los 2 minutos de arrancar) para
// que "entregado" e "incidencia" avisen solos sin depender del botón.
const TRACKING_FIRST_RUN_MS = 2 * 60 * 1000;
const TRACKING_INTERVAL_MS = 60 * 60 * 1000;

export const startShipmentTrackingWorker = (): void => {
  if (!isEnviaConfigured()) {
    console.log('[shipment] rastreo automático desactivado: Envia no está configurado');
    return;
  }
  const run = () => {
    refreshAllTracking().catch((err) => console.error('[shipment] rastreo automático falló:', (err as Error).message));
  };
  setTimeout(run, TRACKING_FIRST_RUN_MS).unref();
  setInterval(run, TRACKING_INTERVAL_MS).unref();
};
