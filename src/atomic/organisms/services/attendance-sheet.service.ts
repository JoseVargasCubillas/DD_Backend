/**
 * Control de asistencia en Google Sheets: una pestaña por evento en el
 * spreadsheet ATTENDANCE_SHEET_ID. Cada boleto es una fila; al escanear el QR
 * la fila se marca "✅ Asistió" con la hora y se pinta en verde.
 *
 * Reutiliza la service account de leads-report.service.ts
 * (GOOGLE_SA_KEY_FILE). El spreadsheet debe compartirse como Editor con el
 * client_email del JSON. Si no hay ATTENDANCE_SHEET_ID configurado, todo es
 * no-op: la fuente de verdad sigue siendo la tabla event_tickets.
 */

import { google, sheets_v4 } from 'googleapis';
import type { IEventTicketDocument } from '../../molecules/models/event-ticket.model.js';
import { formatTicketOrderRef } from '../../atoms/helpers/event-ticket.helper.js';

const SHEET_ID = process.env.ATTENDANCE_SHEET_ID || '';
const SA_KEY_FILE = process.env.GOOGLE_SA_KEY_FILE
  || '/var/www/dd-academia-backend/google-sa.json';

const HEADERS = [
  'Folio',
  'Nombre',
  'Correo',
  'Teléfono',
  'Evento',
  'Fecha evento',
  'Boleto',
  'Fecha de compra',
  'Monto',
  'Orden',
  'Asistencia',
  'Hora check-in',
  'Registró',
];
const STATUS_COL = 10; // K (0-based) — "Asistencia"
const GREEN = { red: 0.85, green: 0.95, blue: 0.85 };
const WHITE = { red: 1, green: 1, blue: 1 };

export const isAttendanceSheetEnabled = (): boolean => Boolean(SHEET_ID);

export const attendanceSheetUrl = (tabId?: number | null): string | null =>
  SHEET_ID
    ? `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit${tabId != null ? `#gid=${tabId}` : ''}`
    : null;

let sheetsClient: sheets_v4.Sheets | null = null;
const getSheets = (): sheets_v4.Sheets => {
  if (!sheetsClient) {
    const auth = new google.auth.GoogleAuth({
      keyFile: SA_KEY_FILE,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
};

// Nombre de pestaña ≤ 100 chars, sin caracteres prohibidos por Sheets.
export const buildTabTitle = (eventTitle: string, eventDate: string): string => {
  const clean = (s: string): string => s.replace(/[\[\]*?:\/\\']/g, ' ').replace(/\s+/g, ' ').trim();
  const base = clean(eventTitle).slice(0, 60);
  const date = clean(eventDate).slice(0, 30);
  return (date ? `${base} · ${date}` : base).slice(0, 99) || 'Evento';
};

const formatDateTimeEs = (value: Date | string | null | undefined): string => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City',
  }).format(d);
};

const formatAmount = (amount: number, currency: string): string =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(amount);

const ticketRow = (t: IEventTicketDocument): string[] => [
  t.folio,
  t.attendeeName,
  t.attendeeEmail,
  t.attendeePhone,
  t.eventTitle,
  t.eventDate,
  `${t.seatIndex} de ${t.seatTotal}${t.ticketType ? ` · ${t.ticketType}` : ''}`,
  formatDateTimeEs(t.purchasedAt),
  formatAmount(t.amount, t.currency),
  formatTicketOrderRef(t.orderId),
  t.status === 'used' ? '✅ Asistió' : t.status === 'void' ? 'Anulado' : 'Pendiente',
  formatDateTimeEs(t.checkedInAt),
  t.checkedInBy ?? '',
];

// Google Sheets trata los nombres de pestaña sin distinguir mayúsculas
// ("Taller de Estrategia" y "Taller de estrategia" son la misma), así que la
// búsqueda y las cachés usan el nombre en minúsculas como llave.
const tabKey = (title: string): string => title.trim().toLowerCase();
const tabCache = new Map<string, number>();
const tabNames = new Map<string, string>(); // llave -> nombre real de la pestaña en el Sheet

// Nombre real de la pestaña (con las mayúsculas con que existe en el Sheet).
const actualTabName = (title: string): string => tabNames.get(tabKey(title)) ?? title;

// Devuelve el sheetId (gid) de la pestaña, creándola con encabezados si no existe.
export const ensureEventTab = async (title: string): Promise<number> => {
  const key = tabKey(title);
  const cached = tabCache.get(key);
  if (cached != null) return cached;

  const sheets = getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties' });
  const found = meta.data.sheets?.find((s) => tabKey(s.properties?.title ?? '') === key)?.properties;
  if (found?.sheetId != null) {
    tabCache.set(key, found.sheetId);
    tabNames.set(key, found.title ?? title);
    return found.sheetId;
  }

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }],
    },
  });
  const sheetId = res.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${title}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] },
  });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.95, green: 0.94, blue: 0.9 } } },
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          },
        },
        { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: HEADERS.length } } },
      ],
    },
  });

  tabCache.set(key, sheetId);
  tabNames.set(key, title);
  return sheetId;
};

// Agrega la fila del boleto y devuelve el número de fila (1-based) donde quedó.
export const appendTicketRow = async (ticket: IEventTicketDocument): Promise<{ tab: string; row: number } | null> => {
  if (!SHEET_ID) return null;
  const wanted = ticket.sheetTab || buildTabTitle(ticket.eventTitle, ticket.eventDate);
  await ensureEventTab(wanted);
  const tab = actualTabName(wanted);
  const res = await getSheets().spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'${tab}'!A:M`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [ticketRow(ticket)] },
  });
  const updatedRange = res.data.updates?.updatedRange ?? '';
  const match = updatedRange.match(/![A-Z]+(\d+)/);
  const row = match ? Number(match[1]) : 0;
  return { tab, row };
};

// Localiza la fila por folio cuando no se guardó sheetRow (p. ej. si el
// append falló al crear el boleto).
const findRowByFolio = async (tab: string, folio: string): Promise<number | null> => {
  const res = await getSheets().spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${tab}'!A:A` });
  const idx = (res.data.values ?? []).findIndex((r) => String(r[0] ?? '').trim().toUpperCase() === folio);
  return idx >= 0 ? idx + 1 : null;
};

// Reescribe la fila completa del boleto (estado, hora, quién) y la pinta
// verde si asistió / blanca si se deshizo el check-in.
export const syncTicketRow = async (ticket: IEventTicketDocument): Promise<{ tab: string; row: number } | null> => {
  if (!SHEET_ID) return null;
  const wanted = ticket.sheetTab || buildTabTitle(ticket.eventTitle, ticket.eventDate);
  const sheetId = await ensureEventTab(wanted);
  const tab = actualTabName(wanted);
  let row = ticket.sheetRow ?? null;
  if (!row || row < 2) row = await findRowByFolio(tab, ticket.folio);
  if (!row) {
    const appended = await appendTicketRow(ticket);
    if (!appended) return null;
    row = appended.row;
  }

  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${tab}'!A${row}:M${row}`,
    valueInputOption: 'RAW',
    requestBody: { values: [ticketRow(ticket)] },
  });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: HEADERS.length },
            cell: { userEnteredFormat: { backgroundColor: ticket.status === 'used' ? GREEN : WHITE } },
            fields: 'userEnteredFormat.backgroundColor',
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: STATUS_COL, endColumnIndex: STATUS_COL + 1 },
            cell: { userEnteredFormat: { textFormat: { bold: ticket.status === 'used' } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
      ],
    },
  });
  return { tab, row };
};

export const getTabUrl = async (tab: string): Promise<string | null> => {
  if (!SHEET_ID) return null;
  try {
    const gid = await ensureEventTab(tab);
    return attendanceSheetUrl(gid);
  } catch {
    return attendanceSheetUrl();
  }
};
