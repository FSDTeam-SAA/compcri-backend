import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import { audit } from '../services/audit.service.js';
import { recordInstall } from '../services/analytics.service.js';
import * as coupons from '../services/coupon.service.js';
import { installBody } from '../schemas/app.schemas.js';
import { applyCouponBody } from '../schemas/coupon.schemas.js';

const router = Router();
// Sent on every launch, signed in or not, so first launches can be counted.
router.post('/app/installs', validate({ body: installBody }), catchAsync(async (req, res) => sendSuccess(res, await recordInstall(req.body))));
router.post('/coupons/apply', authenticate, validate({ body: applyCouponBody }), catchAsync(async (req, res) => {
  const coupon = await coupons.applyCoupon(req.user._id, req.body.code);
  await audit({ req, action: 'COUPON_APPLIED', targetType: 'Coupon', metadata: { code: coupon.code } });
  sendSuccess(res, coupon);
}));
router.get('/coupons/applied', authenticate, catchAsync(async (req, res) => sendSuccess(res, await coupons.appliedCoupon(req.user._id))));
router.delete('/coupons/applied', authenticate, catchAsync(async (req, res) => sendSuccess(res, await coupons.removeAppliedCoupon(req.user._id))));
export default router;
