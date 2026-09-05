import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import * as service from '../services/delegation.service.js';
import { audit } from '../services/audit.service.js';

export const lookup = catchAsync(async (req, res) => sendSuccess(res, await service.lookupAssistant(req.user._id, req.body.email)));
export const create = catchAsync(async (req, res) => {
  const item = await service.createDelegation(req.user._id, req.body);
  await audit({ req, action: 'DELEGATION_CREATED', targetType: 'Delegation', targetId: item._id, metadata: { preset: item.preset } });
  sendSuccess(res, item, { status: 201 });
});
export const list = catchAsync(async (req, res) => sendSuccess(res, await service.listDelegations(req.user._id)));
export const get = catchAsync(async (req, res) => sendSuccess(res, await service.getDelegation(req.user._id, req.params.id)));
export const update = catchAsync(async (req, res) => sendSuccess(res, await service.updateDelegation(req.user._id, req.params.id, req.body.preset)));
export const remove = catchAsync(async (req, res) => {
  const item = await service.revokeDelegation(req.user._id, req.params.id);
  await audit({ req, action: 'DELEGATION_REVOKED', targetType: 'Delegation', targetId: item._id });
  sendSuccess(res, { revoked: true });
});

