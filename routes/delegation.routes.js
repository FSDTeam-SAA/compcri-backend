import { Router } from 'express';
import * as controller from '../controllers/delegation.controller.js';
import { authenticate } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import * as schemas from '../schemas/delegation.schemas.js';

const router = Router();
router.use(authenticate);
router.post('/lookup', validate({ body: schemas.lookupSchema }), controller.lookup);
router.get('/', controller.list);
router.post('/', validate({ body: schemas.createDelegationSchema }), controller.create);
router.get('/:id', validate({ params: schemas.idParams }), controller.get);
router.patch('/:id', validate({ params: schemas.idParams, body: schemas.updateDelegationSchema }), controller.update);
router.delete('/:id', validate({ params: schemas.idParams }), controller.remove);
export default router;

