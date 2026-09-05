import mongoose from 'mongoose';
import { AI_ACTION_TYPES } from '../constants/enums.js';

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['USER', 'ASSISTANT'], required: true },
  content: { type: String, required: true, maxlength: 20000 },
  supersededAt: Date,
  providerMetadata: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});

const conversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  calendarId: { type: mongoose.Schema.Types.ObjectId, ref: 'Calendar', required: true, index: true },
  title: { type: String, default: 'New chat', maxlength: 160 },
  messages: [messageSchema],
  deletedAt: Date
}, { timestamps: true });
conversationSchema.index({ userId: 1, deletedAt: 1, updatedAt: -1 });

const pendingAiActionSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  requestedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  calendarId: { type: mongoose.Schema.Types.ObjectId, ref: 'Calendar', required: true },
  type: { type: String, enum: AI_ACTION_TYPES, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  eventVersion: Number,
  conflictWarnings: [mongoose.Schema.Types.Mixed],
  status: { type: String, enum: ['PENDING', 'EXECUTING', 'CONFIRMED', 'REJECTED', 'EXPIRED'], default: 'PENDING' },
  expiresAt: { type: Date, required: true, index: { expires: 86400 } },
  executedAt: Date,
  result: mongoose.Schema.Types.Mixed
}, { timestamps: true });

const aiUsageSchema = new mongoose.Schema({
  calendarId: { type: mongoose.Schema.Types.ObjectId, ref: 'Calendar', required: true },
  day: { type: String, required: true },
  requestCount: { type: Number, default: 0 },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  failures: { type: Number, default: 0 },
  lastLatencyMs: Number,
  provider: { type: String, enum: ['gemini', 'openai'] },
  model: String
}, { timestamps: true });
aiUsageSchema.index({ calendarId: 1, day: 1 }, { unique: true });

const aiProviderUsageSchema = new mongoose.Schema({
  calendarId: { type: mongoose.Schema.Types.ObjectId, ref: 'Calendar', required: true },
  day: { type: String, required: true },
  provider: { type: String, enum: ['gemini', 'openai'], required: true },
  model: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  successes: { type: Number, default: 0 },
  failures: { type: Number, default: 0 },
  fallbackAttempts: { type: Number, default: 0 },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  reasoningTokens: { type: Number, default: 0 },
  cachedInputTokens: { type: Number, default: 0 },
  totalLatencyMs: { type: Number, default: 0 }
}, { timestamps: true });
aiProviderUsageSchema.index({ calendarId: 1, day: 1, provider: 1, model: 1 }, { unique: true });

export const Conversation = mongoose.model('Conversation', conversationSchema);
export const PendingAiAction = mongoose.model('PendingAiAction', pendingAiActionSchema);
export const AiUsage = mongoose.model('AiUsage', aiUsageSchema);
export const AiProviderUsage = mongoose.model('AiProviderUsage', aiProviderUsageSchema);
