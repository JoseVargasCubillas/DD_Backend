/**
 * Sincroniza numeros de leads e intentos de compra al Google Sheet
 * "Reporte descargables mes septiembre" (id fijo).
 *
 * Se ejecuta con cron diario (ver crontab del VPS). Requiere una service
 * account de Google con permiso de edicion sobre el sheet destino.
 *
 * Setup (una sola vez):
 *  1. Crear service account en Google Cloud Console + habilitar Sheets API.
 *  2. Guardar el JSON como /var/www/dd-academia-backend/google-sa.json
 *     (chmod 600). NO se sube al repo.
 *  3. En el sheet destino, "Compartir" con el email del service account
 *     (viene en el JSON, campo client_email) como Editor.
 *  4. Env vars requeridas en .env:
 *       GOOGLE_SA_KEY_FILE=/var/www/dd-academia-backend/google-sa.json
 *       LEADS_SHEET_ID=1nlFM7cw-P-d7XnsHu6WaZU9mGs3ZLcaRLVpjrNwFRWY
 *
 * Uso manual:
 *  npm run report:sheet-sync
 */

import { google } from 'googleapis';
import { Lead } from '../../molecules/models/lead.model.js';
import { User } from '../../molecules/models/user.model.js';
import { Tag } from '../../molecules/models/tag.model.js';

const SHEET_ID = process.env.LEADS_SHEET_ID
  || '1nlFM7cw-P-d7XnsHu6WaZU9mGs3ZLcaRLVpjrNwFRWY';
const SA_KEY_FILE = process.env.GOOGLE_SA_KEY_FILE
  || '/var/www/dd-academia-backend/google-sa.json';

const INCOMPLETE_PAYMENT_TAG_PREFIX = 'Pago incompleto: ';

const normalizeEmail = (raw: unknown): string =>
  String(raw ?? '').trim().toLowerCase();

// Ventana de mes actual — el sheet titula "Reporte descargables mes X"
// asi que contamos los leads con createdAt dentro del mes corriente.
const currentMonthBounds = (now = new Date()): [Date, Date] => {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return [start, end];
};

// Normaliza el nombre de producto de un tag "Pago incompleto: X" para
// mapearlo a las filas exactas del sheet.
const productKeyFromTag = (tagName: string): string => {
  const raw = tagName.slice(INCOMPLETE_PAYMENT_TAG_PREFIX.length).trim().toLowerCase();
  if (/holding/.test(raw)) return 'Holding';
  if (/entrepreneur/.test(raw)) return 'Entrepreneur';
  if (/master/.test(raw)) return 'Master';
  if (/business/.test(raw)) return 'Business';
  if (/online/.test(raw) && /estrategia/.test(raw)) return 'Taller de Estrategia Fiscal · Online';
  if (/cdmx/.test(raw) && /estrategia/.test(raw)) return 'Taller de Estrategia Fiscal · General CDMX';
  if (/estrategia.*fiscal/.test(raw)) return 'Taller de Estrategia Fiscal · Online';
  if (/rockefeller/.test(raw)) return 'Rockefeller';
  // Fallback: usa el nombre tal cual, capitalizado.
  return tagName.slice(INCOMPLETE_PAYMENT_TAG_PREFIX.length).trim();
};

export interface LeadsReportSnapshot {
  monthLabel: string;
  downloads: {
    iniciativaFiscal: number;
    dossierEstrategia: number;
    guiaSat: number;
    centroRecursos: number;
    newsletter: number;
    total: number;
  };
  leadsOrgTotal: number;
  purchaseAttempts: {
    tallerEfOnline: number;
    entrepreneur: number;
    holding: number;
    tallerEfCdmx: number;
    otros: Record<string, number>;
    total: number;
  };
  generatedAt: string;
}

// Calcula todas las metricas sin escribir en Sheets — util para el endpoint
// y para pruebas locales.
export const buildLeadsReport = async (): Promise<LeadsReportSnapshot> => {
  const now = new Date();
  const [monthStart, monthEnd] = currentMonthBounds(now);

  const [leads, users, tags] = await Promise.all([
    Lead.find({}),
    User.find({}),
    Tag.find({}),
  ]);

  // ── Descargables del mes ─────────────────────────────────────
  const monthlyLeads = leads.filter((l) => {
    const at = new Date(String(l.createdAt));
    return at >= monthStart && at < monthEnd;
  });

  let iniciativaFiscal = 0;
  let dossierEstrategia = 0;
  let guiaSat = 0;
  let centroRecursos = 0;
  let newsletter = 0;

  for (const l of monthlyLeads) {
    switch (l.source) {
      case 'iniciativa-fiscal-2027': iniciativaFiscal += 1; break;
      case 'estrategia-fiscal-dossier': dossierEstrategia += 1; break;
      case 'guia-blindaje-sat': guiaSat += 1; break;
      case 'centro-recursos': centroRecursos += 1; break;
      case 'newsletter': newsletter += 1; break;
      default: break;
    }
  }
  const downloadsTotal = iniciativaFiscal + dossierEstrategia + guiaSat + centroRecursos + newsletter;

  // ── LEADS ORG DD (historico total) ───────────────────────────
  // Emails unicos entre leads + users con contactStatus 'lead'.
  const uniqueLeadEmails = new Set<string>();
  for (const l of leads) {
    const email = normalizeEmail(l.email);
    if (email) uniqueLeadEmails.add(email);
  }
  for (const u of users) {
    if (u.contactStatus !== 'lead') continue;
    const email = normalizeEmail(u.email);
    if (email) uniqueLeadEmails.add(email);
  }
  const leadsOrgTotal = uniqueLeadEmails.size;

  // ── Intentos de compra por producto ──────────────────────────
  const tagById = new Map(tags.map((t) => [String(t._id), t]));
  let tallerEfOnline = 0;
  let entrepreneur = 0;
  let holding = 0;
  let tallerEfCdmx = 0;
  const otros: Record<string, number> = {};
  let purchaseAttemptsTotal = 0;

  for (const u of users) {
    if (u.contactStatus !== 'lead') continue;
    const incompleteTags = (u.tagIds ?? [])
      .map((id) => tagById.get(id))
      .filter((tag): tag is NonNullable<typeof tag> =>
        Boolean(tag && tag.name.startsWith(INCOMPLETE_PAYMENT_TAG_PREFIX)),
      );
    for (const tag of incompleteTags) {
      purchaseAttemptsTotal += 1;
      const key = productKeyFromTag(tag.name);
      switch (key) {
        case 'Taller de Estrategia Fiscal · Online': tallerEfOnline += 1; break;
        case 'Entrepreneur': entrepreneur += 1; break;
        case 'Holding': holding += 1; break;
        case 'Taller de Estrategia Fiscal · General CDMX': tallerEfCdmx += 1; break;
        default:
          otros[key] = (otros[key] ?? 0) + 1;
      }
    }
  }

  const MONTH_LABELS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  return {
    monthLabel: MONTH_LABELS[now.getMonth()],
    downloads: {
      iniciativaFiscal,
      dossierEstrategia,
      guiaSat,
      centroRecursos,
      newsletter,
      total: downloadsTotal,
    },
    leadsOrgTotal,
    purchaseAttempts: {
      tallerEfOnline,
      entrepreneur,
      holding,
      tallerEfCdmx,
      otros,
      total: purchaseAttemptsTotal,
    },
    generatedAt: now.toISOString(),
  };
};

// Escribe el snapshot en el Sheet destino. Estructura por celdas
// (ver web_fetch del sheet):
//   A1  → "Reporte descargables mes <X>"
//   B3  → Iniciativa Fiscal 2027
//   B4  → Dossier Estrategia Fiscal
//   B5  → Guia Sat
//   B6  → Centro de Recursos
//   B7  → Suscritos (newsletter)
//   B8  → Total General de Leads por descarga
//   C7  → LEADS ORG DD (historico)
//   E3  → Taller de Estrategia Fiscal · Online
//   E4  → Entrepreneur
//   E5  → Holding
//   E7  → Taller de Estrategia Fiscal · General CDMX
//   E8  → Total intentos de compra
//   A10 → "Actualizado: <timestamp>"
export const syncLeadsReportToSheet = async (): Promise<LeadsReportSnapshot> => {
  const snapshot = await buildLeadsReport();

  const auth = new google.auth.GoogleAuth({
    keyFile: SA_KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const monthTitle = `Reporte descargables mes ${snapshot.monthLabel}`;
  const stampedAt = new Date(snapshot.generatedAt).toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const updates: Array<{ range: string; values: (string | number)[][] }> = [
    { range: 'A1', values: [[monthTitle]] },
    { range: 'B3', values: [[snapshot.downloads.iniciativaFiscal]] },
    { range: 'B4', values: [[snapshot.downloads.dossierEstrategia]] },
    { range: 'B5', values: [[snapshot.downloads.guiaSat]] },
    { range: 'B6', values: [[snapshot.downloads.centroRecursos]] },
    { range: 'B7', values: [[snapshot.downloads.newsletter]] },
    { range: 'B8', values: [[snapshot.downloads.total]] },
    { range: 'C7', values: [[snapshot.leadsOrgTotal]] },
    { range: 'E3', values: [[snapshot.purchaseAttempts.tallerEfOnline]] },
    { range: 'E4', values: [[snapshot.purchaseAttempts.entrepreneur]] },
    { range: 'E5', values: [[snapshot.purchaseAttempts.holding]] },
    { range: 'E7', values: [[snapshot.purchaseAttempts.tallerEfCdmx]] },
    { range: 'E8', values: [[snapshot.purchaseAttempts.total]] },
    { range: 'A10', values: [[`Actualizado automaticamente: ${stampedAt} (CDMX)`]] },
  ];

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates,
    },
  });

  return snapshot;
};
