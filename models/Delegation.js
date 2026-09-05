import mongoose from 'mongoose';
import { DELEGATION_PRESETS } from '../constants/enums.js';

const delegationSchema = new mongoose.Schema({
  calendarId: { type: mongoose.Schema.Types.ObjectId, ref: 'Calendar', required: true, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  delegateId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  preset: { type: String, enum: DELEGATION_PRESETS, required: true },
  status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE', index: true },
  revokedAt: Date
}, { timestamps: true });

delegationSchema.index({ calendarId: 1, delegateId: 1 }, { unique: true });
export default mongoose.model('Delegation', delegationSchema);

