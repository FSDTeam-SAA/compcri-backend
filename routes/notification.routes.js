import { Router } from 'express';
import { z } from 'zod';
import * as controller from '../controllers/notification.controller.js';
import { authenticate } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const router = Router();
router.use(['/notifications', '/devices'], authenticate);
router.get('/notifications', validate({ query: z.object({ unread: z.enum(['true', 'false']).optional(), page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional() }) }), controller.list);
router.put('/notifications/read-all', controller.readAll);
router.put('/notifications/:id/read', validate({ params: z.object({ id: objectId }) }), controller.read);
router.delete('/notifications/:id', validate({ params: z.object({ id: objectId }) }), controller.remove);
router.post('/devices', validate({ body: z.object({ token: z.string().min(20).max(4096), platform: z.enum(['IOS', 'ANDROID']) }) }), controller.registerDevice);
router.delete('/devices', validate({ body: z.object({ token: z.string().min(20).max(4096) }) }), controller.unregisterDevice);
export default router;
