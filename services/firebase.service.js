import admin from 'firebase-admin';
import { env } from '../config/env.js';
import logger from '../config/logger.js';

let app;

const getApp = () => {
  if (app) return app;
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return null;
  app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY
    })
  });
  return app;
};

export const sendMulticast = async (message) => {
  const firebase = getApp();
  if (!firebase) {
    logger.debug('Firebase is not configured; push delivery skipped');
    return null;
  }
  return admin.messaging(firebase).sendEachForMulticast(message);
};

