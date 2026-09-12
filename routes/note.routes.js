import { Router } from 'express';
import * as controller from '../controllers/note.controller.js';
import { authenticate } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import audioUpload from '../middlewares/audioUpload.js';
import * as schemas from '../schemas/note.schemas.js';

const router = Router();
router.use('/notes', authenticate);
router.get('/notes', validate({ query: schemas.listNotesQuery }), controller.list);
router.post('/notes', validate({ body: schemas.createNoteBody }), controller.create);
router.post(
  '/notes/voice',
  audioUpload.single('audio'),
  validate({ body: schemas.voiceNoteBody }),
  controller.createFromVoice
);
router.get('/notes/:id', validate({ params: schemas.noteParams }), controller.get);
router.patch('/notes/:id', validate({ params: schemas.noteParams, body: schemas.updateNoteBody }), controller.update);
router.delete('/notes/:id', validate({ params: schemas.noteParams }), controller.remove);
export default router;
