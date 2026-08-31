export const COURSE_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
} as const;

export const ORDER_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
} as const;

export const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  CANCELED: 'canceled',
  PAST_DUE: 'past_due',
  TRIALING: 'trialing',
  // Suscripcion creada en Stripe pero cuyo primer pago aun no se confirma
  // (cliente todavia llenando la tarjeta, o abandono el checkout). No cuenta
  // como venta ni otorga acceso hasta que el webhook invoice.payment_succeeded
  // la pase a ACTIVE.
  INCOMPLETE: 'incomplete',
} as const;

export const EVENT_STATUS = {
  UPCOMING: 'upcoming',
  ONGOING: 'ongoing',
  FINISHED: 'finished',
  CANCELED: 'canceled',
} as const;
