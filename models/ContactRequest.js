import mongoose from 'mongoose';

const contactRequestSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  senderRelation: { type: String, maxlength: 80 },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'], default: 'PENDING', index: true },
  respondedAt: Date
}, { timestamps: true });

contactRequestSchema.index({ senderId: 1, receiverId: 1, status: 1 });
export default mongoose.model('ContactRequest', contactRequestSchema);

