import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';

const MESSAGE = { error: 'Too many attempts. Please wait a few minutes and try again.' };
let indexReady = null;

class MongoStore {
  constructor(name) {
    this.prefix = `${name}:`;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  get coll() {
    return mongoose.connection.collection('ratelimits');
  }

  ensureIndex() {
    if (!indexReady) {
      indexReady = this.coll.createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {
        indexReady = null;
      });
    }
    return indexReady;
  }

  async increment(key) {
    this.ensureIndex();
    const now = new Date();
    const doc = await this.coll.findOneAndUpdate(
      { _id: this.prefix + key },
      [
        { $set: { expired: { $or: [{ $not: ['$resetAt'] }, { $lte: ['$resetAt', now] }] } } },
        {
          $set: {
            hits: { $cond: ['$expired', 1, { $add: ['$hits', 1] }] },
            resetAt: { $cond: ['$expired', new Date(now.getTime() + this.windowMs), '$resetAt'] },
          },
        },
        { $unset: 'expired' },
      ],
      { upsert: true, returnDocument: 'after' }
    );
    return { totalHits: doc.hits, resetTime: doc.resetAt };
  }

  async decrement(key) {
    await this.coll.updateOne({ _id: this.prefix + key, hits: { $gt: 0 } }, { $inc: { hits: -1 } });
  }

  async resetKey(key) {
    await this.coll.deleteOne({ _id: this.prefix + key });
  }
}

export function limiter(name, windowMs, limit) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: MESSAGE,
    store: new MongoStore(name),
    passOnStoreError: true,
  });
}
