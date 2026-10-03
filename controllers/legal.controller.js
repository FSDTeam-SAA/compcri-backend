import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import { LegalDocument } from '../models/Legal.js';
import { SupportRequest } from '../models/Operations.js';
import { sendMail } from '../services/mailer.service.js';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { claimMedia } from '../services/media.service.js';
import MediaAsset from '../models/MediaAsset.js';

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

/// Stores the request and emails it to support, subject and screenshots
/// included. It succeeds only once support has it: if any step fails the
/// request is withdrawn and its screenshots released, so the app can keep
/// what the user wrote and simply send it again.
export const createSupportRequest = catchAsync(async (req, res) => {
  const request = await SupportRequest.create({ ...req.body, userId: req.user._id });
  try {
    const attachments = [];
    for (const mediaId of request.mediaIds) {
      attachments.push(await claimMedia({ mediaId, ownerId: req.user._id, purpose: 'SUPPORT_ATTACHMENT', claimedByType: 'SUPPORT_REQUEST', claimedById: request._id }));
    }
    const subject = request.subject || request.note.split('\n')[0].slice(0, 80);
    await sendMail({
      to: env.SUPPORT_EMAIL,
      subject: `[Support] ${subject} — ${request.name}`,
      text: [
        `Subject: ${subject}`,
        `From: ${request.name} <${request.email}>`,
        ...(request.phone ? [`Phone: ${request.phone}`] : []),
        `Request: ${request._id}`,
        '',
        request.note,
        ...(attachments.length ? ['', 'Screenshots:', ...attachments.map((asset) => asset.secureUrl)] : [])
      ].join('\n')
    });
  } catch (error) {
    await MediaAsset.updateMany({ claimedById: request._id }, { $unset: { claimedByType: 1, claimedById: 1, claimedAt: 1 } });
    await SupportRequest.deleteOne({ _id: request._id });
    throw error;
  }
  sendSuccess(res, request, { status: StatusCodes.CREATED });
});
