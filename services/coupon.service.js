import Coupon from '../models/Coupon.js';
import CouponRedemption from '../models/CouponRedemption.js';
import MediaAsset from '../models/MediaAsset.js';
import ApiError from '../utils/ApiError.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { escapeRegex } from '../utils/regex.js';
export const couponStatus = (coupon, now = new Date()) => new Date(coupon.endDate) < now || coupon.redemptions >= coupon.totalUsageLimit ? 'EXPIRED' : new Date(coupon.startDate) > now ? 'SCHEDULED' : 'ACTIVE';
const serialize = coupon => { const value = coupon.toObject ? coupon.toObject() : coupon; return { ...value, status: couponStatus(value) }; };
export const listCoupons = async query => {
 const { page, limit, skip } = parsePagination(query);
 const now = new Date(); const filter = { deletedAt: null }; const exhausted = { $expr: { $gte: ['$redemptions', '$totalUsageLimit'] } };
 if (query.search) filter.$or = ['name', 'email', 'code'].map(key => ({ [key]: { $regex: escapeRegex(query.search), $options: 'i' } }));
 if (query.status === 'ACTIVE') { filter.startDate = { $lte: now }; filter.endDate = { $gte: now }; filter.$expr = { $lt: ['$redemptions', '$totalUsageLimit'] }; }
 if (query.status === 'SCHEDULED') { filter.startDate = { $gt: now }; filter.endDate = { $gte: now }; filter.$expr = { $lt: ['$redemptions', '$totalUsageLimit'] }; }
 if (query.status === 'EXPIRED') filter.$and = [{ $or: [{ endDate: { $lt: now } }, exhausted] }];
 const [items, total] = await Promise.all([Coupon.find(filter).populate('avatarMediaId').sort({createdAt:-1}).skip(skip).limit(limit), Coupon.countDocuments(filter)]);
 return { items: items.map(serialize), meta: paginationMeta(page, limit, total) };
};
export const getCoupon = async id => {
 const coupon = await Coupon.findOne({ _id: id, deletedAt: null }).populate('avatarMediaId');
 if (!coupon) throw new ApiError(404, 'Coupon not found', 'COUPON_NOT_FOUND');
 return serialize(coupon);
};
export const createCoupon = async (actorId, input) => {
 const coupon = new Coupon({ ...input, createdBy: actorId });
 // The avatar belongs to its creating admin, and cannot be a different user's upload.
 if (input.avatarMediaId) {
  const asset = await MediaAsset.findOneAndUpdate({ _id: input.avatarMediaId, ownerId: actorId, purpose: 'AVATAR', claimedById: null }, { $set: { claimedByType: 'COUPON', claimedById: coupon._id, claimedAt: new Date() } }, { returnDocument: 'after', runValidators: true });
  if (!asset) throw new ApiError(400, 'Media asset is invalid or already in use', 'INVALID_MEDIA_ASSET');
 }
 try { await coupon.save(); } catch (error) {
  if (input.avatarMediaId) await MediaAsset.updateOne({ _id: input.avatarMediaId, claimedById: coupon._id }, { $unset: { claimedByType: 1, claimedById: 1, claimedAt: 1 } });
  throw error;
 }
 return serialize(await coupon.populate('avatarMediaId'));
};
export const deleteCoupon = async id => {
 const coupon = await Coupon.findOneAndUpdate({ _id: id, deletedAt: null }, { $set: { deletedAt: new Date() } }, { returnDocument: 'after' });
 if (!coupon) throw new ApiError(404, 'Coupon not found', 'COUPON_NOT_FOUND');
 return { deleted: true };
};
export const couponStats = async () => {
 const [totals] = await Coupon.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: null, totalCoupons: { $sum: 1 }, totalRedemptions: { $sum: '$redemptions' }, discountGiven: { $sum: '$discountGiven' }, revenue: { $sum: '$revenue' } } }, { $project: { _id: 0 } }]);
 return totals || { totalCoupons: 0, totalRedemptions: 0, discountGiven: 0, revenue: 0 };
};
const round2 = (value) => Math.round(value * 100) / 100;

/// What the app needs to sell a code's discount, and nothing an influencer
/// would not want shown to a stranger.
const publicCoupon = (coupon) => ({
 code: coupon.code,
 influencerName: coupon.name,
 discountType: coupon.discountType,
 discountValue: coupon.discountValue,
 offeringId: coupon.offeringId,
 endsAt: coupon.endDate
});

const productionRedemptions = (filter) => CouponRedemption.countDocuments({ ...filter, status: 'COMPLETED', environment: 'PRODUCTION' });

/// Holds [rawCode] for [userId]'s next store purchase. One code at a time:
/// applying another replaces it.
export const applyCoupon = async (userId, rawCode) => {
 const code = rawCode.trim().toUpperCase();
 const coupon = await Coupon.findOne({ code, deletedAt: null });
 if (!coupon) throw new ApiError(404, 'This code is not valid', 'COUPON_INVALID');
 const status = couponStatus(coupon);
 if (status === 'SCHEDULED') throw new ApiError(409, 'This code is not active yet', 'COUPON_NOT_STARTED');
 if (status === 'EXPIRED') throw new ApiError(409, 'This code has expired', 'COUPON_EXPIRED');
 if (!coupon.offeringId) throw new ApiError(409, 'This code cannot be used in the app yet', 'COUPON_NOT_CONFIGURED');
 if (await productionRedemptions({ couponId: coupon._id, userId }) >= coupon.perUserLimit) {
  throw new ApiError(409, 'You have already used this code', 'COUPON_ALREADY_USED');
 }
 await CouponRedemption.deleteMany({ userId, status: 'APPLIED', couponId: { $ne: coupon._id } });
 await CouponRedemption.updateOne(
  { userId, couponId: coupon._id, status: 'APPLIED' },
  { $set: { code, offeringId: coupon.offeringId, appliedAt: new Date() } },
  { upsert: true }
 );
 return publicCoupon(coupon);
};

/// The code [userId] has applied, while it can still be used; null otherwise.
export const appliedCoupon = async (userId) => {
 const redemption = await CouponRedemption.findOne({ userId, status: 'APPLIED' }).sort({ appliedAt: -1 });
 if (!redemption) return null;
 const coupon = await Coupon.findOne({ _id: redemption.couponId, deletedAt: null });
 if (!coupon || couponStatus(coupon) !== 'ACTIVE' || !coupon.offeringId) {
  await redemption.deleteOne();
  return null;
 }
 return publicCoupon(coupon);
};

export const removeAppliedCoupon = async (userId) => {
 await CouponRedemption.deleteMany({ userId, status: 'APPLIED' });
 return { removed: true };
};

const editable = ['name', 'email', 'code', 'discountType', 'discountValue', 'commissionRate', 'startDate', 'endDate', 'totalUsageLimit', 'perUserLimit', 'offeringId'];

export const updateCoupon = async (id, input) => {
 const coupon = await Coupon.findOne({ _id: id, deletedAt: null });
 if (!coupon) throw new ApiError(404, 'Coupon not found', 'COUPON_NOT_FOUND');
 for (const key of editable) {
  if (input[key] === undefined) continue;
  coupon[key] = input[key] === null || input[key] === '' ? undefined : input[key];
 }
 const issues = [];
 if (coupon.endDate < coupon.startDate) issues.push({ path: 'endDate', message: 'End date must be on or after start date' });
 if (coupon.discountType === 'PERCENTAGE' && coupon.discountValue > 100) issues.push({ path: 'discountValue', message: 'Percentage discount cannot exceed 100' });
 if (coupon.perUserLimit > coupon.totalUsageLimit) issues.push({ path: 'perUserLimit', message: 'Per user limit cannot exceed total usage limit' });
 if (issues.length) throw new ApiError(422, 'Validation failed', 'VALIDATION_ERROR', issues);
 await coupon.save();
 return serialize(await coupon.populate('avatarMediaId'));
};

export const listRedemptions = async (couponId, query) => {
 const { page, limit, skip } = parsePagination(query);
 const filter = { couponId };
 const [items, total] = await Promise.all([
  CouponRedemption.find(filter)
   .populate({ path: 'userId', select: 'displayName email contactCode avatarMediaId', populate: { path: 'avatarMediaId' } })
   .sort({ createdAt: -1 }).skip(skip).limit(limit),
  CouponRedemption.countDocuments(filter)
 ]);
 return { items, meta: paginationMeta(page, limit, total) };
};

/// What the customer saved on a payment of [paidUsd] made with [coupon].
const discountFor = (coupon, paidUsd) => {
 if (coupon.discountType === 'FIXED') return coupon.discountValue;
 const rate = coupon.discountValue / 100;
 return rate >= 1 ? 0 : paidUsd / (1 - rate) - paidUsd;
};

const countToward = (redemption) => redemption.environment === 'PRODUCTION';

/// The first paid transaction after a code: revenue, the customer's saving
/// and the influencer's commission, credited once.
const recordPayment = async (redemption, event, eventAt) => {
 const coupon = await Coupon.findById(redemption.couponId);
 if (!coupon) return;
 const revenueUsd = round2(Math.max(Number(event.price) || 0, 0));
 const discountUsd = round2(discountFor(coupon, revenueUsd));
 const commissionUsd = round2(revenueUsd * coupon.commissionRate / 100);
 const paid = await CouponRedemption.findOneAndUpdate(
  { _id: redemption._id, paidAt: null },
  { $set: { paidAt: eventAt, paidEventId: event.id, revenueUsd, discountUsd, commissionUsd } },
  { returnDocument: 'after' }
 );
 if (paid && countToward(paid)) {
  await Coupon.updateOne({ _id: coupon._id }, { $inc: { revenue: revenueUsd, discountGiven: discountUsd, commission: commissionUsd } });
 }
};

const PURCHASES = ['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE'];

/// Credits an influencer code for a RevenueCat event. Safe to run more than
/// once for the same event: every step only moves a redemption forward.
export const attributeStoreEvent = async (event, user) => {
 const environment = event.environment === 'SANDBOX' ? 'SANDBOX' : 'PRODUCTION';
 const eventAt = event.event_timestamp_ms ? new Date(event.event_timestamp_ms) : new Date();
 const transaction = event.original_transaction_id || event.transaction_id;
 const price = Number(event.price) || 0;

 if (PURCHASES.includes(event.type)) {
  const purchase = { status: 'COMPLETED', environment, completedAt: eventAt, productId: event.product_id, store: event.store, originalTransactionId: transaction, purchaseEventId: event.id };
  let redemption = null;
  const applied = await CouponRedemption.findOne({ userId: user._id, status: 'APPLIED' }).sort({ appliedAt: -1 });
  // Bought from the regular offering after all: the code was not used.
  const offeringMatches = !applied?.offeringId || !event.presented_offering_id || event.presented_offering_id === applied.offeringId;
  if (applied && offeringMatches) {
   redemption = await CouponRedemption.findOneAndUpdate({ _id: applied._id, status: 'APPLIED' }, { $set: purchase }, { returnDocument: 'after' });
   if (redemption && countToward(redemption)) await Coupon.updateOne({ _id: redemption.couponId }, { $inc: { redemptions: 1 } });
  } else if (event.offer_code) {
   // A store offer code named after an influencer code, redeemed in the
   // App Store or Play Store rather than typed into the app.
   const coupon = await Coupon.findOne({ code: String(event.offer_code).trim().toUpperCase(), deletedAt: null });
   if (coupon) {
    const result = await CouponRedemption.findOneAndUpdate(
     { purchaseEventId: event.id },
     { $setOnInsert: { ...purchase, couponId: coupon._id, userId: user._id, code: coupon.code, appliedAt: eventAt } },
     { upsert: true, returnDocument: 'after', includeResultMetadata: true }
    );
    redemption = result.value;
    if (result.lastErrorObject?.upserted && countToward(redemption)) await Coupon.updateOne({ _id: coupon._id }, { $inc: { redemptions: 1 } });
   }
  }
  if (!redemption) redemption = await CouponRedemption.findOne({ purchaseEventId: event.id });
  if (redemption && price > 0 && event.period_type !== 'TRIAL') await recordPayment(redemption, event, eventAt);
  return;
 }

 if (event.type === 'RENEWAL' && event.is_trial_conversion && transaction) {
  const redemption = await CouponRedemption.findOne({ userId: user._id, status: 'COMPLETED', originalTransactionId: transaction, paidAt: null });
  if (redemption && price > 0) await recordPayment(redemption, event, eventAt);
  return;
 }

 // RevenueCat reports a refund as a cancellation with a negative price.
 if (event.type === 'CANCELLATION' && price < 0 && transaction) {
  const redemption = await CouponRedemption.findOneAndUpdate(
   { userId: user._id, originalTransactionId: transaction, paidAt: { $ne: null }, refundedAt: null },
   { $set: { refundedAt: eventAt } },
   { returnDocument: 'after' }
  );
  if (redemption && countToward(redemption)) {
   await Coupon.updateOne({ _id: redemption.couponId }, { $inc: { revenue: -redemption.revenueUsd, discountGiven: -redemption.discountUsd, commission: -redemption.commissionUsd } });
  }
 }
};
