const walletModel = require('../models/wallet.model');
const { AppError } = require('../middleware/error.middleware');

const getWallet = async (userId) => {
  const wallet = await walletModel.getOrCreateWallet(userId);
  const transactions = await walletModel.getTransactionsByUserId(userId);
  const dailyActivity = await require('./daily-settlement.service').progress(userId);
  return { wallet, transactions, dailyActivity };
};

const addPoints = async ({ userId, amount, referenceType, referenceId, description, idempotencyKey, type = 'EARN' }) => {
  if (amount <= 0) {
    throw new AppError('Point amount must be positive', 400);
  }

  return walletModel.createTransaction({
    userId,
    type,
    amount,
    referenceType,
    referenceId,
    description,
    idempotencyKey
  });
};

const deductPoints = async ({ userId, amount, referenceType, referenceId, description, idempotencyKey, session = null }) => {
  try {
    return await walletModel.createTransaction({
      userId,
      type: 'REDEEM',
      amount: -Math.abs(amount),
      referenceType,
      referenceId,
      description,
      idempotencyKey,
      session
    });
  } catch (error) {
    if (error.message === 'INSUFFICIENT_POINTS') {
      throw new AppError('Insufficient points', 400);
    }
    throw error;
  }
};

module.exports = {
  getWallet,
  addPoints,
  deductPoints
};
