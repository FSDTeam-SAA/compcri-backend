import mongoose from 'mongoose';
const couponSchema = new mongoose.Schema({
 name: { type: String, required: true, trim: true, maxlength: 100 },
 email: { type: String, required: true, trim: true, lowercase: true },
 avatarMediaId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },
 code: { type: String, required: true, trim: true, uppercase: true, unique: true },
 discountType: { type: String, enum: ['PERCENTAGE', 'FIXED'], required: true },
 discountValue: { type: Number, required: true, min: 0.01 },
 commissionRate: { type: Number, required: true, min: 0, max: 100 },
 startDate: { type: Date, required: true }, endDate: { type: Date, required: true },
 totalUsageLimit: { type: Number, required: true, min: 1 },
 perUserLimit: { type: Number, required: true, min: 1 },
 // The RevenueCat offering whose discounted products the app sells while this
 // code is applied. Without one the code cannot be used in the app.
 offeringId: { type: String, trim: true, maxlength: 100 },
 redemptions: { type: Number, default: 0, min: 0 },
 revenue: { type: Number, default: 0, min: 0 },
 discountGiven: { type: Number, default: 0, min: 0 },
 commission: { type: Number, default: 0, min: 0 },
 createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
 deletedAt: { type: Date, default: null }
}, { timestamps: true });
couponSchema.index({ deletedAt: 1, createdAt: -1 });
export default mongoose.model('Coupon', couponSchema);