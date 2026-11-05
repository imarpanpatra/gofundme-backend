import app from './app.js';
import { config, missingEnv } from './config.js';
import { connectDb } from './db.js';

if (missingEnv.length) {
  console.error(`Missing env vars: ${missingEnv.join(', ')}. Copy .env.example to .env and fill them in.`);
  process.exit(1);
}

connectDb()
  .then(() => {
    app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
