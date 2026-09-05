import { Router } from 'express';
import * as controller from '../controllers/user.controller.js';
import { authenticate } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import * as schemas from '../schemas/user.schemas.js';

const router = Router();
router.use(authenticate);
router.get('/me', controller.getMe);
router.patch('/me', validate({ body: schemas.updateProfileSchema }), controller.updateMe);
router.put('/me/password', validate({ body: schemas.changePasswordSchema }), controller.changePassword);
router.patch('/me/notification-preferences', validate({ body: schemas.notificationPreferencesSchema }), controller.preferences);
router.get('/me/calendars', controller.calendars);
router.get('/me/subscription-management', controller.subscriptionManagement);
router.post('/me/deletion', validate({ body: schemas.deletionSchema }), controller.requestDeletion);
export default router;

