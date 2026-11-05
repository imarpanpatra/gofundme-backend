import app from './app.js';
import { config } from './config.js';
import { connectDb } from './db.js';

connectDb()
  .then(() => {
    app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
