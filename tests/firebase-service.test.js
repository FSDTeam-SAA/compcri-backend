import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

// The other suites replace firebase.service.js wholesale, which is how a
// firebase-admin upgrade that removed `admin.credential` broke every push in
// production without a single failing test. This one runs the real module
// against the real library, and stops short of the network.
describe('firebase service', () => {
  it('builds credentials and a messaging client with the installed firebase-admin', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    vi.resetModules();
    vi.doMock('../config/env.js', async () => ({
      env: {
        ...(await vi.importActual('../config/env.js')).env,
        FIREBASE_PROJECT_ID: 'demo-project',
        FIREBASE_CLIENT_EMAIL: 'push@demo-project.iam.gserviceaccount.com',
        FIREBASE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' })
      }
    }));
    const send = vi.fn().mockResolvedValue({ successCount: 1, failureCount: 0, responses: [] });
    let usedApp;
    // Only the network send is stubbed; credential and app are the real ones.
    vi.doMock('firebase-admin/messaging', async (importOriginal) => ({
      ...(await importOriginal()),
      getMessaging: (app) => {
        usedApp = app;
        return { sendEachForMulticast: send };
      }
    }));

    const { sendMulticast } = await import('../services/firebase.service.js');
    const message = { tokens: ['device-token'], notification: { title: 'Dentist', body: 'Starts at 9:00 AM' } };
    await expect(sendMulticast(message)).resolves.toMatchObject({ successCount: 1 });
    expect(send).toHaveBeenCalledWith(message);
    expect(usedApp.options.credential).toBeDefined();
    expect(usedApp.options.credential.projectId).toBe('demo-project');
    vi.doUnmock('firebase-admin/messaging');
    vi.doUnmock('../config/env.js');
  });

  it('uses only entry points the installed firebase-admin exports', async () => {
    const app = await import('firebase-admin/app');
    const messaging = await import('firebase-admin/messaging');
    expect(typeof app.cert).toBe('function');
    expect(typeof app.initializeApp).toBe('function');
    expect(typeof messaging.getMessaging).toBe('function');
  });
});
