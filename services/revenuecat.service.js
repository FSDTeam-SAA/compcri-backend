import { env } from '../config/env.js';
import User from '../models/User.js';
import { RevenueCatEvent, Subscription } from '../models/Subscription.js';
import ApiError from '../utils/ApiError.js';
import { createNotification } from './notification.service.js';

const requestRevenueCat = async (path, options = {}) => {
  if (!env.REVENUECAT_SECRET_API_KEY) throw new ApiError(503, 'RevenueCat is not configured', 'REVENUECAT_UNAVAILABLE');
  const response = await fetch(`https://api.revenuecat.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new ApiError(502, 'RevenueCat request failed', 'REVENUECAT_REQUEST_FAILED', { status: response.status });
  return response.status === 204 ? null : response.json();
};

export const getSubscriptionForUser = async (userId) => {
  const [user, subscription] = await Promise.all([
    User.findById(userId).select('revenueCatAppUserId plan premiumUntil'),
    Subscription.findOne({ userId })
  ]);
  if (!user) throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');
  return { appUserId: user.revenueCatAppUserId, plan: user.plan, premiumUntil: user.premiumUntil, subscription };
};

export const reconcileSubscriber = async (appUserId) => {
  const user = await User.findOne({ revenueCatAppUserId: appUserId });
  if (!user) return null;
  const response = await requestRevenueCat(`/subscribers/${encodeURIComponent(appUserId)}`);
  const subscriber = response.subscriber;
  const entitlement = subscriber.entitlements?.[env.REVENUECAT_PREMIUM_ENTITLEMENT];
  const now = new Date();
  const expiresAt = entitlement?.expires_date ? new Date(entitlement.expires_date) : null;
  const active = Boolean(entitlement && (!expiresAt || expiresAt > now));
  let status = 'FREE';
  if (active) {
    if (entitlement.period_type === 'trial') status = 'TRIAL';
    else if (entitlement.grace_period_expires_date && new Date(entitlement.grace_period_expires_date) > now) status = 'GRACE';
    else if (entitlement.unsubscribe_detected_at) status = 'CANCELLED';
    else status = 'ACTIVE';
  } else if (entitlement) status = 'EXPIRED';
  const productId = entitlement?.product_identifier;
  const productSubscription = productId ? subscriber.subscriptions?.[productId] : null;
  const platformMap = { app_store: 'APP_STORE', play_store: 'PLAY_STORE' };
  const previous = await Subscription.findOne({ userId: user._id }).select('status');
  const subscription = await Subscription.findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        appUserId,
        entitlementId: env.REVENUECAT_PREMIUM_ENTITLEMENT,
        productId,
        platform: platformMap[productSubscription?.store] || 'UNKNOWN',
        status,
        willRenew: Boolean(productSubscription && !productSubscription.unsubscribe_detected_at),
        purchasedAt: productSubscription?.purchase_date ? new Date(productSubscription.purchase_date) : undefined,
        expiresAt,
        managementUrl: subscriber.management_url,
        lastSyncedAt: now
      }
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  user.plan = active ? 'PREMIUM' : 'FREE';
  user.premiumUntil = active ? expiresAt : null;
  await user.save();
  if (previous?.status !== subscription.status) {
    await createNotification(user._id, 'SUBSCRIPTION', 'Subscription updated', 'Your subscription status changed', { status: subscription.status });
  }
  return subscription;
};

export const recordWebhook = async (payload) => {
  const event = payload.event || payload;
  if (!event.id || !event.app_user_id || !event.type) throw new ApiError(400, 'RevenueCat webhook is malformed', 'INVALID_REVENUECAT_WEBHOOK');
  const price = Number(event.price_in_purchased_currency ?? event.price ?? 0);
  const document = await RevenueCatEvent.findOneAndUpdate(
    { eventId: event.id },
    {
      $setOnInsert: {
        appUserId: event.app_user_id,
        type: event.type,
        productId: event.product_id,
        platform: event.store,
        priceMinor: Number.isFinite(price) ? Math.round(price * 100) : 0,
        currency: event.currency || 'USD',
        eventAt: event.event_timestamp_ms ? new Date(event.event_timestamp_ms) : new Date(),
        payload
      }
    },
    { upsert: true, returnDocument: 'after', includeResultMetadata: true }
  );
  return { event, duplicate: !document.lastErrorObject?.upserted };
};

export const markWebhookProcessed = (eventId, error) => RevenueCatEvent.updateOne(
  { eventId },
  { $set: error ? { processingError: error.message } : { processedAt: new Date(), processingError: null } }
);

export const deleteRevenueCatCustomer = async (appUserId) => requestRevenueCat(`/subscribers/${encodeURIComponent(appUserId)}`, { method: 'DELETE' });
