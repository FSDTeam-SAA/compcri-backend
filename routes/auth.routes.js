import { Router } from 'express';
import * as controller from '../controllers/auth.controller.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import { validate } from '../middlewares/validate.js';
import * as schemas from '../schemas/auth.schemas.js';

const router = Router();
router.use(authLimiter);
router.post('/register', validate({ body: schemas.registerSchema }), controller.register);
router.post('/login', validate({ body: schemas.loginSchema }), controller.login);
router.post('/google', validate({ body: schemas.googleSchema }), controller.googleLogin);
router.post('/refresh', validate({ body: schemas.refreshSchema }), controller.refresh);
router.post('/logout', validate({ body: schemas.refreshSchema }), controller.logout);
router.post('/forgot-password', validate({ body: schemas.forgotSchema }), controller.forgotPassword);
router.post('/verify-reset-otp', validate({ body: schemas.verifyOtpSchema }), controller.verifyOtp);
router.post('/reset-password', validate({ body: schemas.resetPasswordSchema }), controller.resetPassword);
router.post('/cancel-deletion', validate({ body: schemas.cancelDeletionSchema }), controller.cancelDeletion);
export default router;

