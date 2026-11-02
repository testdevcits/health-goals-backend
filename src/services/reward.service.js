const rewardModel = require('../models/reward.model');
const walletService = require('./wallet.service');
const auditModel = require('../models/audit.model');
const { AppError } = require('../middleware/error.middleware');
const voucherCodes = require('./voucher-code.service');
const mongoose = require('mongoose');
const env = require('../config/env');

const listRewards = () => rewardModel.getActiveRewards();

const redeemReward = async (userId, rewardId, requestId) => {
  const run = async session => {
    const reward = await rewardModel.findRewardById(rewardId);
    if (!reward || reward.status !== 'ACTIVE') throw new AppError('Reward not found or inactive', 404);
    const now = Date.now();
    if ((reward.startAt && new Date(reward.startAt).getTime() > now) || (reward.endAt && new Date(reward.endAt).getTime() < now)) throw new AppError('This reward is outside its redemption period', 409);
    if (reward.stock <= 0) throw new AppError('Reward is out of stock', 400);
    const availableCodes = await rewardModel.countAvailableVoucherCodes(rewardId);
    if (!availableCodes) throw new AppError('This reward has no voucher codes available right now', 409);
    if (env.useMongoDB) {
      const stockUpdated = await rewardModel.Reward.updateOne({ _id: rewardId, stock: { $gt: 0 } }, { $inc: { stock: -1 } }, { session });
      if (!stockUpdated.modifiedCount) throw new AppError('Reward is out of stock', 409);
    } else if (!await rewardModel.decrementStock(rewardId)) throw new AppError('Reward is out of stock', 409);

    const codeRow = env.useMongoDB
      ? await rewardModel.VoucherCode.findOne({ rewardId, status: 'AVAILABLE' }).sort({ createdAt: 1, _id: 1 }).session(session)
      : null;
    const code = codeRow ? voucherCodes.decrypt(codeRow.encryptedCode) : null;
    await walletService.deductPoints({ userId, amount: reward.pointsRequired, referenceType: 'REWARD', referenceId: rewardId,
      description: `Redeemed ${reward.title}`, idempotencyKey: `redeem:${userId}:${rewardId}:${requestId}`, session });
    const redemption = await rewardModel.createRedemption({ userId, rewardId, pointsUsed: reward.pointsRequired, redemptionCode: code, expiresAt: codeRow?.expiresAt || null, session });
    if (env.useMongoDB) {
      const assigned = await rewardModel.assignVoucherCode(rewardId, userId, redemption.id, session);
      if (!assigned || String(assigned._id) !== String(codeRow?._id)) throw new AppError('Voucher inventory changed; retry the redemption', 409);
    } else {
      const assigned = await rewardModel.assignVoucherCode(rewardId, userId, redemption.id, session);
      if (!assigned) throw new AppError('Voucher inventory changed; retry the redemption', 409);
      redemption.redemptionCode = voucherCodes.decrypt(assigned.encryptedCode);
    }
    return { redemption, rewardTitle: reward.title, pointsUsed: reward.pointsRequired };
  };
  const result = env.useMongoDB ? await mongoose.connection.transaction(session => run(session)) : await run(null);
  await auditModel.createAuditLog({ userId, action: 'REWARD_REDEEMED', metadata: { rewardId, redemptionId: result.redemption.id, pointsUsed: result.pointsUsed }, requestId });
  return result.redemption;
};

const listRedemptions = (userId) => rewardModel.getRedemptionsByUserId(userId);

const getRedemption = async (userId, id) => {
  const redemption = await rewardModel.getRedemptionById(userId, id);
  if (!redemption) {
    throw new AppError('Redemption not found', 404);
  }
  return redemption;
};

module.exports = {
  listRewards,
  redeemReward,
  listRedemptions,
  getRedemption
};
