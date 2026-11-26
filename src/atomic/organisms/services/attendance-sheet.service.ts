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
import { formatTicketOrderRef, isHubspotOrderId } from '../../atoms/helpers/event-ticket.helper.js';

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
  'Origen / Asesor',
];
const ORIGIN_COL_LETTER = 'N';
const LAST_COL_LETTER = ORIGIN_COL_LETTER;
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

const ticketOrigin = (t: IEventTicketDocument): string => {
  if (!isHubspotOrderId(t.orderId)) return 'Compra web';
  return t.advisorName ? `Asesor: ${t.advisorName}` : 'Asesor (sin asignar)';
};

const ticketRow = (t: IEventTicketDocument): string[] => [
  t.folio,
  t.attendeeName,
  t.attendeeEmail || (t.accessType === 'online' ? '' : '⚠ SIN CORREO · boleto pendiente'),
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
  ticketOrigin(t),
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
    // Pestañas creadas antes de la columna de origen: se agrega su encabezado.
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${found.title ?? title}'!${ORIGIN_COL_LETTER}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[HEADERS[HEADERS.length - 1]]] },
    }).catch((err) => console.warn('[attendanceSheet] no se pudo escribir el encabezado de origen:', (err as Error).message));
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

// Escrituras concurrentes a la misma pestaña se serializan para que dos boletos
// no calculen la misma "siguiente fila".
const tabLocks = new Map<string, Promise<unknown>>();
const withTabLock = <T>(tab: string, fn: () => Promise<T>): Promise<T> => {
  const key = tabKey(tab);
  const prev = tabLocks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  tabLocks.set(key, next);
  return next.finally(() => { if (tabLocks.get(key) === next) tabLocks.delete(key); });
};

// Agrega la fila del boleto y devuelve el número de fila (1-based) donde quedó.
// No usa values.append: su detección de "tablas" hace que una celda suelta
// (p. ej. un "." fuera de A:N) desplace las filas nuevas a otras columnas. Se
// calcula la siguiente fila libre a partir de la última fila con datos en A:N
// y se escribe siempre desde la columna A.
export const appendTicketRow = async (ticket: IEventTicketDocument): Promise<{ tab: string; row: number } | null> => {
  // Las bajas (boletos anulados) no van al Sheet.
  if (!SHEET_ID || ticket.status === 'void') return null;
  const wanted = ticket.sheetTab || buildTabTitle(ticket.eventTitle, ticket.eventDate);
  await ensureEventTab(wanted);
  const tab = actualTabName(wanted);
  return withTabLock(tab, async () => {
    const sheets = getSheets();
    const current = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${tab}'!A:${LAST_COL_LETTER}`,
    });
    // values.get recorta filas vacías del final, así que length = última fila con datos.
    const row = Math.max((current.data.values ?? []).length + 1, 2);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `'${tab}'!A${row}:${LAST_COL_LETTER}${row}`,
      valueInputOption: 'RAW',
      requestBody: { values: [ticketRow(ticket)] },
    });
    return { tab, row };
  });
};

export interface SheetResyncResult {
  folio: string;
  tab: string;
  row: number;
  action: 'updated' | 'added' | 'removed';
}

// Reescribe en el Sheet todos los boletos dados (botón "Reenviar al Sheet" de la
// lista de asistentes). Por pestaña: lee A:N una vez, ubica cada boleto por
// folio en la columna A; si no está, usa su sheetRow guardado cuando esa fila
// está libre, y si no, la siguiente fila libre. Escribe todo en una sola
// llamada (y el color en otra) para no agotar la cuota de la API con eventos
// grandes. Las filas repetidas del mismo folio se vacían, y las bajas (boletos
// anulados) se quitan de la hoja en vez de escribirse.
export const resyncTickets = async (tickets: IEventTicketDocument[]): Promise<SheetResyncResult[]> => {
  if (!SHEET_ID || tickets.length === 0) return [];
  const byTab = new Map<string, IEventTicketDocument[]>();
  for (const t of tickets) {
    const wanted = t.sheetTab || buildTabTitle(t.eventTitle, t.eventDate);
    byTab.set(wanted, [...(byTab.get(wanted) ?? []), t]);
  }

  const results: SheetResyncResult[] = [];
  for (const [wanted, group] of byTab) {
    const sheetId = await ensureEventTab(wanted);
    const tab = actualTabName(wanted);
    await withTabLock(tab, async () => {
      const sheets = getSheets();
      const current = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${tab}'!A:${LAST_COL_LETTER}` });
      const values = current.data.values ?? [];
      const folioRows = new Map<string, number[]>();
      values.forEach((r, i) => {
        const folio = String(r[0] ?? '').trim().toUpperCase();
        if (i > 0 && folio) folioRows.set(folio, [...(folioRows.get(folio) ?? []), i + 1]);
      });
      const isFree = (row: number): boolean => (values[row - 1] ?? []).every((c) => String(c ?? '').trim() === '');
      const taken = new Set<number>();
      let nextFree = Math.max(values.length + 1, 2);

      const data: sheets_v4.Schema$ValueRange[] = [];
      const format: sheets_v4.Schema$Request[] = [];
      const clearRanges: string[] = [];
      for (const t of group) {
        const found = folioRows.get(t.folio.toUpperCase()) ?? [];
        if (t.status === 'void') {
          for (const r of found) {
            clearRanges.push(`'${tab}'!A${r}:${LAST_COL_LETTER}${r}`);
            format.push({
              repeatCell: {
                range: { sheetId, startRowIndex: r - 1, endRowIndex: r, startColumnIndex: 0, endColumnIndex: HEADERS.length },
                cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { bold: false } } },
                fields: 'userEnteredFormat(backgroundColor,textFormat.bold)',
              },
            });
          }
          results.push({ folio: t.folio, tab, row: 0, action: 'removed' });
          continue;
        }
        let row = found[0];
        let action: SheetResyncResult['action'] = 'updated';
        // Solo filas libres dentro de la zona con datos: las de más abajo podrían
        // chocar con las que se agregan al final.
        const saved = t.sheetTab && tabKey(t.sheetTab) === tabKey(tab) ? t.sheetRow : null;
        if (!row && saved && saved >= 2 && saved <= values.length && isFree(saved) && !taken.has(saved)) row = saved;
        if (!row) {
          row = nextFree++;
          action = 'added';
        }
        taken.add(row);
        // Mismo folio en varias filas: se queda la primera, las demás se vacían.
        for (const dup of found.slice(1)) clearRanges.push(`'${tab}'!A${dup}:${LAST_COL_LETTER}${dup}`);

        data.push({ range: `'${tab}'!A${row}:${LAST_COL_LETTER}${row}`, values: [ticketRow(t)] });
        format.push(
          {
            repeatCell: {
              range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: HEADERS.length },
              cell: { userEnteredFormat: { backgroundColor: t.status === 'used' ? GREEN : WHITE } },
              fields: 'userEnteredFormat.backgroundColor',
            },
          },
          {
            repeatCell: {
              range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: STATUS_COL, endColumnIndex: STATUS_COL + 1 },
              cell: { userEnteredFormat: { textFormat: { bold: t.status === 'used' } } },
              fields: 'userEnteredFormat.textFormat.bold',
            },
          },
        );
        results.push({ folio: t.folio, tab, row, action });
      }

      if (clearRanges.length) {
        await sheets.spreadsheets.values.batchClear({ spreadsheetId: SHEET_ID, requestBody: { ranges: clearRanges } });
      }
      if (data.length) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SHEET_ID,
          requestBody: { valueInputOption: 'RAW', data },
        });
      }
      if (format.length) {
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: format } });
      }
    });
  }
  return results;
};

// Localiza la fila por folio cuando no se guardó sheetRow (p. ej. si el
// append falló al crear el boleto).
const findRowByFolio = async (tab: string, folio: string): Promise<number | null> => {
  const res = await getSheets().spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${tab}'!A:A` });
  const idx = (res.data.values ?? []).findIndex((r) => String(r[0] ?? '').trim().toUpperCase() === folio);
  return idx >= 0 ? idx + 1 : null;
};

// Quita de la hoja un boleto dado de baja: vacía toda fila con su folio (y la
// que tenía guardada, si sigue siendo suya) y le quita el color.
const removeTicketRow = async (ticket: IEventTicketDocument): Promise<void> => {
  const wanted = ticket.sheetTab || buildTabTitle(ticket.eventTitle, ticket.eventDate);
  const sheetId = await ensureEventTab(wanted);
  const tab = actualTabName(wanted);
  await withTabLock(tab, async () => {
    const sheets = getSheets();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${tab}'!A:A` });
    const folio = ticket.folio.toUpperCase();
    const rows = (res.data.values ?? [])
      .map((r, i) => (i > 0 && String(r[0] ?? '').trim().toUpperCase() === folio ? i + 1 : 0))
      .filter((r) => r > 0);
    if (rows.length === 0) return;
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: SHEET_ID,
      requestBody: { ranges: rows.map((r) => `'${tab}'!A${r}:${LAST_COL_LETTER}${r}`) },
    });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: rows.map((r) => ({
          repeatCell: {
            range: { sheetId, startRowIndex: r - 1, endRowIndex: r, startColumnIndex: 0, endColumnIndex: HEADERS.length },
            cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { bold: false } } },
            fields: 'userEnteredFormat(backgroundColor,textFormat.bold)',
          },
        })),
      },
    });
  });
};

// Reescribe la fila completa del boleto (estado, hora, quién) y la pinta
// verde si asistió / blanca si se deshizo el check-in. Si el boleto está dado
// de baja, en vez de escribirlo lo quita de la hoja.
export const syncTicketRow = async (ticket: IEventTicketDocument): Promise<{ tab: string; row: number } | null> => {
  if (!SHEET_ID) return null;
  if (ticket.status === 'void') {
    await removeTicketRow(ticket);
    return null;
  }
  const wanted = ticket.sheetTab || buildTabTitle(ticket.eventTitle, ticket.eventDate);
  const sheetId = await ensureEventTab(wanted);
  const tab = actualTabName(wanted);
  let row = ticket.sheetRow ?? null;
  // La fila guardada puede haberla ocupado otro boleto (p. ej. tras una baja
  // que liberó la última fila): solo se usa si está vacía o es de este folio.
  if (row && row >= 2) {
    const cell = await getSheets().spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${tab}'!A${row}` });
    const owner = String(cell.data.values?.[0]?.[0] ?? '').trim().toUpperCase();
    if (owner && owner !== ticket.folio.toUpperCase()) row = null;
  }
  if (!row || row < 2) row = await findRowByFolio(tab, ticket.folio);
  if (!row) {
    const appended = await appendTicketRow(ticket);
    if (!appended) return null;
    row = appended.row;
  }

  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${tab}'!A${row}:${LAST_COL_LETTER}${row}`,
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

// Vacía la fila de un boleto que se movió a otra pestaña (no borra la fila, así
// los números de fila de los demás boletos siguen valiendo).
export const clearTicketRow = async (tab: string, row: number): Promise<void> => {
  if (!SHEET_ID || row < 2) return;
  await getSheets().spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `'${tab}'!A${row}:${LAST_COL_LETTER}${row}`,
  });
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
