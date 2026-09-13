import argon2 from 'argon2';
import { OAuth2Client } from 'google-auth-library';
import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import User from '../models/User.js';
import { translate } from '../utils/i18n.js';
import Session from '../models/Session.js';
import Otp from '../models/Otp.js';
import Calendar from '../models/Calendar.js';
import { Subscription } from '../models/Subscription.js';
import { AccountDeletion } from '../models/Operations.js';
import { LegalAcceptance, LegalDocument } from '../models/Legal.js';
import ApiError from '../utils/ApiError.js';
import { humanCode, randomOtp, randomUuid, secureEquals, sha256 } from '../utils/crypto.js';
import { issueRefreshToken, revokeAllSessions, signAccessToken } from './token.service.js';
import { sendMail } from './mailer.service.js';

let googleClient = new OAuth2Client();
export const setGoogleClientForTests = (mockClient) => { googleClient = mockClient; };
const hashOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password) => argon2.hash(password, hashOptions);
export const verifyPassword = (hash, password) => argon2.verify(hash, password);

const uniqueContactCode = async (name = 'USR') => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = humanCode(name);
    if (!(await User.exists({ contactCode: code }))) return code;
  }
  throw new ApiError(500, 'Could not generate account code', 'CODE_GENERATION_FAILED');
};

const authPayload = async (user, context) => {
  const refresh = await issueRefreshToken(user._id, context);
  return {
    user,
    accessToken: signAccessToken(user),
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt
  };
};

export const register = async (input, context) => {
  if (await User.exists({ email: input.email })) {
    throw new ApiError(StatusCodes.CONFLICT, 'Email is already registered', 'EMAIL_IN_USE');
  }

  const terms = await LegalDocument.findOne({ type: 'TERMS', version: input.termsVersion, active: true });
  if (!terms) throw new ApiError(StatusCodes.UNPROCESSABLE_ENTITY, 'Terms version is not active', 'INVALID_TERMS_VERSION');
  const privacy = await LegalDocument.findOne({ type: 'PRIVACY', version: input.privacyVersion || input.termsVersion, active: true });
  if (!privacy) throw new ApiError(StatusCodes.UNPROCESSABLE_ENTITY, 'Privacy version is not active', 'INVALID_PRIVACY_VERSION');

  const passwordHash = await hashPassword(input.password);
  const contactCode = await uniqueContactCode(input.displayName || input.email.split('@')[0]);
  const revenueCatAppUserId = randomUuid();
  const session = await mongoose.startSession();
  let user;

  try {
    await session.withTransaction(async () => {
      [user] = await User.create([{
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        ...(input.locale && { locale: input.locale }),
        contactCode,
        revenueCatAppUserId
      }], { session });
      await Calendar.create([{ ownerId: user._id, name: `${input.displayName || 'My'} Calendar`, timeZone: input.timeZone || 'UTC' }], { session });
      await Subscription.create([{ userId: user._id, appUserId: revenueCatAppUserId }], { session });
      await LegalAcceptance.create([{ userId: user._id, documentId: terms._id, version: terms.version, ip: context.ip }], { session });
      await LegalAcceptance.create([{ userId: user._id, documentId: privacy._id, version: privacy.version, ip: context.ip }], { session });
    });
  } finally {
    await session.endSession();
  }

  return authPayload(user, context);
};

export const login = async (email, password, context, requiredRole) => {
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Email or password is incorrect', 'INVALID_CREDENTIALS');
  }
  if (requiredRole && user.role !== requiredRole) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'This account cannot access the requested application', 'ROLE_FORBIDDEN');
  }
  if (user.status === 'SUSPENDED') throw new ApiError(StatusCodes.FORBIDDEN, 'Account is suspended', 'ACCOUNT_SUSPENDED');
  if (user.status === 'PENDING_DELETION') throw new ApiError(StatusCodes.FORBIDDEN, 'Account is pending deletion', 'ACCOUNT_PENDING_DELETION');
  if (user.status !== 'ACTIVE') throw new ApiError(StatusCodes.FORBIDDEN, 'Account is unavailable', 'ACCOUNT_UNAVAILABLE');
  user.lastLoginAt = new Date();
  await user.save();
  return authPayload(user, context);
};

export const loginWithGoogle = async (input, context) => {
  if (!env.GOOGLE_CLIENT_IDS.length) throw new ApiError(503, 'Google login is not configured', 'GOOGLE_AUTH_UNAVAILABLE');
  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({ idToken: input.idToken, audience: env.GOOGLE_CLIENT_IDS });
  } catch {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Google token is invalid', 'INVALID_GOOGLE_TOKEN');
  }
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Google email is not verified', 'UNVERIFIED_GOOGLE_EMAIL');
  }

  let user = await User.findOne({ $or: [{ googleSubject: payload.sub }, { email: payload.email }] });
  if (!user) {
    if (!input.termsAccepted || !input.termsVersion) throw new ApiError(422, 'Terms acceptance is required for a new account', 'TERMS_ACCEPTANCE_REQUIRED');
    const terms = await LegalDocument.findOne({ type: 'TERMS', version: input.termsVersion, active: true });
    if (!terms) throw new ApiError(422, 'Terms version is not active', 'INVALID_TERMS_VERSION');
    const privacy = await LegalDocument.findOne({ type: 'PRIVACY', version: input.privacyVersion || input.termsVersion, active: true });
    if (!privacy) throw new ApiError(422, 'Privacy version is not active', 'INVALID_PRIVACY_VERSION');
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        [user] = await User.create([{
          email: payload.email,
          googleSubject: payload.sub,
          displayName: payload.name,
          ...(input.locale && { locale: input.locale }),
          contactCode: await uniqueContactCode(payload.name || 'USR'),
          revenueCatAppUserId: randomUuid()
        }], { session });
        await Calendar.create([{ ownerId: user._id, name: `${payload.given_name || 'My'} Calendar`, timeZone: input.timeZone }], { session });
        await Subscription.create([{ userId: user._id, appUserId: user.revenueCatAppUserId }], { session });
        await LegalAcceptance.create([{ userId: user._id, documentId: terms._id, version: terms.version, ip: context.ip }], { session });
        await LegalAcceptance.create([{ userId: user._id, documentId: privacy._id, version: privacy.version, ip: context.ip }], { session });
      });
    } finally {
      await session.endSession();
    }
  } else if (!user.googleSubject) {
    user.googleSubject = payload.sub;
    await user.save();
  }

  if (user.status !== 'ACTIVE') throw new ApiError(StatusCodes.FORBIDDEN, 'Account is unavailable', 'ACCOUNT_UNAVAILABLE');
  return authPayload(user, context);
};

export const rotateRefreshToken = async (rawToken, context) => {
  const tokenHash = sha256(rawToken);
  const oldSession = await Session.findOne({ tokenHash });
  if (!oldSession) throw new ApiError(StatusCodes.UNAUTHORIZED, 'Refresh token is invalid', 'INVALID_REFRESH_TOKEN');

  if (oldSession.revokedAt) {
    await Session.updateMany({ familyId: oldSession.familyId }, { $set: { revokedAt: new Date() } });
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Refresh token reuse detected', 'REFRESH_TOKEN_REUSE');
  }
  if (oldSession.expiresAt <= new Date()) throw new ApiError(StatusCodes.UNAUTHORIZED, 'Refresh token expired', 'REFRESH_TOKEN_EXPIRED');

  const user = await User.findById(oldSession.userId);
  if (!user || user.status !== 'ACTIVE') throw new ApiError(StatusCodes.UNAUTHORIZED, 'Account is unavailable', 'ACCOUNT_UNAVAILABLE');

  const next = await issueRefreshToken(user._id, context, oldSession.familyId);
  oldSession.revokedAt = new Date();
  oldSession.replacedByHash = next.tokenHash;
  await oldSession.save();
  return { user, accessToken: signAccessToken(user), refreshToken: next.token, refreshTokenExpiresAt: next.expiresAt };
};

export const logout = async (rawToken) => {
  if (!rawToken) return;
  await Session.updateOne({ tokenHash: sha256(rawToken), revokedAt: null }, { $set: { revokedAt: new Date() } });
};

export const requestPasswordReset = async (email) => {
  const user = await User.findOne({ email });
  if (!user) return;
  const recent = await Otp.findOne({ email, purpose: 'PASSWORD_RESET' }).sort({ createdAt: -1 });
  if (recent && Date.now() - recent.createdAt.getTime() < 60_000) {
    throw new ApiError(StatusCodes.TOO_MANY_REQUESTS, 'Please wait before requesting another code', 'OTP_COOLDOWN');
  }
  const code = randomOtp();
  await Otp.create({ email, purpose: 'PASSWORD_RESET', codeHash: sha256(code), expiresAt: new Date(Date.now() + 10 * 60_000) });
  await sendMail({
    to: email,
    subject: translate(user.locale, '{app} password reset code', { app: env.APP_NAME }),
    text: translate(user.locale, 'Your password reset code is {code}. It expires in 10 minutes.', { code })
  });
};

export const verifyResetOtp = async (email, code) => {
  const otp = await Otp.findOne({ email, purpose: 'PASSWORD_RESET', verifiedAt: null }).sort({ createdAt: -1 });
  if (!otp || otp.expiresAt <= new Date()) throw new ApiError(400, 'Code is invalid or expired', 'INVALID_OTP');
  if (otp.attempts >= 5) throw new ApiError(StatusCodes.TOO_MANY_REQUESTS, 'Too many attempts', 'OTP_ATTEMPTS_EXCEEDED');
  otp.attempts += 1;
  if (!secureEquals(otp.codeHash, sha256(code))) {
    await otp.save();
    throw new ApiError(400, 'Code is invalid or expired', 'INVALID_OTP');
  }
  otp.verifiedAt = new Date();
  await otp.save();
  return { resetToken: jwtResetToken(otp) };
};

const jwtResetToken = (otp) => {
  const payload = `${otp._id}:${otp.email}:${otp.verifiedAt.getTime()}`;
  return `${otp._id}.${sha256(`${payload}:${env.JWT_REFRESH_SECRET}`)}`;
};

export const resetPassword = async (resetToken, password) => {
  const [id, signature] = resetToken.split('.');
  const otp = await Otp.findById(id);
  if (!otp?.verifiedAt || otp.expiresAt <= new Date()) throw new ApiError(400, 'Reset token is invalid or expired', 'INVALID_RESET_TOKEN');
  if (!secureEquals(jwtResetToken(otp).split('.')[1], signature || '')) throw new ApiError(400, 'Reset token is invalid', 'INVALID_RESET_TOKEN');
  const user = await User.findOne({ email: otp.email }).select('+passwordHash');
  if (!user) throw new ApiError(404, 'Account not found', 'USER_NOT_FOUND');
  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  await user.save();
  await Promise.all([revokeAllSessions(user._id), Otp.deleteMany({ email: otp.email, purpose: 'PASSWORD_RESET' })]);
};

export const cancelDeletionWithCredentials = async (email, password, context) => {
  const user = await User.findOne({ email, status: 'PENDING_DELETION' }).select('+passwordHash');
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
    throw new ApiError(401, 'Email or password is incorrect', 'INVALID_CREDENTIALS');
  }
  const deletion = await AccountDeletion.findOne({ userId: user._id, cancelledAt: null, purgedAt: null });
  if (!deletion || deletion.purgeAt <= new Date()) throw new ApiError(410, 'Deletion recovery period has expired', 'DELETION_RECOVERY_EXPIRED');
  deletion.cancelledAt = new Date();
  user.status = 'ACTIVE';
  await Promise.all([deletion.save(), user.save()]);
  return authPayload(user, context);
};
