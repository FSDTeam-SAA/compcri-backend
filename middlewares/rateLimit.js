import { rateLimit } from 'express-rate-limit';
import RateLimit from '../models/RateLimit.js';

class MongoRateLimitStore {
  constructor(prefix) {
    this.prefix = prefix;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(rawKey) {
    const key = `${this.prefix}:${rawKey}`;
    const now = new Date();
    const nextExpiry = new Date(now.getTime() + this.windowMs);
    const isExpired = { $or: [{ $eq: [{ $type: '$expiresAt' }, 'missing'] }, { $lte: ['$expiresAt', now] }] };
    const entry = await RateLimit.findOneAndUpdate(
      { key },
      [{
        $set: {
          key,
          hits: { $cond: [isExpired, 1, { $add: [{ $ifNull: ['$hits', 0] }, 1] }] },
          expiresAt: { $cond: [isExpired, nextExpiry, '$expiresAt'] }
        }
      }],
      { upsert: true, returnDocument: 'after', updatePipeline: true }
    );
    return { totalHits: entry.hits, resetTime: entry.expiresAt };
  }

  async decrement(rawKey) {
    await RateLimit.updateOne({ key: `${this.prefix}:${rawKey}`, hits: { $gt: 0 } }, { $inc: { hits: -1 } });
  }

  async resetKey(rawKey) {
    await RateLimit.deleteOne({ key: `${this.prefix}:${rawKey}` });
  }
}

const handler = (req, res) => res.status(429).json({
  success: false,
  error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: req.id }
});

export const apiLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 500, store: new MongoRateLimitStore('api'), handler });
export const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, store: new MongoRateLimitStore('auth'), handler });
