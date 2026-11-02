const rewardModel = require('../models/reward.model');
const walletService = require('./wallet.service');
const auditModel = require('../models/audit.model');
const { AppError } = require('../middleware/error.middleware');

const listRewards = () => rewardModel.getActiveRewards();

const redeemReward = async (userId, rewardId, requestId) => {
  const reward = await rewardModel.findRewardById(rewardId);
  if (!reward || reward.status !== 'ACTIVE') {
    throw new AppError('Reward not found or inactive', 404);
  }

  if (reward.stock <= 0) {
    throw new AppError('Reward is out of stock', 400);
  }

  const stockUpdated = await rewardModel.decrementStock(rewardId);
  if (!stockUpdated) {
    throw new AppError('Reward is out of stock', 400);
  }

  await walletService.deductPoints({
    userId,
    amount: reward.pointsRequired,
    referenceType: 'REWARD',
    referenceId: rewardId,
    description: `Redeemed ${reward.title}`,
    idempotencyKey: `redeem:${userId}:${rewardId}:${requestId}`
  });

  const redemption = await rewardModel.createRedemption({
    userId,
    rewardId,
    pointsUsed: reward.pointsRequired
  });

  await auditModel.createAuditLog({
    userId,
    action: 'REWARD_REDEEMED',
    metadata: { rewardId, redemptionId: redemption.id, pointsUsed: reward.pointsRequired },
    requestId
  });

  return redemption;
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
