import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import { requestLocale, translate } from '../utils/i18n.js';
import * as userService from '../services/user.service.js';
import { audit } from '../services/audit.service.js';

export const getMe = catchAsync(async (req, res) => sendSuccess(res, await userService.getMe(req.user._id)));
export const updateMe = catchAsync(async (req, res) => {
  const user = await userService.updateMe(req.user._id, req.body);
  await audit({ req, action: 'PROFILE_UPDATED', targetType: 'User', targetId: req.user._id });
  sendSuccess(res, user);
});
export const changePassword = catchAsync(async (req, res) => {
  await userService.changePassword(req.user._id, req.body.currentPassword, req.body.newPassword);
  await audit({ req, action: 'PASSWORD_CHANGED', targetType: 'User', targetId: req.user._id });
  sendSuccess(res, { passwordChanged: true, sessionsRevoked: true });
});
export const preferences = catchAsync(async (req, res) => sendSuccess(res, await userService.updateNotificationPreferences(req.user._id, req.body)));
export const calendars = catchAsync(async (req, res) => sendSuccess(res, await userService.accessibleCalendars(req.user._id)));
export const subscriptionManagement = catchAsync(async (req, res) => sendSuccess(res, await userService.subscriptionManagement(req.user._id)));
export const requestDeletion = catchAsync(async (req, res) => {
  const deletion = await userService.requestDeletion(req.user._id, req.body.password, req.body.reason);
  await audit({ req, action: 'ACCOUNT_DELETION_REQUESTED', targetType: 'User', targetId: req.user._id, metadata: { purgeAt: deletion.deletion.purgeAt } });
  sendSuccess(res, {
    purgeAt: deletion.deletion.purgeAt,
    recoverableUntil: deletion.deletion.purgeAt,
    managementUrl: deletion.managementUrl,
    billingManagedSeparately: true,
    message: translate(requestLocale(req), 'Deleting the account does not cancel an App Store or Play Store subscription.')
  });
});
