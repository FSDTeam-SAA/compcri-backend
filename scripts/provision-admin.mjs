// Creates the requested admin without placing plaintext credentials in files or arguments.
import 'dotenv/config';
import { createInterface } from 'node:readline';
import argon2 from 'argon2';
import mongoose from 'mongoose';
import { randomUUID, randomBytes } from 'node:crypto';
import User from '../models/User.js';
import Calendar from '../models/Calendar.js';
import { Subscription } from '../models/Subscription.js';
import { AuditLog } from '../models/Operations.js';
import { env } from '../config/env.js';

if (process.stdin.isTTY) process.stdin.setRawMode(true);
const reader = createInterface({ input: process.stdin, terminal: false });
console.log('Ready for hidden admin credentials on stdin.');
const line = await new Promise(resolve => reader.once('line', resolve));
reader.close();
if (process.stdin.isTTY) process.stdin.setRawMode(false);
process.stdin.pause();
try {
 const { email, password } = JSON.parse(line);
 if (!email || !password) throw new Error('Email and password are required');
 await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000, autoIndex: false });
 const existing = await User.findOne({ email }).select('+passwordHash');
 if (existing && (existing.role !== 'ADMIN' || !existing.passwordHash || !(await argon2.verify(existing.passwordHash, password)))) throw new Error('Account exists with a different role or password; it was not changed.');
 let user = existing;
 if (!user) {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await mongoose.connection.transaction(async session => {
   [user] = await User.create([{ email, passwordHash, role: 'ADMIN', status: 'ACTIVE', displayName: 'Administrator', firstName: 'Admin', contactCode: 'ADMIN-' + randomBytes(6).toString('hex').toUpperCase(), revenueCatAppUserId: randomUUID() }], { session });
   await Calendar.create([{ ownerId: user._id, name: 'Admin Calendar', timeZone: 'Asia/Dhaka' }], { session });
   await Subscription.create([{ userId: user._id, appUserId: user.revenueCatAppUserId }], { session });
   await AuditLog.create([{ actorId: user._id, action: 'ADMIN_PROVISIONED', targetType: 'User', targetId: user._id, metadata: { source: 'deployment' } }], { session });
  });
 }
 const verified = await User.findById(user._id).select('+passwordHash');
 if (verified.role !== 'ADMIN' || verified.status !== 'ACTIVE' || !(await argon2.verify(verified.passwordHash, password))) throw new Error('Admin verification failed');
 console.log(JSON.stringify({ created: !existing, verified: true, email: verified.email, role: verified.role, id: verified._id }));
} catch (error) {
 console.error(error.name + ': ' + error.message);
 process.exitCode = 1;
} finally { await mongoose.disconnect(); process.stdin.pause(); }
