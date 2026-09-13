import mongoose from 'mongoose';
import { StatusCodes } from 'http-status-codes';
import User from '../models/User.js';
import Contact from '../models/Contact.js';
import ContactRequest from '../models/ContactRequest.js';
import Group from '../models/Group.js';
import GroupInvitation from '../models/GroupInvitation.js';
import Calendar from '../models/Calendar.js';
import Event from '../models/Event.js';
import { EventShare } from '../models/EventShare.js';
import ApiError from '../utils/ApiError.js';
import { humanCode } from '../utils/crypto.js';
import { createNotification } from './notification.service.js';
import * as eventService from './event.service.js';
import { escapeRegex } from '../utils/regex.js';

const orderedPair = (a, b) => a.toString() < b.toString() ? [a, b] : [b, a];

export const listContacts = async (userId, search) => {
  const relationships = await Contact.find({ $or: [{ lowUserId: userId }, { highUserId: userId }] });
  const otherIds = relationships.map((item) => item.lowUserId.toString() === userId.toString() ? item.highUserId : item.lowUserId);
  const filter = { _id: { $in: otherIds }, status: 'ACTIVE' };
  if (search) filter.$or = [{ displayName: { $regex: escapeRegex(search), $options: 'i' } }, { email: { $regex: escapeRegex(search), $options: 'i' } }];
  const users = await User.find(filter).select('displayName email phone profession country city avatarMediaId contactCode').populate('avatarMediaId');
  const relationMap = new Map(relationships.map((item) => {
    const low = item.lowUserId.toString() === userId.toString();
    return [(low ? item.highUserId : item.lowUserId).toString(), low ? item.lowUserRelation : item.highUserRelation];
  }));
  return users.map((user) => ({ user, relation: relationMap.get(user._id.toString()) || null }));
};

export const sendContactRequest = async (senderId, contactCode, relation) => {
  const receiver = await User.findOne({ contactCode, status: 'ACTIVE' });
  if (!receiver) throw new ApiError(404, 'Contact code not found', 'CONTACT_CODE_NOT_FOUND');
  if (receiver._id.toString() === senderId.toString()) throw new ApiError(400, 'You cannot add yourself', 'SELF_CONTACT_FORBIDDEN');
  const [lowUserId, highUserId] = orderedPair(senderId, receiver._id);
  if (await Contact.exists({ lowUserId, highUserId })) throw new ApiError(409, 'User is already a contact', 'CONTACT_EXISTS');
  const existing = await ContactRequest.findOne({
    $or: [{ senderId, receiverId: receiver._id }, { senderId: receiver._id, receiverId: senderId }],
    status: 'PENDING'
  });
  if (existing) throw new ApiError(409, 'A contact request is already pending', 'CONTACT_REQUEST_EXISTS');
  const request = await ContactRequest.create({ senderId, receiverId: receiver._id, senderRelation: relation });
  await createNotification(receiver._id, 'CONTACT_REQUEST', 'New contact request', 'Someone wants to add you as a contact', { requestId: request._id });
  return request;
};

export const listContactRequests = (userId, direction = 'incoming') => ContactRequest.find({
  [direction === 'outgoing' ? 'senderId' : 'receiverId']: userId,
  status: 'PENDING'
}).populate('senderId receiverId', 'displayName email avatarMediaId contactCode');

export const respondContactRequest = async (userId, requestId, action, relation) => {
  const request = await ContactRequest.findOne({ _id: requestId, receiverId: userId, status: 'PENDING' });
  if (!request) throw new ApiError(404, 'Contact request not found', 'CONTACT_REQUEST_NOT_FOUND');
  request.status = action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
  request.respondedAt = new Date();
  if (action === 'ACCEPT') {
    const [lowUserId, highUserId] = orderedPair(request.senderId, request.receiverId);
    const senderIsLow = request.senderId.toString() === lowUserId.toString();
    await Contact.create({
      lowUserId,
      highUserId,
      [senderIsLow ? 'lowUserRelation' : 'highUserRelation']: request.senderRelation,
      [senderIsLow ? 'highUserRelation' : 'lowUserRelation']: relation
    });
  }
  await request.save();
  return request;
};

export const removeContact = async (userId, otherId) => {
  const [lowUserId, highUserId] = orderedPair(userId, otherId);
  const result = await Contact.deleteOne({ lowUserId, highUserId });
  if (!result.deletedCount) throw new ApiError(404, 'Contact not found', 'CONTACT_NOT_FOUND');
};

export const updateContactRelation = async (userId, otherId, relation) => {
  const [lowUserId, highUserId] = orderedPair(userId, otherId);
  const field = lowUserId.toString() === userId.toString() ? 'lowUserRelation' : 'highUserRelation';
  const contact = await Contact.findOneAndUpdate(
    { lowUserId, highUserId },
    { $set: { [field]: relation || null } },
    { returnDocument: 'after', runValidators: true }
  );
  if (!contact) throw new ApiError(404, 'Contact not found', 'CONTACT_NOT_FOUND');
  return contact;
};

export const listContactEvents = async (userId, otherId, from, to) => {
  const [lowUserId, highUserId] = orderedPair(userId, otherId);
  if (!(await Contact.exists({ lowUserId, highUserId }))) throw new ApiError(404, 'Contact not found', 'CONTACT_NOT_FOUND');
  const rangeStart = new Date(from);
  const rangeEnd = new Date(to);
  const shares = await EventShare.find({
    targetType: 'USER',
    status: 'ACTIVE',
    $or: [{ targetId: userId }, { targetId: otherId }]
  }).select('eventId');
  const events = await Event.find({
    _id: { $in: shares.map((share) => share.eventId) },
    createdById: { $in: [userId, otherId] },
    status: 'ACTIVE',
    $or: [
      { recurrenceRrule: { $exists: true, $nin: [null, ''] }, startsAt: { $lt: rangeEnd } },
      { recurrenceRrule: { $in: [null, ''] }, startsAt: { $lt: rangeEnd }, endsAt: { $gt: rangeStart } },
      { recurrenceRrule: { $exists: false }, startsAt: { $lt: rangeEnd }, endsAt: { $gt: rangeStart } }
    ]
  });
  return events.flatMap((event) => eventService.expandEvent(event, rangeStart, rangeEnd)).sort((a, b) => a.occurrenceStartAt - b.occurrenceStartAt);
};

const uniqueGroupCode = async (name) => {
  for (let i = 0; i < 10; i += 1) {
    const code = humanCode(name);
    if (!(await Group.exists({ code }))) return code;
  }
  throw new ApiError(500, 'Could not generate group code', 'CODE_GENERATION_FAILED');
};

export const createGroup = async (userId, name) => Group.create({ name, code: await uniqueGroupCode(name), ownerId: userId, members: [{ userId, role: 'OWNER' }] });
export const listGroups = (userId) => Group.find({ 'members.userId': userId, status: 'ACTIVE' }).sort({ updatedAt: -1 });

export const getGroup = async (userId, groupId) => {
  const group = await Group.findOne({ _id: groupId, 'members.userId': userId, status: 'ACTIVE' }).populate('members.userId', 'displayName email avatarMediaId');
  if (!group) throw new ApiError(404, 'Group not found', 'GROUP_NOT_FOUND');
  return group;
};

export const joinGroup = async (userId, code) => {
  const group = await Group.findOne({ code, status: 'ACTIVE' });
  if (!group) throw new ApiError(404, 'Group invite code not found', 'GROUP_CODE_NOT_FOUND');
  if (group.members.some((member) => member.userId.toString() === userId.toString())) throw new ApiError(409, 'You are already in this group', 'GROUP_MEMBER_EXISTS');
  group.members.push({ userId, role: 'MEMBER' });
  await group.save();
  await createNotification(group.ownerId, 'GROUP_UPDATE', 'Group member joined', 'A new member joined your group', { groupId: group._id });
  return group;
};

const assertGroupAdmin = (group, userId) => {
  const member = group.members.find((item) => item.userId.toString() === userId.toString());
  if (!member || !['OWNER', 'ADMIN'].includes(member.role)) throw new ApiError(StatusCodes.FORBIDDEN, 'Group administrator access required', 'GROUP_ADMIN_REQUIRED');
  return member;
};

export const addGroupMember = async (actorId, groupId, userId, role) => {
  const group = await Group.findOne({ _id: groupId, status: 'ACTIVE' });
  if (!group) throw new ApiError(404, 'Group not found', 'GROUP_NOT_FOUND');
  assertGroupAdmin(group, actorId);
  if (!(await User.exists({ _id: userId, status: 'ACTIVE' }))) throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');
  if (group.members.some((member) => member.userId.toString() === userId.toString())) throw new ApiError(409, 'User is already a member', 'GROUP_MEMBER_EXISTS');
  group.members.push({ userId, role });
  await group.save();
  await createNotification(userId, 'GROUP_UPDATE', 'Added to a group', 'You were added to {group}', { groupId }, { group: group.name });
  return group;
};

export const updateGroupMember = async (actorId, groupId, memberId, role) => {
  const group = await Group.findOne({ _id: groupId, status: 'ACTIVE' });
  if (!group) throw new ApiError(404, 'Group not found', 'GROUP_NOT_FOUND');
  const actor = assertGroupAdmin(group, actorId);
  const member = group.members.find((item) => item.userId.toString() === memberId.toString());
  if (!member) throw new ApiError(404, 'Group member not found', 'GROUP_MEMBER_NOT_FOUND');
  if (member.role === 'OWNER' || (actor.role !== 'OWNER' && member.role === 'ADMIN')) throw new ApiError(403, 'Member role cannot be changed', 'GROUP_ROLE_FORBIDDEN');
  member.role = role;
  await group.save();
  return group;
};

export const removeGroupMember = async (actorId, groupId, memberId) => {
  const group = await Group.findOne({ _id: groupId, status: 'ACTIVE' });
  if (!group) throw new ApiError(404, 'Group not found', 'GROUP_NOT_FOUND');
  const actor = assertGroupAdmin(group, actorId);
  const member = group.members.find((item) => item.userId.toString() === memberId.toString());
  if (!member) throw new ApiError(404, 'Group member not found', 'GROUP_MEMBER_NOT_FOUND');
  if (member.role === 'OWNER' || (actor.role !== 'OWNER' && member.role === 'ADMIN')) throw new ApiError(403, 'Member cannot be removed', 'GROUP_MEMBER_REMOVE_FORBIDDEN');
  group.members = group.members.filter((item) => item.userId.toString() !== memberId.toString());
  await group.save();
  return group;
};

export const leaveGroup = async (userId, groupId) => {
  const group = await Group.findOne({ _id: groupId, 'members.userId': userId, status: 'ACTIVE' });
  if (!group) throw new ApiError(404, 'Group not found', 'GROUP_NOT_FOUND');
  const member = group.members.find((item) => item.userId.toString() === userId.toString());
  if (member.role === 'OWNER') throw new ApiError(409, 'Transfer ownership or delete the group before leaving', 'GROUP_OWNER_CANNOT_LEAVE');
  group.members = group.members.filter((item) => item.userId.toString() !== userId.toString());
  await group.save();
};

export const deleteGroup = async (userId, groupId) => {
  const group = await Group.findOne({ _id: groupId, ownerId: userId, status: 'ACTIVE' });
  if (!group) throw new ApiError(404, 'Group not found', 'GROUP_NOT_FOUND');
  group.status = 'DELETED';
  await group.save();
};

export const transferGroupOwnership = async (userId, groupId, successorId) => {
  const group = await Group.findOne({ _id: groupId, ownerId: userId, status: 'ACTIVE' });
  if (!group) throw new ApiError(404, 'Group not found', 'GROUP_NOT_FOUND');
  const currentOwner = group.members.find((member) => member.userId.toString() === userId.toString());
  const successor = group.members.find((member) => member.userId.toString() === successorId.toString());
  if (!successor) throw new ApiError(404, 'Successor must already be a group member', 'GROUP_MEMBER_NOT_FOUND');
  currentOwner.role = 'ADMIN';
  successor.role = 'OWNER';
  group.ownerId = successor.userId;
  await group.save();
  await createNotification(successorId, 'GROUP_UPDATE', 'Group ownership transferred', 'You now own {group}', { groupId }, { group: group.name });
  return group;
};

export const inviteGroupMember = async (actorId, groupId, recipientId, role) => {
  const group = await Group.findOne({ _id: groupId, status: 'ACTIVE' });
  if (!group) throw new ApiError(404, 'Group not found', 'GROUP_NOT_FOUND');
  assertGroupAdmin(group, actorId);
  if (group.members.some((member) => member.userId.toString() === recipientId.toString())) throw new ApiError(409, 'User is already a member', 'GROUP_MEMBER_EXISTS');
  if (!(await User.exists({ _id: recipientId, status: 'ACTIVE' }))) throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');
  try {
    const invitation = await GroupInvitation.create({ groupId, inviterId: actorId, recipientId, role });
    await createNotification(recipientId, 'INVITATION', 'Group invitation', 'You were invited to {group}', { groupId, invitationId: invitation._id }, { group: group.name });
    return invitation;
  } catch (error) {
    if (error.code === 11000) throw new ApiError(409, 'A group invitation is already pending', 'GROUP_INVITATION_EXISTS');
    throw error;
  }
};

export const listGroupInvitations = (userId) => GroupInvitation.find({ recipientId: userId, status: 'PENDING' })
  .populate('groupId', 'name code')
  .populate('inviterId', 'displayName avatarMediaId')
  .sort({ createdAt: -1 });

export const respondGroupInvitation = async (userId, invitationId, action) => {
  const invitation = await GroupInvitation.findOne({ _id: invitationId, recipientId: userId, status: 'PENDING' });
  if (!invitation) throw new ApiError(404, 'Group invitation not found', 'GROUP_INVITATION_NOT_FOUND');
  if (action === 'ACCEPT') {
    const group = await Group.findOne({ _id: invitation.groupId, status: 'ACTIVE' });
    if (!group) throw new ApiError(404, 'Group not found', 'GROUP_NOT_FOUND');
    if (!group.members.some((member) => member.userId.toString() === userId.toString())) {
      group.members.push({ userId, role: invitation.role });
      await group.save();
    }
  }
  invitation.status = action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
  invitation.respondedAt = new Date();
  await invitation.save();
  return invitation;
};

export const createGroupEvent = async (userId, groupId, input) => {
  const group = await Group.findOne({ _id: groupId, 'members.userId': userId, status: 'ACTIVE' });
  if (!group) throw new ApiError(404, 'Group not found', 'GROUP_NOT_FOUND');
  const calendar = await Calendar.findOne({ ownerId: userId });
  if (!calendar) throw new ApiError(404, 'Primary calendar not found', 'CALENDAR_NOT_FOUND');
  const result = await eventService.createEvent(userId, calendar._id, { ...input, groupId });
  await eventService.shareEvent(userId, result.event._id, { targetType: 'GROUP', targetIds: [groupId], permission: 'RESPOND' });
  return result;
};
