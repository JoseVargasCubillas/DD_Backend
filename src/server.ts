import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/database.js';

const PORT = Number(process.env.PORT) || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT} [${process.env.NODE_ENV ?? 'development'}]`);
    });
  })
  .catch((err: Error) => {
    console.error('DB connection failed:', err.message);
    process.exit(1);
  });
