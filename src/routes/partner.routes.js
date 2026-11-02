const router = require('express').Router();
const partners = require('../models/partner.model');
const { AppError } = require('../middleware/error.middleware');
const { successResponse } = require('../utils/response');
const { adminWriteLimiter } = require('../middleware/rate-limit.middleware');

router.use(async (req, res, next) => {
  try {
    const raw = req.get('x-partner-key');
    if (!raw || !/^HK-(test|live)-[A-Za-z0-9_-]{32,}$/.test(raw)) throw new AppError('Valid partner API key required', 401);
    const partner = await partners.authenticateKey(raw);
    if (!partner) throw new AppError('Invalid, revoked, or inactive partner key', 401);
    req.partner = partner;
    next();
  } catch (error) { next(error); }
});

router.post('/coupons', adminWriteLimiter, async (req, res, next) => {
  try {
    const { title, description = '', terms = '', code, expiresAt = null } = req.body || {};
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 100) throw new AppError('Coupon title must be 1 to 100 characters', 400);
    if (typeof description !== 'string' || description.length > 1000 || typeof terms !== 'string' || terms.length > 3000) throw new AppError('Coupon description or terms are too long', 400);
    if (typeof code !== 'string' || !code.trim() || code.trim().length > 160) throw new AppError('Coupon code must be 1 to 160 characters', 400);
    let expiry = null; if (expiresAt) { expiry = new Date(expiresAt); if (!Number.isFinite(+expiry) || expiry <= new Date()) throw new AppError('Expiry must be a future date', 400); }
    const coupon = await partners.submitCoupon(req.partner.id, { environment: req.partner.environment, title: title.trim(), description, terms, code: code.trim(), expiresAt: expiry });
    successResponse(res, 201, 'Coupon submitted for admin review', { coupon });
  } catch (error) { next(error); }
});

module.exports = router;
