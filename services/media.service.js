import { Readable } from 'node:stream';
import { StatusCodes } from 'http-status-codes';
import cloudinary from '../config/cloudinary.js';
import { env } from '../config/env.js';
import MediaAsset from '../models/MediaAsset.js';
import User from '../models/User.js';
import Event from '../models/Event.js';
import { SupportRequest } from '../models/Operations.js';
import ApiError from '../utils/ApiError.js';
import { getEventAccess } from './calendarAccess.service.js';

const streamUpload = (buffer, folder) => new Promise((resolve, reject) => {
  const uploadStream = cloudinary.uploader.upload_stream(
    { folder, resource_type: 'image' },
    (error, result) => error ? reject(error) : resolve(result)
  );
  Readable.from(buffer).pipe(uploadStream);
});

export const createMediaAsset = async (userId, purpose, file) => {
  if (!file) throw new ApiError(StatusCodes.BAD_REQUEST, 'Image is required', 'IMAGE_REQUIRED');
  if (!env.CLOUDINARY_CLOUD_NAME) throw new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'Media storage is not configured', 'MEDIA_UNAVAILABLE');
  const folder = `compcri/${userId}/${purpose.toLowerCase()}`;
  const result = await streamUpload(file.buffer, folder);
  return MediaAsset.create({
    ownerId: userId,
    purpose,
    publicId: result.public_id,
    secureUrl: result.secure_url,
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height
  });
};

export const claimMedia = async ({ mediaId, ownerId, purpose, claimedByType, claimedById }) => {
  if (!mediaId) return null;
  const asset = await MediaAsset.findOneAndUpdate(
    {
      _id: mediaId,
      ownerId,
      purpose,
      $or: [{ claimedById: null }, { claimedById: { $exists: false } }, { claimedById }]
    },
    { $set: { claimedByType, claimedById, claimedAt: new Date() } },
    { returnDocument: 'after', runValidators: true }
  );
  if (!asset) {
    if (await MediaAsset.exists({ _id: mediaId, ownerId, purpose })) throw new ApiError(409, 'Media asset is already in use', 'MEDIA_ALREADY_CLAIMED');
    throw new ApiError(400, 'Media asset is invalid', 'INVALID_MEDIA_ASSET');
  }
  return asset;
};

export const deleteMediaAsset = async (userId, mediaId, { allowClaimed = false } = {}) => {
  const asset = await MediaAsset.findOne({ _id: mediaId, ownerId: userId });
  if (!asset) throw new ApiError(404, 'Media asset not found', 'MEDIA_NOT_FOUND');
  if (asset.claimedById && !allowClaimed) throw new ApiError(409, 'Claimed media cannot be deleted directly', 'MEDIA_IN_USE');
  if (env.CLOUDINARY_CLOUD_NAME) await cloudinary.uploader.destroy(asset.publicId, { resource_type: 'image' });
  await asset.deleteOne();
};

const targetPurpose = { USER: 'AVATAR', EVENT: 'EVENT_POSTER', SUPPORT_REQUEST: 'SUPPORT_ATTACHMENT' };

const attachToTarget = async (userId, asset, targetType, targetId) => {
  if (asset.purpose !== targetPurpose[targetType]) throw new ApiError(422, 'Media purpose does not match its target', 'MEDIA_PURPOSE_MISMATCH');
  if (targetType === 'USER') {
    if (targetId.toString() !== userId.toString()) throw new ApiError(403, 'Avatar target must be your own profile', 'MEDIA_TARGET_FORBIDDEN');
    await User.updateOne({ _id: userId }, { $set: { avatarMediaId: asset._id } });
  } else if (targetType === 'EVENT') {
    const access = await getEventAccess(userId, targetId);
    if (!access.canEdit) throw new ApiError(403, 'Editing this event is not permitted', 'EVENT_EDIT_FORBIDDEN');
    await Event.updateOne({ _id: targetId }, { $set: { posterMediaId: asset._id } });
  } else {
    const request = await SupportRequest.findOne({ _id: targetId, userId });
    if (!request) throw new ApiError(404, 'Support request not found', 'SUPPORT_REQUEST_NOT_FOUND');
    await SupportRequest.updateOne({ _id: targetId }, { $addToSet: { mediaIds: asset._id } });
  }
};

export const claimOwnedMedia = async (userId, mediaId, targetType, targetId) => {
  const existing = await MediaAsset.findOne({ _id: mediaId, ownerId: userId, purpose: targetPurpose[targetType] });
  const wasClaimed = Boolean(existing?.claimedById);
  const asset = await claimMedia({ mediaId, ownerId: userId, purpose: targetPurpose[targetType], claimedByType: targetType, claimedById: targetId });
  try {
    await attachToTarget(userId, asset, targetType, targetId);
    return asset;
  } catch (error) {
    if (!wasClaimed) {
      asset.claimedByType = undefined;
      asset.claimedById = undefined;
      asset.claimedAt = undefined;
      await asset.save();
    }
    throw error;
  }
};

export const replaceMediaAsset = async (userId, mediaId, file) => {
  const oldAsset = await MediaAsset.findOne({ _id: mediaId, ownerId: userId });
  if (!oldAsset) throw new ApiError(404, 'Media asset not found', 'MEDIA_NOT_FOUND');
  const replacement = await createMediaAsset(userId, oldAsset.purpose, file);
  try {
    if (oldAsset.claimedByType && oldAsset.claimedById) {
      replacement.claimedByType = oldAsset.claimedByType;
      replacement.claimedById = oldAsset.claimedById;
      replacement.claimedAt = new Date();
      await replacement.save();
      await attachToTarget(userId, replacement, oldAsset.claimedByType, oldAsset.claimedById);
    }
    await deleteMediaAsset(userId, oldAsset._id, { allowClaimed: true });
    return replacement;
  } catch (error) {
    await deleteMediaAsset(userId, replacement._id, { allowClaimed: true }).catch(() => undefined);
    throw error;
  }
};
