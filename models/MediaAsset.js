import mongoose from 'mongoose';

const mediaAssetSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  purpose: { type: String, enum: ['AVATAR', 'EVENT_POSTER', 'SUPPORT_ATTACHMENT'], required: true },
  publicId: { type: String, required: true, unique: true },
  secureUrl: { type: String, required: true },
  format: String,
  bytes: Number,
  width: Number,
  height: Number,
  claimedByType: { type: String, enum: ['USER', 'EVENT', 'SUPPORT_REQUEST'] },
  claimedById: mongoose.Schema.Types.ObjectId,
  claimedAt: Date
}, { timestamps: true });

mediaAssetSchema.index({ ownerId: 1, createdAt: -1 });
export default mongoose.model('MediaAsset', mediaAssetSchema);

