import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Conversation, PendingAiAction } from '../models/Ai.js';
import User from '../models/User.js';
import { hasPremiumAccess } from '../utils/premium.js';

const DAY = 86400000;
export const historyRetentionDays = (user, now = new Date()) => hasPremiumAccess(user, now)
  ? env.CHAT_RETENTION_DAYS_PREMIUM : env.CHAT_RETENTION_DAYS_FREE;

export const conversationExpiry = (conversation, days) => conversation.savedAt
  ? null : new Date(new Date(conversation.updatedAt).getTime() + days * DAY);

// Walk every batch, including ineligible Pro chats, so they cannot block older
// Free history from being reclaimed. Also purge legacy soft-deleted records.
export const expireConversations = async ({ now = new Date(), batchSize = 500 } = {}) => {
  const widestCutoff = new Date(+now - Math.min(env.CHAT_RETENTION_DAYS_FREE, env.CHAT_RETENTION_DAYS_PREMIUM) * DAY);
  let after;
  let deleted = 0;
  while (true) {
    const candidates = await Conversation.find({
      ...(after && { _id: { $gt: after } }),
      $or: [
        { deletedAt: { $ne: null } },
        { savedAt: null, updatedAt: { $lte: widestCutoff } }
      ]
    }).select('_id userId updatedAt deletedAt').sort({ _id: 1 }).limit(batchSize).lean();
    if (!candidates.length) break;
    after = candidates.at(-1)._id;
    const owners = await User.find({ _id: { $in: candidates.map((item) => item.userId) } }).select('plan premiumUntil').lean();
    const daysByOwner = new Map(owners.map((owner) => [owner._id.toString(), historyRetentionDays(owner, now)]));
    const due = candidates.filter((item) => item.deletedAt || +item.updatedAt <= +now - (daysByOwner.get(item.userId.toString()) ?? env.CHAT_RETENTION_DAYS_FREE) * DAY);
    if (!due.length) continue;
    const count = await mongoose.connection.transaction(async (session) => {
      // A chat saved or updated since the scan must survive this sweep.
      const current = await Conversation.find({
        _id: { $in: due.map((item) => item._id) },
        $or: [
          { deletedAt: { $ne: null } },
          { deletedAt: null, savedAt: null, $or: due.map((item) => ({ _id: item._id, updatedAt: item.updatedAt })) }
        ]
      }).select('_id').session(session).lean();
      const ids = current.map((item) => item._id);
      await PendingAiAction.deleteMany({ conversationId: { $in: ids } }).session(session);
      const result = await Conversation.deleteMany({ _id: { $in: ids } }).session(session);
      return result.deletedCount;
    });
    deleted += count;
  }
  return { deleted };
};
