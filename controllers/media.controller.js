import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import { claimOwnedMedia, createMediaAsset, deleteMediaAsset, replaceMediaAsset } from '../services/media.service.js';

export const upload = catchAsync(async (req, res) => sendSuccess(
  res,
  await createMediaAsset(req.user._id, req.body.purpose, req.file),
  { status: StatusCodes.CREATED }
));
export const remove = catchAsync(async (req, res) => {
  await deleteMediaAsset(req.user._id, req.params.id);
  sendSuccess(res, { deleted: true });
});
export const claim = catchAsync(async (req, res) => sendSuccess(res, await claimOwnedMedia(req.user._id, req.params.id, req.body.targetType, req.body.targetId)));
export const replace = catchAsync(async (req, res) => sendSuccess(res, await replaceMediaAsset(req.user._id, req.params.id, req.file)));
