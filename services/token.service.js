import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import Session from '../models/Session.js';
import { randomToken, randomUuid, sha256 } from '../utils/crypto.js';

export const signAccessToken = (user) => jwt.sign(
  { sub: user._id.toString(), role: user.role, type: 'access' },
  env.JWT_ACCESS_SECRET,
  { expiresIn: env.ACCESS_TOKEN_TTL, issuer: env.APP_NAME, audience: 'compcri-api' }
);

export const verifyAccessToken = (token) => jwt.verify(token, env.JWT_ACCESS_SECRET, {
  issuer: env.APP_NAME,
  audience: 'compcri-api'
});

export const issueRefreshToken = async (userId, context = {}, familyId = randomUuid()) => {
  const token = randomToken();
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await Session.create({ userId, familyId, tokenHash, expiresAt, userAgent: context.userAgent, ip: context.ip });
  return { token, tokenHash, expiresAt, familyId };
};

export const revokeAllSessions = (userId) => Session.updateMany(
  { userId, revokedAt: null },
  { $set: { revokedAt: new Date() } }
);

