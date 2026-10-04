// firebase-admin 14 dropped the namespaced API (`admin.credential.cert`,
// `admin.messaging()`); calling it threw on every push, so no reminder or
// notification ever reached a phone. The modular entry points are the API.
import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../config/env.js';
import logger from '../config/logger.js';

let app;

const getApp = () => {
  if (app) return app;
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return null;
  app = initializeApp({
    credential: cert({
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
  return getMessaging(firebase).sendEachForMulticast(message);
};
