import mongoose from 'mongoose';
import { env } from './env.js';
import logger from './logger.js';

export const connectDatabase = async () => {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: env.NODE_ENV !== 'production'
  });
  logger.info({ database: mongoose.connection.name }, 'MongoDB connected');
  return mongoose.connection;
};

export const disconnectDatabase = () => mongoose.disconnect();

