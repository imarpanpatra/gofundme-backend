import mongoose from 'mongoose';
import { config } from './config.js';

let connecting = null;

export function connectDb() {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);
  if (!connecting) {
    connecting = mongoose
      .connect(config.mongoUri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 })
      .catch((err) => {
        connecting = null;
        throw err;
      });
  }
  return connecting;
}
