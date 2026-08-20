import './config/load-env.js';
import app from './app.js';
import { connectDB } from './config/database.js';
import { startEmailQueueWorker } from './atomic/organisms/services/email-queue.service.js';
import { startPackageExpirationWorker } from './atomic/organisms/services/package-expiration.service.js';

const PORT = Number(process.env.PORT) || 5000;

connectDB()
  .then(() => {
    startEmailQueueWorker();
    startPackageExpirationWorker();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT} [${process.env.NODE_ENV ?? 'development'}]`);
    });
  })
  .catch((err: Error) => {
    console.error('DB connection failed:', err.message);
    process.exit(1);
  });
