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
