import { Router } from 'express';
import * as controller from '../controllers/media.controller.js';
import { authenticate } from '../middlewares/auth.js';
import upload from '../middlewares/upload.js';
import { validate } from '../middlewares/validate.js';
import { mediaClaimSchema, mediaUploadSchema, mongoIdParams } from '../schemas/user.schemas.js';

const router = Router();
router.use(authenticate);
router.post('/', upload.single('image'), validate({ body: mediaUploadSchema }), controller.upload);
router.post('/:id/claim', validate({ params: mongoIdParams, body: mediaClaimSchema }), controller.claim);
router.put('/:id/replace', upload.single('image'), validate({ params: mongoIdParams }), controller.replace);
router.delete('/:id', validate({ params: mongoIdParams }), controller.remove);
export default router;
