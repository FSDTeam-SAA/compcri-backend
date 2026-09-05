import { Router } from 'express';
import { z } from 'zod';
import * as controller from '../controllers/ai.controller.js';
import { authenticate } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import audioUpload from '../middlewares/audioUpload.js';
import * as schemas from '../schemas/ai.schemas.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const router = Router();
router.use(authenticate);
router.get('/quota', validate({ query: z.object({ calendarId: objectId }) }), controller.quota);
router.get('/conversations', validate({ query: z.object({ search: z.string().trim().max(100).optional() }) }), controller.listConversations);
router.post('/conversations', validate({ body: schemas.conversationBody }), controller.createConversation);
router.get('/conversations/:id', validate({ params: schemas.conversationParams }), controller.getConversation);
router.delete('/conversations/:id', validate({ params: schemas.conversationParams }), controller.deleteConversation);
router.post('/conversations/:id/messages', validate({ params: schemas.conversationParams, body: schemas.messageBody }), controller.sendMessage);
router.post(
  '/conversations/:id/voice-messages',
  audioUpload.single('audio'),
  validate({ params: schemas.conversationParams, body: schemas.voiceMessageBody }),
  controller.sendVoiceMessage
);
router.patch('/conversations/:id/messages/:messageId', validate({ params: schemas.messageParams, body: schemas.messageBody }), controller.editMessage);
router.delete('/conversations/:id/messages/:messageId', validate({ params: schemas.messageParams }), controller.deleteMessage);
router.post('/actions/:id/confirm', validate({ params: schemas.actionParams, body: schemas.confirmActionBody }), controller.confirmAction);
router.post('/actions/:id/reject', validate({ params: schemas.actionParams }), controller.rejectAction);
export default router;
