import { env } from '../config/env.js';

export const hasPremiumAccess = (user, now = new Date()) => (
  !env.PAYWALL_ENABLED
  || (user?.plan === 'PREMIUM' && (!user.premiumUntil || user.premiumUntil > now))
);

export const effectivePlan = (user) => (hasPremiumAccess(user) ? 'PREMIUM' : 'FREE');
