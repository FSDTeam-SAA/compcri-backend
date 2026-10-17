import Coupon from '../models/Coupon.js';
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