import { env } from './env.js';

// CLIENT_URL solo puede ser UN string exacto (p.ej. "https://www.diegodiaz.mx"),
// pero el sitio real puede recibir visitas tanto en el apex (diegodiaz.mx) como
// en el subdominio www — y un navegador solo manda uno de los dos como Origin.
// Si CORS exige coincidencia exacta con CLIENT_URL, la mitad de las visitas
// (según por cuál entraron) rompen TODAS las llamadas a la API. Aquí se
// derivan ambas variantes automáticamente a partir de un solo valor
// configurado, para que no dependa de que alguien recuerde configurar las dos.
const originVariants = (url: string): string[] => {
  try {
    const parsed = new URL(url);
    const bareHost = parsed.hostname.replace(/^www\./, '');
    return [
      `${parsed.protocol}//${bareHost}`,
      `${parsed.protocol}//www.${bareHost}`,
    ];
  } catch {
    return [url];
  }
};

export const ALLOWED_ORIGINS: readonly string[] = Array.from(
  new Set([
    ...originVariants(env.clientUrl),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]),
);

export const isAllowedOrigin = (origin: string): boolean => ALLOWED_ORIGINS.includes(origin);
