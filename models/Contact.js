import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema({
  lowUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  highUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  lowUserRelation: { type: String, maxlength: 80 },
  highUserRelation: { type: String, maxlength: 80 }
}, { timestamps: true });

contactSchema.index({ lowUserId: 1, highUserId: 1 }, { unique: true });
export default mongoose.model('Contact', contactSchema);

