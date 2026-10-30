import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { apiRoutes } from './atomic/pages/routes/index.js';
import { globalLimiter } from './atomic/molecules/middleware/rateLimit.middleware.js';
import { isAllowedOrigin } from './config/allowed-origins.js';

const app = express();

// nginx es el unico reverse proxy delante de este servidor (ver despliegue en
// el VPS) — confiar solo en ese primer salto es lo que necesita
// express-rate-limit para leer bien el X-Forwarded-For sin permitir que un
// cliente falsifique su propia IP agregando saltos falsos al header.
app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Sin header Origin (curl, apps móviles, server-to-server, health checks
      // de la plataforma de hosting): se permite, no es una petición de navegador.
      if (!origin || isAllowedOrigin(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }),
);
app.use(morgan('dev'));
app.use(express.json({
  limit: '10mb',
  verify: (req: any, _res, buf) => {
    if (req.originalUrl?.endsWith('/payments/webhook')) req.rawBody = buf;
    // La firma de Mailchimp se calcula sobre los bytes exactos del cuerpo.
    if (req.originalUrl?.includes('/email/webhooks/mailchimp')) req.rawBody = buf;
  },
}));
app.use(express.urlencoded({
  extended: true,
  verify: (req: any, _res, buf) => {
    if (req.originalUrl?.includes('/email/webhooks/mailchimp')) req.rawBody = buf;
  },
}));

// Catálogos públicos: permitir que navegador/CDN cacheen respuestas anónimas
// por 1 min (y servir stale hasta 5 min mientras revalidan). Sólo GET sin
// Authorization, para no cachear vistas personalizadas.
const PUBLIC_CACHE_PREFIXES = ['/courses', '/events', '/event-groups', '/blog', '/books', '/packages', '/offers', '/promotions'];
app.use('/api/v1', (req, res, next) => {
  if (req.method === 'GET' && !req.headers.authorization && PUBLIC_CACHE_PREFIXES.some((p) => req.path.startsWith(p))) {
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.set('Vary', 'Origin, Authorization, Accept-Encoding');
  }
  next();
});

app.use('/api/v1', globalLimiter, apiRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date() }));

app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

app.use((err: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.statusCode ?? 500;
  res.status(status).json({ message: err.message ?? 'Internal server error' });
});

export default app;
