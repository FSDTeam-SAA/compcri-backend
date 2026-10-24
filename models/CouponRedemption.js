import mongoose from 'mongoose';

/// A user's use of an influencer code.
///
/// APPLIED: the code was entered in the app and is waiting for a purchase.
/// COMPLETED: a store purchase arrived for that user through RevenueCat. The
/// first paid transaction (the purchase itself, or the end of a free trial)
/// fills the money fields; amounts are in USD as RevenueCat reports them, so
/// one influencer's totals add up across countries.
const couponRedemptionSchema = new mongoose.Schema({
  couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
  // Cleared when the customer's account is purged.
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  code: { type: String, required: true },
  offeringId: String,
  status: { type: String, enum: ['APPLIED', 'COMPLETED'], default: 'APPLIED', index: true },
  // Sandbox purchases (TestFlight, test cards) are recorded so the flow can be
  // checked end to end, but never count toward limits, revenue or commission.
  environment: { type: String, enum: ['PRODUCTION', 'SANDBOX'] },
  appliedAt: Date,
  completedAt: Date,
  productId: String,
  store: String,
  originalTransactionId: { type: String, index: true },
  purchaseEventId: { type: String, unique: true, sparse: true },
  paidAt: Date,
  paidEventId: String,
  revenueUsd: { type: Number, default: 0 },
  discountUsd: { type: Number, default: 0 },
  commissionUsd: { type: Number, default: 0 },
  refundedAt: Date
}, { timestamps: true });
couponRedemptionSchema.index({ userId: 1, status: 1, appliedAt: -1 });
couponRedemptionSchema.index({ couponId: 1, createdAt: -1 });
couponRedemptionSchema.index({ paidAt: 1 });

export default mongoose.model('CouponRedemption', couponRedemptionSchema);
