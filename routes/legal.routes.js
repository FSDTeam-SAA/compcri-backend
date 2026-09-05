import { Router } from 'express';
import { z } from 'zod';
import * as controller from '../controllers/legal.controller.js';
import { authenticate } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';

const router = Router();
router.get('/', controller.listLegal);
router.get('/:type', validate({ params: z.object({ type: z.enum(['terms', 'privacy']) }) }), controller.getLegal);
export default router;

export const supportRouter = Router();
supportRouter.use(authenticate);
supportRouter.post('/', validate({ body: z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().email(),
  phone: z.string().max(40).optional(),
  note: z.string().trim().min(1).max(5000),
  mediaIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(5).optional()
}) }), controller.createSupportRequest);

