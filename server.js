import app from './app.js';
import { env } from './config/env.js';
import logger from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';

let server;

const start = async () => {
  await connectDatabase();
  server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'API server started'));
  // Mobile clients keep pooled connections open between turns. Node's 5s
  // default closes an idle socket without telling the client, so the next
  // request — a voice upload after a pause to record — goes out on a dead
  // connection and fails as "Connection closed before full header was
  // received". POST is not retried by the client, so it surfaces as an error.
  // headersTimeout must stay above keepAliveTimeout.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
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
