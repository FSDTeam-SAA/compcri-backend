import { createPublicKey } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const KEYS_URL = 'https://appleid.apple.com/auth/keys';
const ISSUER = 'https://appleid.apple.com';
const KEY_TTL_MS = 60 * 60 * 1000;

let cache = { keys: new Map(), fetchedAt: 0 };

/// Apple publishes a handful of rotating RSA keys. They change rarely, so a
/// cached copy avoids a network hop on every sign-in, and an unknown `kid`
/// forces one refresh in case rotation just happened.
const loadKeys = async (force = false) => {
  if (!force && cache.keys.size && Date.now() - cache.fetchedAt < KEY_TTL_MS) return cache.keys;
  let payload;
  try {
    const response = await fetch(KEYS_URL, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    payload = await response.json();
  } catch {
    if (cache.keys.size) return cache.keys;
    throw new ApiError(503, 'Apple sign-in is temporarily unavailable', 'APPLE_KEYS_UNAVAILABLE');
  }
  const keys = new Map();
  for (const jwk of payload.keys || []) {
    keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
  }
  cache = { keys, fetchedAt: Date.now() };
  return keys;
};

export const resetAppleKeyCacheForTests = () => { cache = { keys: new Map(), fetchedAt: 0 }; };

/// Verifies the identity token the device received from Apple and returns its
/// subject and email. The audience is the app's bundle identifier, so a token
/// minted for a different app cannot be replayed here.
export const verifyAppleIdentityToken = async (identityToken) => {
  if (!env.APPLE_CLIENT_IDS.length) {
    throw new ApiError(503, 'Apple login is not configured', 'APPLE_AUTH_UNAVAILABLE');
  }
  const decoded = jwt.decode(identityToken, { complete: true });
  if (!decoded?.header?.kid) {
    throw new ApiError(401, 'Apple token is invalid', 'INVALID_APPLE_TOKEN');
  }
  let keys = await loadKeys();
  let key = keys.get(decoded.header.kid);
  if (!key) {
    keys = await loadKeys(true);
    key = keys.get(decoded.header.kid);
  }
  if (!key) throw new ApiError(401, 'Apple token is invalid', 'INVALID_APPLE_TOKEN');

  let payload;
  try {
    payload = jwt.verify(identityToken, key, {
      algorithms: ['RS256'],
      audience: env.APPLE_CLIENT_IDS,
      issuer: ISSUER
    });
  } catch {
    throw new ApiError(401, 'Apple token is invalid', 'INVALID_APPLE_TOKEN');
  }
  if (!payload.sub) throw new ApiError(401, 'Apple token is invalid', 'INVALID_APPLE_TOKEN');
  return {
    subject: payload.sub,
    email: payload.email?.toLowerCase(),
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    isPrivateEmail: payload.is_private_email === true || payload.is_private_email === 'true'
  };
};
