import { StatusCodes } from 'http-status-codes';
import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import { requestLocale, translate } from '../utils/i18n.js';
import * as authService from '../services/auth.service.js';
import { audit } from '../services/audit.service.js';

const context = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

export const register = catchAsync(async (req, res) => {
  const data = await authService.register(req.body, context(req));
  await audit({ req, actorId: data.user._id, action: 'USER_REGISTERED', targetType: 'User', targetId: data.user._id });
  sendSuccess(res, data, { status: StatusCodes.CREATED });
});

export const login = catchAsync(async (req, res) => {
  const data = await authService.login(req.body.email, req.body.password, context(req));
  await audit({ req, actorId: data.user._id, action: 'USER_LOGGED_IN', targetType: 'User', targetId: data.user._id });
  sendSuccess(res, data);
});

export const adminLogin = catchAsync(async (req, res) => {
  const data = await authService.login(req.body.email, req.body.password, context(req), 'ADMIN');
  await audit({ req, actorId: data.user._id, action: 'ADMIN_LOGGED_IN', targetType: 'User', targetId: data.user._id });
  sendSuccess(res, data);
});

export const googleLogin = catchAsync(async (req, res) => sendSuccess(res, await authService.loginWithGoogle(req.body, context(req))));
export const refresh = catchAsync(async (req, res) => sendSuccess(res, await authService.rotateRefreshToken(req.body.refreshToken, context(req))));
export const logout = catchAsync(async (req, res) => {
  await authService.logout(req.body.refreshToken);
  sendSuccess(res, { loggedOut: true });
});
export const forgotPassword = catchAsync(async (req, res) => {
  await authService.requestPasswordReset(req.body.email);
  sendSuccess(res, { message: translate(requestLocale(req), 'If the account exists, a reset code has been sent') });
});
export const verifyOtp = catchAsync(async (req, res) => sendSuccess(res, await authService.verifyResetOtp(req.body.email, req.body.code)));
export const resetPassword = catchAsync(async (req, res) => {
  await authService.resetPassword(req.body.resetToken, req.body.password);
  sendSuccess(res, { passwordReset: true });
});
export const cancelDeletion = catchAsync(async (req, res) => sendSuccess(res, await authService.cancelDeletionWithCredentials(req.body.email, req.body.password, context(req))));
