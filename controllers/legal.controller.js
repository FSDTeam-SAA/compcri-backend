import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import { LegalDocument } from '../models/Legal.js';
import { SupportRequest } from '../models/Operations.js';
import { sendMail } from '../services/mailer.service.js';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { claimMedia } from '../services/media.service.js';

export const listLegal = catchAsync(async (req, res) => {
  const locale = ['en', 'pt', 'es'].includes(req.query.locale) ? req.query.locale : 'en';
  let documents = await LegalDocument.find({ active: true, locale }).sort({ publishedAt: -1 });
  if (!documents.length && locale !== 'en') documents = await LegalDocument.find({ active: true, locale: 'en' }).sort({ publishedAt: -1 });
  sendSuccess(res, documents);
});

export const getLegal = catchAsync(async (req, res) => {
  const locale = ['en', 'pt', 'es'].includes(req.query.locale) ? req.query.locale : 'en';
  let document = await LegalDocument.findOne({ type: req.params.type.toUpperCase(), active: true, locale }).sort({ publishedAt: -1 });
  if (!document && locale !== 'en') document = await LegalDocument.findOne({ type: req.params.type.toUpperCase(), active: true, locale: 'en' }).sort({ publishedAt: -1 });
  if (!document) throw new ApiError(404, 'Legal document not found', 'LEGAL_DOCUMENT_NOT_FOUND');
  sendSuccess(res, document);
});

export const createSupportRequest = catchAsync(async (req, res) => {
  const request = await SupportRequest.create({ ...req.body, userId: req.user._id });
  for (const mediaId of request.mediaIds) {
    await claimMedia({ mediaId, ownerId: req.user._id, purpose: 'SUPPORT_ATTACHMENT', claimedByType: 'SUPPORT_REQUEST', claimedById: request._id });
  }
  await sendMail({
    to: env.SUPPORT_EMAIL,
    subject: `Support request from ${request.name}`,
    text: `${request.email}\n${request.phone || ''}\n\n${request.note}`
  });
  sendSuccess(res, request, { status: StatusCodes.CREATED });
});
