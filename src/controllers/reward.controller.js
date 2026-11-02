const rewardService = require('../services/reward.service');
const { successResponse } = require('../utils/response');

const listRewards = async (req, res, next) => {
  try {
    const rewards = await rewardService.listRewards();
    return successResponse(res, 200, 'Rewards fetched successfully', { rewards });
  } catch (error) {
    next(error);
  }
};

const redeemReward = async (req, res, next) => {
  try {
    const redemption = await rewardService.redeemReward(req.user.id, req.params.id, req.requestId);
    return successResponse(res, 201, 'Reward redeemed successfully', { redemption });
  } catch (error) {
    next(error);
  }
};

const listRedemptions = async (req, res, next) => {
  try {
    const redemptions = await rewardService.listRedemptions(req.user.id);
    return successResponse(res, 200, 'Redemptions fetched successfully', { redemptions });
  } catch (error) {
    next(error);
  }
};

const getRedemption = async (req, res, next) => {
  try {
    const redemption = await rewardService.getRedemption(req.user.id, req.params.id);
    return successResponse(res, 200, 'Redemption fetched successfully', { redemption });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listRewards,
  redeemReward,
  listRedemptions,
  getRedemption
};
