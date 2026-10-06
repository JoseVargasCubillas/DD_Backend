import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { env } from '../../../config/env.js';

// Sin 0/O/1/I para que el folio se dicte sin confusiones en la entrada.
const FOLIO_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Prefijo de 4 letras derivado del título del evento: "Coaching..." → COAC,
// "Taller de Estrategia Fiscal" → TEFI (iniciales si hay varias palabras).
export const buildFolioPrefix = (eventTitle: string): string => {
  const words = eventTitle
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'CON', 'PARA', 'POR'].includes(w));
  const source = words.length >= 2 ? words.map((w) => w[0]).join('') + words[0].slice(1) : words[0] ?? 'EVNT';
  return source.slice(0, 4).padEnd(4, 'X');
};

export const generateFolio = (eventTitle: string): string => {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += FOLIO_ALPHABET[randomInt(FOLIO_ALPHABET.length)];
  return `DD-${buildFolioPrefix(eventTitle)}-${code}`;
};

export const normalizeFolio = (raw: unknown): string =>
  String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');

export const FOLIO_PATTERN = /^DD-[A-Z0-9]{4}-[A-Z0-9]{6}$/;

const ticketSecret = (): string => process.env.TICKET_QR_SECRET || env.jwt.secret;

// Firma corta (16 chars base64url ≈ 96 bits) para que el QR siga siendo
// legible en pantallas pequeñas.
export const signFolio = (folio: string): string =>
  createHmac('sha256', ticketSecret()).update(normalizeFolio(folio)).digest('base64url').slice(0, 16);

export const verifyFolioSignature = (folio: string, signature: unknown): boolean => {
  const provided = String(signature ?? '');
  const expected = signFolio(folio);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
};

export const buildTicketUrl = (folio: string, signature: string): string =>
  `${env.clientUrl.replace(/\/$/, '')}/boleto/${encodeURIComponent(folio)}?t=${encodeURIComponent(signature)}`;

export const buildTicketQrUrl = (folio: string, signature: string): string =>
  `${env.serverUrl.replace(/\/$/, '')}/api/v1/tickets/${encodeURIComponent(folio)}/qr.png?t=${encodeURIComponent(signature)}`;

// Acepta la URL completa del QR, "folio?t=sig" o un folio pelado.
export const parseScannedTicket = (raw: unknown): { folio: string; signature: string } | null => {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    const match = url.pathname.match(/\/boleto\/([^/]+)/i);
    if (match) {
      return { folio: normalizeFolio(decodeURIComponent(match[1])), signature: url.searchParams.get('t') ?? '' };
    }
  } catch {
    // no es URL
  }
  const [folioPart, query = ''] = text.split('?');
  const folio = normalizeFolio(folioPart);
  if (!FOLIO_PATTERN.test(folio)) return null;
  const signature = new URLSearchParams(query).get('t') ?? '';
  return { folio, signature };
};
