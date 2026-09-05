import { sha256 } from '../utils/crypto.js';
import User from '../models/User.js';
import Session from '../models/Session.js';
import Otp from '../models/Otp.js';
import Calendar from '../models/Calendar.js';
import Event from '../models/Event.js';
import Delegation from '../models/Delegation.js';
import Contact from '../models/Contact.js';
import ContactRequest from '../models/ContactRequest.js';
import Group from '../models/Group.js';
import GroupInvitation from '../models/GroupInvitation.js';
import { EventResponse, EventShare } from '../models/EventShare.js';
import Notification from '../models/Notification.js';
import Device from '../models/Device.js';
import MediaAsset from '../models/MediaAsset.js';
import { Conversation, PendingAiAction, AiProviderUsage, AiUsage } from '../models/Ai.js';
import { LegalAcceptance } from '../models/Legal.js';
import { AccountDeletion, AuditLog, SupportRequest } from '../models/Operations.js';
import { RevenueCatEvent, Subscription } from '../models/Subscription.js';
import { deleteMediaAsset } from './media.service.js';
import { deleteRevenueCatCustomer } from './revenuecat.service.js';

export const purgeAccount = async (userId) => {
  const deletion = await AccountDeletion.findOne({ userId, cancelledAt: null, purgedAt: null });
  if (!deletion || deletion.purgeAt > new Date()) return false;
  const user = await User.findById(userId);
  if (!user) return false;

  const ownedCalendar = await Calendar.findOne({ ownerId: userId });
  const ownedGroups = await Group.find({ ownerId: userId, status: 'ACTIVE' });
  for (const group of ownedGroups) {
    const successor = group.members
      .filter((member) => member.userId.toString() !== userId.toString())
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (successor) {
      successor.role = 'OWNER';
      group.ownerId = successor.userId;
      group.members = group.members.filter((member) => member.userId.toString() !== userId.toString());
    } else {
      group.status = 'DELETED';
      group.members = [];
    }
    await group.save();
  }
  await Group.updateMany({ 'members.userId': userId, ownerId: { $ne: userId } }, { $pull: { members: { userId } } });

  const media = await MediaAsset.find({ ownerId: userId });
  for (const asset of media) await deleteMediaAsset(userId, asset._id, { allowClaimed: true }).catch(() => undefined);

  if (ownedCalendar) {
    await EventShare.deleteMany({ eventId: { $in: await Event.find({ calendarId: ownedCalendar._id }).distinct('_id') } });
    await EventResponse.deleteMany({ eventId: { $in: await Event.find({ calendarId: ownedCalendar._id }).distinct('_id') } });
    await Event.deleteMany({ calendarId: ownedCalendar._id });
    await Calendar.deleteOne({ _id: ownedCalendar._id });
  }
  await Promise.all([
    Session.deleteMany({ userId }),
    Otp.deleteMany({ email: user.email }),
    Delegation.deleteMany({ $or: [{ ownerId: userId }, { delegateId: userId }] }),
    Contact.deleteMany({ $or: [{ lowUserId: userId }, { highUserId: userId }] }),
    ContactRequest.deleteMany({ $or: [{ senderId: userId }, { receiverId: userId }] }),
    GroupInvitation.deleteMany({ $or: [{ inviterId: userId }, { recipientId: userId }] }),
    EventShare.deleteMany({ $or: [{ targetType: 'USER', targetId: userId }, { sharedById: userId }] }),
    EventResponse.deleteMany({ userId }),
    Notification.deleteMany({ userId }),
    Device.deleteMany({ userId }),
    Conversation.deleteMany({ userId }),
    PendingAiAction.deleteMany({ requestedById: userId }),
    ownedCalendar ? AiUsage.deleteMany({ calendarId: ownedCalendar._id }) : Promise.resolve(),
    ownedCalendar ? AiProviderUsage.deleteMany({ calendarId: ownedCalendar._id }) : Promise.resolve(),
    LegalAcceptance.deleteMany({ userId }),
    SupportRequest.updateMany({ userId }, { $unset: { userId: 1 }, $set: { name: 'Deleted user', email: 'deleted@compcri.invalid', phone: null } }),
    AuditLog.updateMany({ actorId: userId }, { $unset: { actorId: 1 }, $set: { metadata: { anonymizedActor: sha256(userId.toString()) } } })
  ]);
  await AuditLog.updateMany({ targetType: 'User', targetId: userId }, { $unset: { targetId: 1 } });

  await deleteRevenueCatCustomer(user.revenueCatAppUserId).catch(() => undefined);
  await RevenueCatEvent.updateMany({ appUserId: user.revenueCatAppUserId }, { $set: { appUserId: `deleted:${sha256(user.revenueCatAppUserId)}`, 'payload.event.app_user_id': '[DELETED]' } });
  await Subscription.deleteOne({ userId });
  deletion.purgedAt = new Date();
  await deletion.save();
  await User.deleteOne({ _id: userId });
  return true;
};
