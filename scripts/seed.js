import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import logger from '../config/logger.js';
import User from '../models/User.js';
import Calendar from '../models/Calendar.js';
import { Subscription } from '../models/Subscription.js';
import { LegalDocument } from '../models/Legal.js';
import { hashPassword } from '../services/auth.service.js';
import { humanCode, randomUuid } from '../utils/crypto.js';

const legal = [
  {
    type: 'TERMS', version: 'v1', locale: 'en', title: 'Terms & Conditions',
    content: 'Placeholder terms for development. Replace with legally approved Compcri terms before production.', active: true
  },
  {
    type: 'PRIVACY', version: 'v1', locale: 'en', title: 'Privacy Policy',
    content: 'Placeholder privacy policy for development. Replace with legally approved Compcri privacy copy before production.', active: true
  }
];

const run = async () => {
  await connectDatabase();
  await LegalDocument.bulkWrite(legal.map((document) => ({
    updateOne: { filter: { type: document.type, version: document.version, locale: document.locale }, update: { $set: document }, upsert: true }
  })));

  let admin = await User.findOne({ email: env.ADMIN_EMAIL });
  if (!admin) {
    admin = await User.create({
      email: env.ADMIN_EMAIL,
      passwordHash: await hashPassword(env.ADMIN_PASSWORD),
      role: 'ADMIN',
      displayName: 'Administrator',
      firstName: 'Admin',
      contactCode: humanCode('ADMIN'),
      revenueCatAppUserId: randomUuid()
    });
    await Promise.all([
      Calendar.create({ ownerId: admin._id, name: 'Admin Calendar' }),
      Subscription.create({ userId: admin._id, appUserId: admin.revenueCatAppUserId })
    ]);
  }
  logger.info({ adminEmail: admin.email }, 'Seed complete');
  await disconnectDatabase();
};

run().catch((error) => {
  logger.fatal({ err: error }, 'Seed failed');
  process.exit(1);
});

