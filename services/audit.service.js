import { AuditLog } from '../models/Operations.js';

export const audit = ({ req, actorId, action, targetType, targetId, metadata }) => AuditLog.create({
  actorId: actorId || req?.user?._id,
  action,
  targetType,
  targetId,
  metadata,
  ip: req?.ip,
  requestId: req?.id
});

