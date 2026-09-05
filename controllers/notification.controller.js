import { StatusCodes } from 'http-status-codes';
import Notification from '../models/Notification.js';
import Device from '../models/Device.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { sendSuccess } from '../utils/response.js';

export const list = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { userId: req.user._id, deletedAt: null, ...(req.query.unread === 'true' && { readAt: null }) };
  const [items, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter)
  ]);
  sendSuccess(res, items, { meta: paginationMeta(page, limit, total) });
});

export const read = catchAsync(async (req, res) => {
  const item = await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.user._id, deletedAt: null }, { $set: { readAt: new Date() } }, { returnDocument: 'after' });
  if (!item) throw new ApiError(404, 'Notification not found', 'NOTIFICATION_NOT_FOUND');
  sendSuccess(res, item);
});

export const readAll = catchAsync(async (req, res) => {
  const result = await Notification.updateMany({ userId: req.user._id, deletedAt: null, readAt: null }, { $set: { readAt: new Date() } });
  sendSuccess(res, { updated: result.modifiedCount });
});

export const remove = catchAsync(async (req, res) => {
  const item = await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.user._id, deletedAt: null }, { $set: { deletedAt: new Date() } });
  if (!item) throw new ApiError(404, 'Notification not found', 'NOTIFICATION_NOT_FOUND');
  sendSuccess(res, { deleted: true });
});

export const registerDevice = catchAsync(async (req, res) => {
  const device = await Device.findOneAndUpdate(
    { token: req.body.token },
    { $set: { userId: req.user._id, platform: req.body.platform, lastSeenAt: new Date() } },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  sendSuccess(res, device, { status: StatusCodes.CREATED });
});

export const unregisterDevice = catchAsync(async (req, res) => {
  await Device.deleteOne({ token: req.body.token, userId: req.user._id });
  sendSuccess(res, { deleted: true });
});
