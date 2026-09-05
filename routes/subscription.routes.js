import { Router } from 'express';
import * as controller from '../controllers/subscription.controller.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();
router.get('/subscriptions/me', authenticate, controller.getMine);
router.post('/subscriptions/reconcile', authenticate, controller.reconcileMine);
router.post('/webhooks/revenuecat', controller.webhook);
export default router;

