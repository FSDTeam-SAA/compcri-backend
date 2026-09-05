import mongoose from 'mongoose';

const supportRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  name: { type: String, required: true, maxlength: 100 },
  email: { type: String, required: true, lowercase: true },
  phone: { type: String, maxlength: 40 },
  note: { type: String, required: true, maxlength: 5000 },
  mediaIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' }],
  status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' }
}, { timestamps: true });

const auditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  action: { type: String, required: true, index: true },
  targetType: String,
  targetId: mongoose.Schema.Types.ObjectId,
  metadata: mongoose.Schema.Types.Mixed,
  ip: String,
  requestId: String
}, { timestamps: true });
auditLogSchema.index({ createdAt: -1 });

const accountDeletionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  reason: { type: String, required: true, maxlength: 300 },
  requestedAt: { type: Date, default: Date.now },
  purgeAt: { type: Date, required: true, index: true },
  cancelledAt: Date,
  purgedAt: Date
}, { timestamps: true });

export const SupportRequest = mongoose.model('SupportRequest', supportRequestSchema);
export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export const AccountDeletion = mongoose.model('AccountDeletion', accountDeletionSchema);

