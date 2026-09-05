import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import { enqueueJob } from '../jobs/agenda.js';
import * as service from '../services/revenuecat.service.js';
import { secureEquals } from '../utils/crypto.js';

export const getMine = catchAsync(async (req, res) => sendSuccess(res, await service.getSubscriptionForUser(req.user._id)));
export const reconcileMine = catchAsync(async (req, res) => {
  const current = await service.getSubscriptionForUser(req.user._id);
  sendSuccess(res, await service.reconcileSubscriber(current.appUserId));
});
export const webhook = catchAsync(async (req, res) => {
  if (!env.REVENUECAT_WEBHOOK_AUTH || !secureEquals(req.get('authorization') || '', env.REVENUECAT_WEBHOOK_AUTH)) {
    throw new ApiError(401, 'Webhook authorization failed', 'INVALID_WEBHOOK_AUTH');
  }
  const { event, duplicate } = await service.recordWebhook(req.body);
  if (!duplicate) await enqueueJob('reconcile-revenuecat', { eventId: event.id, appUserId: event.app_user_id });
  sendSuccess(res, { accepted: true, duplicate });
});
