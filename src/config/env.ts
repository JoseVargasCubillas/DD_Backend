const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
};

const first = (...keys: string[]): string | undefined => {
  for (const key of keys) {
    const val = process.env[key];
    if (val) return val;
  }
  return undefined;
};

// "SEF CDMX=estrategia-fiscal-cdmx;SEF MTY=estrategia-fiscal-monterrey" ->
// { 'sef cdmx': ['estrategia fiscal cdmx'], ... }. Equivalencia entre el nombre
// del producto de HubSpot y un fragmento del slug/título del Event en la DB.
const parseAliases = (raw: string): Record<string, string[]> => {
  const norm = (v: string): string =>
    v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const out: Record<string, string[]> = {};
  for (const pair of raw.split(';')) {
    const [name, ...rest] = pair.split('=');
    const key = norm(name ?? '');
    const value = norm(rest.join('='));
    if (key && value) out[key] = [...(out[key] ?? []), value];
  }
  return out;
};

const DEFAULT_EVENT_ALIASES =
  'SEF CDMX=estrategia-fiscal-cdmx;SEF MTY=estrategia-fiscal-monterrey;SEF GDL=estrategia-fiscal-guadalajara';

export const env = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:5173',
  // URL publica del propio backend — usada para armar links que el backend
  // resuelve directamente (ej. el redirect de invitacion de WhatsApp), a
  // diferencia de clientUrl que apunta al frontend.
  serverUrl: process.env.SERVER_URL ?? 'http://localhost:5000',
  database: {
    host: first('DB_HOST', 'MYSQL_HOST') ?? 'localhost',
    port: Number(first('DB_PORT', 'MYSQL_PORT')) || 3306,
    user: first('DB_USER', 'MYSQL_USER') ?? 'root',
    password: first('DB_PASSWORD', 'MYSQL_PASSWORD') ?? '',
    name: first('DB_NAME', 'MYSQL_DATABASE', 'DATABASE_NAME') ?? 'dd_platform',
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  },
  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    refreshSecret: required('JWT_REFRESH_SECRET'),
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
  stripe: {
    secretKey: required('STRIPE_SECRET_KEY'),
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },
  googleDrive: {
    apiKey: process.env.GOOGLE_DRIVE_API_KEY ?? '',
  },
  mail: {
    host: process.env.MAIL_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.MAIL_PORT) || 587,
    user: process.env.MAIL_USER ?? '',
    pass: process.env.MAIL_PASS ?? '',
    from: process.env.MAIL_FROM ?? '',
  },
  envia: {
    env: process.env.ENVIA_ENV ?? 'sandbox',
    token: process.env.ENVIA_TOKEN ?? '',
    labelPrintFormat: process.env.ENVIA_LABEL_PRINT_FORMAT ?? 'PDF',
    labelPrintSize: process.env.ENVIA_LABEL_PRINT_SIZE ?? 'STOCK_4X6',
    origin: {
      name: process.env.ENVIA_ORIGIN_NAME ?? '',
      phone: process.env.ENVIA_ORIGIN_PHONE ?? '',
      street: process.env.ENVIA_ORIGIN_STREET ?? '',
      number: process.env.ENVIA_ORIGIN_NUMBER ?? '',
      district: process.env.ENVIA_ORIGIN_DISTRICT ?? '',
      city: process.env.ENVIA_ORIGIN_CITY ?? '',
      state: process.env.ENVIA_ORIGIN_STATE ?? '',
      postalCode: process.env.ENVIA_ORIGIN_POSTAL_CODE ?? '',
    },
  },
  // Polling de negocios ganados en HubSpot -> boletos QR (hubspot.service.ts).
  hubspot: {
    token: process.env.HUBSPOT_TOKEN ?? '',
    syncEnabled: process.env.HUBSPOT_SYNC_ENABLED !== 'false',
    pipelineId: process.env.HUBSPOT_PIPELINE_ID ?? 'default',
    wonStageId: process.env.HUBSPOT_WON_STAGE_ID ?? 'closedwon',
    pollIntervalMs: Math.max(60, Number(process.env.HUBSPOT_POLL_INTERVAL_SEC) || 300) * 1000,
    // Propiedad del objeto Producto que indica Presencial/Online (opcional).
    modalityProperty: process.env.HUBSPOT_PRODUCT_MODALITY_PROPERTY ?? 'modalidad',
    // Corte inicial: no se procesan negocios modificados antes de esta fecha ISO.
    syncStart: process.env.HUBSPOT_SYNC_START ?? '',
    eventAliases: parseAliases(`${DEFAULT_EVENT_ALIASES};${process.env.HUBSPOT_EVENT_ALIASES ?? ''}`),
  },
  whatsapp: {
    businessGroupUrl: process.env.WHATSAPP_GROUP_BUSINESS_URL ?? '',
    masterGroupUrl: process.env.WHATSAPP_GROUP_MASTER_URL ?? '',
    // Grupos de los eventos online con acceso por WhatsApp (uno por producto).
    holdingGroupUrl: process.env.WHATSAPP_GROUP_HOLDING_URL ?? '',
    sefOnlineGroupUrl: process.env.WHATSAPP_GROUP_SEF_ONLINE_URL ?? '',
    whapiToken: process.env.WHAPI_TOKEN ?? '',
    whapiUrl: process.env.WHAPI_URL ?? 'https://gate.whapi.cloud',
  },
} as const;
