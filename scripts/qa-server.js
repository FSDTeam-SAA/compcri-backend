// An isolated, disposable API for native app QA. Never reads the production DB.
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
Object.assign(process.env, {
  NODE_ENV: 'test', DISABLE_JOBS: 'true', PAYWALL_ENABLED: 'true', PORT: '5507',
  MONGODB_URI: replset.getUri('native-app-qa'),
  JWT_ACCESS_SECRET: 'native-qa-access-secret-for-disposable-server-123',
  JWT_REFRESH_SECRET: 'native-qa-refresh-secret-for-disposable-server-456',
  GOOGLE_CLIENT_IDS: '', GEMINI_API_KEY: '', OPENAI_API_KEY: '',
  REVENUECAT_SECRET_API_KEY: '', CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '', SMTP_HOST: '',
  FIREBASE_PROJECT_ID: '', FIREBASE_CLIENT_EMAIL: '', FIREBASE_PRIVATE_KEY: ''
});
await (await import('../config/database.js')).connectDatabase();
const models = await import('../models/index.js');
const mongoose = (await import('mongoose')).default;
await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
await models.LegalDocument.create([
  { type: 'TERMS', version: 'v1', locale: 'en', title: 'QA terms', content: 'Disposable QA server', active: true },
  { type: 'PRIVACY', version: 'v1', locale: 'en', title: 'QA privacy', content: 'Disposable QA server', active: true }
]);
const app = (await import('../app.js')).default;
const server = app.listen(5507, '127.0.0.1', () => process.stdout.write('QA API ready at http://127.0.0.1:5507/api/v1\n'));
async function stop() {
  server.close();
  await (await import('../config/database.js')).disconnectDatabase();
  await replset.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
