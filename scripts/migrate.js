import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import logger from '../config/logger.js';
import '../models/index.js';
import Migration from '../models/Migration.js';

const migrations = [
  {
    version: '001-sync-declared-indexes',
    description: 'Create the initial v1 application indexes',
    up: async () => {
      for (const modelName of mongoose.modelNames()) {
        await mongoose.model(modelName).syncIndexes();
        logger.info({ model: modelName }, 'Indexes synchronized');
      }
    }
  },
  {
    version: '002-usage-and-influencer-indexes',
    description: 'Create indexes for usage tracking, influencer redemptions and report queries',
    // createIndexes only adds what is declared and never drops an index.
    up: async () => {
      for (const modelName of ['AppInstall', 'UserActivity', 'CouponRedemption', 'User', 'RevenueCatEvent', 'Coupon']) {
        await mongoose.model(modelName).createIndexes();
        logger.info({ model: modelName }, 'Indexes created');
      }
    }
  }
];

const run = async () => {
  await connectDatabase();
  for (const migration of migrations) {
    if (await Migration.exists({ version: migration.version })) continue;
    await migration.up();
    await Migration.create({ version: migration.version, description: migration.description });
    logger.info({ version: migration.version }, 'Migration applied');
  }
  await disconnectDatabase();
};

run().catch((error) => {
  logger.fatal({ err: error }, 'Migration failed');
  process.exit(1);
});
