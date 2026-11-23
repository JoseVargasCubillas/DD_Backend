/**
 * Una sola vez: completa el teléfono de los asistentes ya registrados que lo
 * tienen vacío y actualiza su fila en el Sheet.
 *
 *   · hubspot:<negocio>:<item> → teléfono del contacto del negocio en HubSpot
 *     (el contacto con el mismo correo del asistente; si no, el del negocio)
 *   · compras web              → teléfono de contacto de la orden; si no hay, el del
 *     usuario de la orden o de la cuenta con el mismo correo
 *
 * Cubre inscritos online y boletos presenciales. Es idempotente: quien ya tiene
 * teléfono no se toca.
 *
 * Uso:
 *   npm run tickets:backfill-phones            → solo muestra qué haría
 *   npm run tickets:backfill-phones -- --apply → lo escribe, con pausas por el límite de Sheets
 */

import '../config/load-env.js';
import { connectDB } from '../config/database.js';
import { EventTicket } from '../atomic/molecules/models/event-ticket.model.js';
import { Order } from '../atomic/molecules/models/order.model.js';
import { User } from '../atomic/molecules/models/user.model.js';
import { dealContacts } from '../atomic/organisms/services/hubspot.service.js';
import { isAttendanceSheetEnabled, syncTicketRow } from '../atomic/organisms/services/attendance-sheet.service.js';

const apply = process.argv.includes('--apply');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const isQuota = (err: unknown): boolean => /quota exceeded|rate limit|429/i.test(String((err as Error)?.message ?? err));
// Google Sheets deja ~60 escrituras por minuto por usuario (cada fila hace 2).
const SHEET_PACE_MS = 4000;
const QUOTA_WAIT_MS = 65_000;

const main = async () => {
  await connectDB();
  const stats = { sinTelefono: 0, actualizados: 0, sinDato: 0, fallosSheet: 0 };
  const dealCache = new Map<string, Array<{ email: string; phone: string }>>();
  try {
    const missing = (await EventTicket.find({})).filter((t) => !String(t.attendeePhone ?? '').trim() && t.status !== 'void');
    stats.sinTelefono = missing.length;
    for (const t of missing) {
      let phone = '';
      try {
        if (t.orderId.startsWith('hubspot:')) {
          const dealId = t.orderId.split(':')[1];
          if (!dealCache.has(dealId)) dealCache.set(dealId, await dealContacts(dealId));
          const contacts = dealCache.get(dealId) ?? [];
          const email = (t.attendeeEmail || '').trim().toLowerCase();
          phone = (contacts.find((c) => c.email && c.email === email && c.phone) ?? contacts.find((c) => c.phone))?.phone ?? '';
        } else {
          // Compra web: teléfono de contacto de la orden; si no hay, el del usuario
          // de la orden y, al final, el de la cuenta con el mismo correo.
          const orderId = t.orderId.startsWith('web:') ? t.orderId.split(':')[1] : t.orderId;
          const order = await Order.findById(orderId).then((o) => o, () => null);
          phone = String(order?.contact?.phone ?? '').trim();
          if (!phone && order?.user) {
            const user = await User.findById(String(order.user)).then((u) => u, () => null);
            phone = String(user?.phone ?? '').trim();
          }
          if (!phone && t.attendeeEmail) {
            const user = await User.findOne({ email: t.attendeeEmail.trim().toLowerCase() }).then((u) => u, () => null);
            phone = String(user?.phone ?? '').trim();
          }
        }
      } catch (err) {
        console.log(`  ✖ ${t.folio}: no se pudo leer el teléfono — ${(err as Error).message.slice(0, 120)}`);
      }
      if (!phone) {
        stats.sinDato += 1;
        console.log(`· sin teléfono en la fuente: ${t.folio} ${t.attendeeName} <${t.attendeeEmail}> · ${t.eventTitle}`);
        continue;
      }
      console.log(`${apply ? '+' : '[dry]'} ${t.folio} ${t.attendeeName} → ${phone} · ${t.eventTitle}`);
      if (!apply) { stats.actualizados += 1; continue; }
      t.attendeePhone = phone;
      await t.save();
      stats.actualizados += 1;
      if (!isAttendanceSheetEnabled()) continue;
      let done = false;
      for (let attempt = 1; !done && attempt <= 3; attempt += 1) {
        try {
          const res = await syncTicketRow(t);
          if (res && (t.sheetRow !== res.row || t.sheetTab !== res.tab)) { t.sheetRow = res.row; t.sheetTab = res.tab; await t.save(); }
          done = true;
        } catch (err) {
          if (!isQuota(err)) { console.log(`  ✖ Sheet ${t.folio}: ${(err as Error).message.slice(0, 120)}`); break; }
          console.log(`  … límite del Sheet (${t.folio}), reintento ${attempt}/3 en ${QUOTA_WAIT_MS / 1000} s`);
          await sleep(QUOTA_WAIT_MS);
        }
      }
      if (!done) stats.fallosSheet += 1;
      await sleep(SHEET_PACE_MS);
    }
    console.log(JSON.stringify({ apply, ...stats }, null, 2));
  } finally {
    process.exit(0);
  }
};

main().catch((err) => {
  console.error('✖ Error en backfill-attendee-phones:', err);
  process.exit(1);
});
