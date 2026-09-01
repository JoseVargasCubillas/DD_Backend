import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { apiRoutes } from './atomic/pages/routes/index.js';
import { globalLimiter } from './atomic/molecules/middleware/rateLimit.middleware.js';
import { isAllowedOrigin } from './config/allowed-origins.js';

const app = express();

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
  },
}));
app.use(express.urlencoded({ extended: true }));

app.use('/api/v1', globalLimiter, apiRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date() }));

app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

app.use((err: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.statusCode ?? 500;
  res.status(status).json({ message: err.message ?? 'Internal server error' });
});

export default app;
