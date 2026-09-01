// Codigos ISO 3166-2:MX que pide la API de Envia para el campo `state`
// (2-3 caracteres) — el resto del sistema maneja nombres completos en
// espanol, asi que esto solo se usa al armar el payload hacia Envia.
const STATE_CODES: Record<string, string> = {
  'Aguascalientes': 'AGU',
  'Baja California': 'BCN',
  'Baja California Sur': 'BCS',
  'Campeche': 'CAM',
  'Chiapas': 'CHP',
  'Chihuahua': 'CHH',
  'Ciudad de México': 'CMX',
  'Ciudad de Mexico': 'CMX',
  'CDMX': 'CMX',
  'Coahuila': 'COA',
  'Colima': 'COL',
  'Durango': 'DUR',
  'Guanajuato': 'GUA',
  'Guerrero': 'GRO',
  'Hidalgo': 'HID',
  'Jalisco': 'JAL',
  'Estado de México': 'MEX',
  'Estado de Mexico': 'MEX',
  'México': 'MEX',
  'Mexico': 'MEX',
  'Michoacán': 'MIC',
  'Michoacan': 'MIC',
  'Morelos': 'MOR',
  'Nayarit': 'NAY',
  'Nuevo León': 'NLE',
  'Nuevo Leon': 'NLE',
  'Oaxaca': 'OAX',
  'Puebla': 'PUE',
  // 'QRO', no el ISO 3166-2 'QUE': confirmado a mano contra el sandbox de
  // Envia — Estafeta rechaza 'QUE' ("State code not founded") pero acepta
  // 'QRO', y los otros 3 carriers soportados aceptan ambos.
  'Querétaro': 'QRO',
  'Queretaro': 'QRO',
  'Quintana Roo': 'ROO',
  'San Luis Potosí': 'SLP',
  'San Luis Potosi': 'SLP',
  'Sinaloa': 'SIN',
  'Sonora': 'SON',
  'Tabasco': 'TAB',
  'Tamaulipas': 'TAM',
  'Tlaxcala': 'TLA',
  'Veracruz': 'VER',
  'Yucatán': 'YUC',
  'Yucatan': 'YUC',
  'Zacatecas': 'ZAC',
};

export const MEXICAN_STATE_NAMES = [
  'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas',
  'Chihuahua', 'Ciudad de México', 'Coahuila', 'Colima', 'Durango', 'Guanajuato',
  'Guerrero', 'Hidalgo', 'Jalisco', 'Estado de México', 'Michoacán', 'Morelos',
  'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro', 'Quintana Roo',
  'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco', 'Tamaulipas', 'Tlaxcala',
  'Veracruz', 'Yucatán', 'Zacatecas',
];

export const resolveMexicanStateCode = (name: string): string | null => {
  const trimmed = String(name || '').trim();
  if (/^[A-Z]{2,3}$/.test(trimmed)) return trimmed;
  return STATE_CODES[trimmed] ?? null;
};
