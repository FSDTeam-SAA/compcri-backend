import { connectDatabase, disconnectDatabase } from './config/database.js';
import logger from './config/logger.js';
import { startAgenda, stopAgenda } from './jobs/agenda.js';

const run = async () => {
  await connectDatabase();
  await startAgenda();
};

const shutdown = async (signal) => {
  logger.info({ signal }, 'Worker shutting down');
  await stopAgenda();
  await disconnectDatabase();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
run().catch((error) => {
  logger.fatal({ err: error }, 'Worker failed to start');
  process.exit(1);
});

