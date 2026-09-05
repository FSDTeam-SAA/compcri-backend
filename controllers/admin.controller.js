import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import * as service from '../services/admin.service.js';
import * as userService from '../services/user.service.js';
import { audit } from '../services/audit.service.js';

export const dashboard = catchAsync(async (req, res) => sendSuccess(res, await service.dashboard(req.query.period)));
export const users = catchAsync(async (req, res) => {
  const result = await service.listUsers(req.query);
  sendSuccess(res, result.items, { meta: result.meta });
});
export const user = catchAsync(async (req, res) => sendSuccess(res, await service.getUser(req.params.id)));
export const userStatus = catchAsync(async (req, res) => {
  const user = await service.changeUserStatus(req.user._id, req.params.id, req.body.action);
  await audit({ req, action: `ADMIN_USER_${req.body.action}`, targetType: 'User', targetId: user._id });
  sendSuccess(res, user);
});
export const deleteUser = catchAsync(async (req, res) => {
  const deletion = await service.scheduleUserDeletion(req.params.id, req.body.reason);
  await audit({ req, action: 'ADMIN_USER_DELETION_SCHEDULED', targetType: 'User', targetId: req.params.id, metadata: { purgeAt: deletion.purgeAt } });
  sendSuccess(res, deletion);
});
export const subscriptions = catchAsync(async (req, res) => sendSuccess(res, await service.subscriptionAnalytics(req.query.period)));
export const audits = catchAsync(async (req, res) => {
  const result = await service.listAuditLogs(req.query);
  sendSuccess(res, result.items, { meta: result.meta });
});
export const profile = catchAsync(async (req, res) => sendSuccess(res, await userService.getMe(req.user._id)));
export const updateProfile = catchAsync(async (req, res) => sendSuccess(res, await userService.updateMe(req.user._id, req.body)));
export const password = catchAsync(async (req, res) => {
  await userService.changePassword(req.user._id, req.body.currentPassword, req.body.newPassword);
  sendSuccess(res, { passwordChanged: true, sessionsRevoked: true });
});

