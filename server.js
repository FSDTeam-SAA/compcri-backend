import app from './app.js';
import { env } from './config/env.js';
import logger from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';

let server;

const start = async () => {
  await connectDatabase();
  server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'API server started'));
};

const shutdown = async (signal, exitCode = 0) => {
  logger.info({ signal }, 'API shutting down');
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
  process.exit(exitCode);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (error) => {
  logger.error({ err: error }, 'Unhandled rejection');
  shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  shutdown('uncaughtException', 1);
});

start().catch((error) => {
  logger.fatal({ err: error }, 'API failed to start');
  process.exit(1);
});
