import mongoose from 'mongoose';

const legalDocumentSchema = new mongoose.Schema({
  type: { type: String, enum: ['TERMS', 'PRIVACY'], required: true },
  version: { type: String, required: true },
  locale: { type: String, enum: ['en', 'pt', 'es'], default: 'en' },
  title: { type: String, required: true },
  content: { type: String, required: true },
  publishedAt: { type: Date, default: Date.now },
  active: { type: Boolean, default: true }
}, { timestamps: true });
legalDocumentSchema.index({ type: 1, version: 1, locale: 1 }, { unique: true });

const legalAcceptanceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'LegalDocument', required: true },
  version: { type: String, required: true },
  ip: String,
  acceptedAt: { type: Date, default: Date.now }
}, { timestamps: true });
legalAcceptanceSchema.index({ userId: 1, documentId: 1 }, { unique: true });

export const LegalDocument = mongoose.model('LegalDocument', legalDocumentSchema);
export const LegalAcceptance = mongoose.model('LegalAcceptance', legalAcceptanceSchema);

