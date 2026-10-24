import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import catchAsync from '../utils/catchAsync.js';
import { sendSuccess } from '../utils/response.js';
import { audit } from '../services/audit.service.js';
import * as service from '../services/coupon.service.js';
import { couponBody, couponParams, couponsQuery, couponUpdateBody, redemptionsQuery } from '../schemas/coupon.schemas.js';
// Mounted after the admin authentication and role middleware.
const router = Router();
router.get('/stats', catchAsync(async (req, res) => sendSuccess(res, await service.couponStats())));
router.get('/', validate({ query: couponsQuery }), catchAsync(async (req, res) => { const result = await service.listCoupons(req.query); sendSuccess(res, result.items, {meta: result.meta}); }));
router.post('/', validate({ body: couponBody }), catchAsync(async (req, res) => { const coupon = await service.createCoupon(req.user._id, req.body); await audit({req,action:'ADMIN_COUPON_CREATED',targetType:'Coupon',targetId:coupon._id}); sendSuccess(res, coupon, { status: 201 }); }));
router.get('/:id', validate({ params: couponParams }), catchAsync(async (req, res) => sendSuccess(res, await service.getCoupon(req.params.id))));
router.patch('/:id', validate({ params: couponParams, body: couponUpdateBody }), catchAsync(async (req, res) => { const coupon = await service.updateCoupon(req.params.id, req.body); await audit({req,action:'ADMIN_COUPON_UPDATED',targetType:'Coupon',targetId:coupon._id,metadata:{fields:Object.keys(req.body)}}); sendSuccess(res, coupon); }));
router.get('/:id/redemptions', validate({ params: couponParams, query: redemptionsQuery }), catchAsync(async (req, res) => { const result = await service.listRedemptions(req.params.id, req.query); sendSuccess(res, result.items, {meta: result.meta}); }));
router.delete('/:id', validate({ params: couponParams }), catchAsync(async (req, res) => { const result = await service.deleteCoupon(req.params.id); await audit({req,action:'ADMIN_COUPON_DELETED',targetType:'Coupon',targetId:req.params.id}); sendSuccess(res, result); }));
export default router;