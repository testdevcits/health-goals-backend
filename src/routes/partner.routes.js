const router = require('express').Router();
const partners = require('../models/partner.model');
const { AppError } = require('../middleware/error.middleware');
const { successResponse } = require('../utils/response');
const { adminWriteLimiter } = require('../middleware/rate-limit.middleware');

router.use('/portal', require('./partner-portal.routes'));

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

router.get('/redemptions', async (req, res, next) => {
  try { successResponse(res, 200, 'Partner coupon activity', await require('../models/reward.model').getPartnerRedemptions(req.partner.id)); }
  catch (error) { next(error); }
});

router.post('/redemptions/verify', adminWriteLimiter, async (req, res, next) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code || code.length > 160) throw new AppError('Enter a valid coupon code', 400);
    const result = await require('../models/reward.model').getRedemptionForPartnerCode(require('../services/voucher-code.service').hash(code), req.partner.id);
    if (!result) throw new AppError('This coupon could not be verified for your partner account', 404);
    const state = result.redemption.status === 'REDEEMED' ? 'ALREADY_USED' : result.redemption.status !== 'ISSUED' ? 'NOT_VALID' : !result.redemption.expiresAt || new Date(result.redemption.expiresAt) <= new Date() ? 'EXPIRED' : 'VALID';
    successResponse(res, 200, 'Coupon checked', { state, rewardTitle: result.rewardTitle, expiresAt: result.redemption.expiresAt, redeemedAt: result.redemption.redeemedAt });
  } catch (error) { next(error); }
});

router.post('/redemptions/mark-used', adminWriteLimiter, async (req, res, next) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code || code.length > 160) throw new AppError('Enter a valid coupon code', 400);
    const codeHash = require('../services/voucher-code.service').hash(code);
    const model = require('../models/reward.model');
    const result = await model.getRedemptionForPartnerCode(codeHash, req.partner.id);
    if (!result) throw new AppError('This coupon could not be verified for your partner account', 404);
    const redemption = result.redemption;
    if (redemption.status === 'REDEEMED') return successResponse(res, 200, 'Coupon was already used', { state: 'ALREADY_USED', rewardTitle: result.rewardTitle, redeemedAt: redemption.redeemedAt });
    if (redemption.status !== 'ISSUED' || !redemption.expiresAt || new Date(redemption.expiresAt) <= new Date()) return successResponse(res, 200, 'Coupon is not available to use', { state: redemption.status === 'ISSUED' ? 'EXPIRED' : 'NOT_VALID', rewardTitle: result.rewardTitle, expiresAt: redemption.expiresAt });
    const updated = await model.markRedemptionUsed(redemption.id, { partnerId: req.partner.id });
    if (!updated) return successResponse(res, 200, 'Coupon was already used or expired', { state: 'ALREADY_USED', rewardTitle: result.rewardTitle });
    await require('../models/audit.model').createAuditLog({ action: 'PARTNER_API_REDEMPTION_MARKED_USED', metadata: { partnerId: req.partner.id, environment: req.partner.environment, redemptionId: updated.redemption.id }, requestId: req.requestId });
    successResponse(res, 200, 'Coupon marked as used', { state: 'USED', rewardTitle: updated.rewardTitle, redeemedAt: updated.redemption.redeemedAt });
  } catch (error) { next(error); }
});

module.exports = router;
