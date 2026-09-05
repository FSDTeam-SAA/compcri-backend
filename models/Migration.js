import mongoose from 'mongoose';

const migrationSchema = new mongoose.Schema({
  version: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  appliedAt: { type: Date, default: Date.now }
}, { versionKey: false });

export default mongoose.model('Migration', migrationSchema);
