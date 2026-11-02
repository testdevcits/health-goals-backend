const mongoose = require('mongoose');
const env = require('../config/env');
const crypto = require('crypto');

const rewardSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: '' },
    pointsRequired: { type: Number, required: true },
    stock: { type: Number, default: 0 },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'EXPIRED'], default: 'ACTIVE' },
    provider: { type: String, default: null },
    terms: { type: String, default: '' }
  },
  { timestamps: true }
);

const redemptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rewardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Reward', required: true },
    pointsUsed: { type: Number, required: true },
    status: { type: String, enum: ['ISSUED', 'REDEEMED', 'CANCELLED'], default: 'ISSUED' },
    redemptionCode: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    redeemedAt: { type: Date, default: null }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const Reward = mongoose.model('Reward', rewardSchema);
const Redemption = mongoose.model('Redemption', redemptionSchema);
const rewards = [];
const redemptions = [];

const seedRewards = () => {
  if (rewards.length > 0) return;
  rewards.push({
    id: crypto.randomUUID(),
    title: 'Movie Ticket',
    description: 'Sample development reward.',
    points_required: 100,
    stock: 10,
    status: 'ACTIVE',
    provider: 'demo',
    terms: 'Development reward only.',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
};

const toReward = (reward) => ({
  id: reward.id || reward._id.toString(),
  title: reward.title,
  description: reward.description,
  pointsRequired: reward.pointsRequired ?? reward.points_required,
  stock: reward.stock,
  status: reward.status,
  provider: reward.provider,
  terms: reward.terms,
  startAt: reward.startAt || reward.start_at,
  endAt: reward.endAt || reward.end_at,
  createdAt: reward.createdAt || reward.created_at,
  updatedAt: reward.updatedAt || reward.updated_at
});

const toRedemption = (redemption) => ({
  id: redemption.id || redemption._id.toString(),
  userId: redemption.userId || redemption.user_id,
  rewardId: redemption.rewardId || redemption.reward_id,
  pointsUsed: redemption.pointsUsed ?? redemption.points_used,
  status: redemption.status,
  redemptionCode: redemption.redemptionCode || redemption.redemption_code,
  expiresAt: redemption.expiresAt || redemption.expires_at,
  redeemedAt: redemption.redeemedAt || redemption.redeemed_at,
  createdAt: redemption.createdAt || redemption.created_at
});

const getActiveRewards = async () => {
  if (!env.useMongoDB) {
    seedRewards();
    return rewards.filter((reward) => reward.status === 'ACTIVE' && reward.stock > 0).map(toReward);
  }

  const now = new Date();
  const rows = await Reward.find({
    status: 'ACTIVE',
    stock: { $gt: 0 },
    $and: [
      { $or: [{ startAt: null }, { startAt: { $lte: now } }] },
      { $or: [{ endAt: null }, { endAt: { $gte: now } }] }
    ]
  }).sort({ pointsRequired: 1 });
  return rows.map(toReward);
};

const findRewardById = async (id) => {
  if (!env.useMongoDB) {
    seedRewards();
    const reward = rewards.find((row) => row.id === id);
    return reward ? toReward(reward) : null;
  }

  const reward = await Reward.findById(id);
  return reward ? toReward(reward) : null;
};

const decrementStock = async (id) => {
  if (!env.useMongoDB) {
    const reward = rewards.find((row) => row.id === id);
    if (!reward || reward.stock <= 0) return false;
    reward.stock -= 1;
    return true;
  }

  const reward = await Reward.findOneAndUpdate(
    { _id: id, stock: { $gt: 0 } },
    { $inc: { stock: -1 } },
    { new: true }
  );
  return Boolean(reward);
};

const createRedemption = async ({ userId, rewardId, pointsUsed }) => {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const redemptionCode = `RD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  if (!env.useMongoDB) {
    const redemption = {
      id: crypto.randomUUID(),
      user_id: userId,
      reward_id: rewardId,
      points_used: pointsUsed,
      status: 'ISSUED',
      redemption_code: redemptionCode,
      expires_at: expiresAt.toISOString(),
      redeemed_at: null,
      created_at: new Date().toISOString()
    };
    redemptions.push(redemption);
    return toRedemption(redemption);
  }

  const redemption = await Redemption.create({
    userId,
    rewardId,
    pointsUsed,
    redemptionCode,
    expiresAt
  });
  return toRedemption(redemption);
};

const getRedemptionsByUserId = async (userId) => {
  if (!env.useMongoDB) {
    return redemptions.filter((row) => row.user_id === userId).map(toRedemption);
  }

  const rows = await Redemption.find({ userId }).sort({ createdAt: -1 });
  return rows.map(toRedemption);
};

const getRedemptionById = async (userId, id) => {
  if (!env.useMongoDB) {
    const redemption = redemptions.find((row) => row.user_id === userId && row.id === id);
    return redemption ? toRedemption(redemption) : null;
  }

  const redemption = await Redemption.findOne({ _id: id, userId });
  return redemption ? toRedemption(redemption) : null;
};

module.exports = {
  Reward,
  Redemption,
  getActiveRewards,
  findRewardById,
  decrementStock,
  createRedemption,
  getRedemptionsByUserId,
  getRedemptionById
};
