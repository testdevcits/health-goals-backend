const router = require('express').Router();
const auth = require('../middleware/partner-portal-auth.middleware');
const { AppError } = require('../middleware/error.middleware');
const { successResponse } = require('../utils/response');
const { authLimiter, adminWriteLimiter } = require('../middleware/rate-limit.middleware');
const portal = require('../services/partner-portal.service');
const rewardModel = require('../models/reward.model');
const voucherCodes = require('../services/voucher-code.service');
const audit = require('../models/audit.model');

router.post('/login', authLimiter, async (req, res, next) => {
  try { successResponse(res, 200, 'Partner signed in', await portal.login(req.body || {})); }
  catch (error) { next(error); }
});

router.use(auth);
router.get('/me', (req, res) => successResponse(res, 200, 'Partner account', { partner: req.portalPartner }));
router.post('/change-password', authLimiter, async (req, res, next) => {
  try {
    if (!req.portalPartner.mustChangePassword) throw new AppError('Password has already been changed', 409);
    successResponse(res, 200, 'Password updated', await portal.changePassword(req.portalPartner.id, req.body?.password));
  } catch (error) { next(error); }
});

function requireReady(req, res, next) {
  if (req.portalPartner.mustChangePassword) return next(new AppError('Choose a new password before using the partner portal', 403));
  next();
}

router.get('/coupons', requireReady, async (req, res, next) => {
  try {
    const data = await rewardModel.getPartnerRedemptions(req.portalPartner.id);
    successResponse(res, 200, 'Partner coupon activity', { generatedCount: data.total, usedCount: data.used, expiredCount: data.expired, activeCount: data.active, items: data.items });
  } catch (error) { next(error); }
});

async function findRedemption(req, res, next) {
  try {
    if (req.portalPartner.mustChangePassword) throw new AppError('Choose a new password before verifying coupons', 403);
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code || code.length > 160) throw new AppError('Enter a valid coupon code', 400);
    const result = await rewardModel.getRedemptionForPartnerCode(voucherCodes.hash(code), req.portalPartner.id);
    if (!result) throw new AppError('This coupon could not be verified for your partner account', 404);
    req.verifiedRedemption = result;
    next();
  } catch (error) { next(error); }
}

function stateOf(result) {
  const redemption = result.redemption;
  if (redemption.status === 'REDEEMED') return 'ALREADY_USED';
  if (redemption.status !== 'ISSUED') return 'NOT_VALID';
  if (!redemption.expiresAt || new Date(redemption.expiresAt) <= new Date()) return 'EXPIRED';
  return 'VALID';
}

router.post('/verify', adminWriteLimiter, requireReady, findRedemption, (req, res) => {
  const result = req.verifiedRedemption;
  successResponse(res, 200, 'Coupon checked', { state: stateOf(result), rewardTitle: result.rewardTitle, expiresAt: result.redemption.expiresAt, redeemedAt: result.redemption.redeemedAt });
});

router.post('/mark-used', adminWriteLimiter, requireReady, findRedemption, async (req, res, next) => {
  try {
    const result = req.verifiedRedemption;
    const state = stateOf(result);
    if (state !== 'VALID') return successResponse(res, 200, 'Coupon is not available to use', { state, rewardTitle: result.rewardTitle, expiresAt: result.redemption.expiresAt, redeemedAt: result.redemption.redeemedAt });
    const updated = await rewardModel.markRedemptionUsed(result.redemption.id, { partnerId: req.portalPartner.id, partnerUsername: req.portalPartner.username });
    if (!updated) {
      const latest = await rewardModel.getRedemptionForPartnerCode(voucherCodes.hash(req.body.code.trim()), req.portalPartner.id);
      const latestState = latest ? stateOf(latest) : 'NOT_VALID';
      return successResponse(res, 200, 'Coupon is not available to use', { state: latestState, rewardTitle: latest?.rewardTitle || result.rewardTitle, expiresAt: latest?.redemption.expiresAt, redeemedAt: latest?.redemption.redeemedAt });
    }
    await audit.createAuditLog({ action: 'PARTNER_REDEMPTION_MARKED_USED', metadata: { partnerId: req.portalPartner.id, partnerUsername: req.portalPartner.username, redemptionId: updated.redemption.id }, requestId: req.requestId });
    successResponse(res, 200, 'Coupon marked as used', { state: 'USED', rewardTitle: updated.rewardTitle, redeemedAt: updated.redemption.redeemedAt });
  } catch (error) { next(error); }
});

module.exports = router;
