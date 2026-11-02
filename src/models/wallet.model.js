const mongoose = require('mongoose');
const env = require('../config/env');
const crypto = require('crypto');

const walletSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    availablePoints: { type: Number, default: 0 },
    lifetimeEarned: { type: Number, default: 0 },
    lifetimeRedeemed: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const walletTransactionSchema = new mongoose.Schema(
  {
    walletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['EARN', 'BONUS', 'REDEEM', 'ADJUSTMENT', 'REVERSAL', 'EXPIRATION'],
      required: true
    },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    referenceType: { type: String, required: true },
    referenceId: { type: String, required: true },
    description: { type: String, default: '' },
    idempotencyKey: { type: String, required: true, unique: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const Wallet = mongoose.model('Wallet', walletSchema);
walletTransactionSchema.index({ userId: 1, createdAt: -1, _id: -1 });
const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);
const wallets = [];
const walletTransactions = [];

const toWallet = (wallet) => ({
  id: wallet.id || wallet._id.toString(),
  userId: wallet.userId || wallet.user_id,
  availablePoints: wallet.availablePoints ?? wallet.available_points,
  lifetimeEarned: wallet.lifetimeEarned ?? wallet.lifetime_earned,
  lifetimeRedeemed: wallet.lifetimeRedeemed ?? wallet.lifetime_redeemed,
  createdAt: wallet.createdAt || wallet.created_at,
  updatedAt: wallet.updatedAt || wallet.updated_at
});

const toTransaction = (transaction) => ({
  id: transaction.id || transaction._id.toString(),
  walletId: transaction.walletId || transaction.wallet_id,
  userId: transaction.userId || transaction.user_id,
  type: transaction.type,
  amount: transaction.amount,
  balanceAfter: transaction.balanceAfter ?? transaction.balance_after,
  referenceType: transaction.referenceType || transaction.reference_type,
  referenceId: transaction.referenceId || transaction.reference_id,
  description: transaction.description,
  idempotencyKey: transaction.idempotencyKey || transaction.idempotency_key,
  createdAt: transaction.createdAt || transaction.created_at
});

const getOrCreateWallet = async (userId) => {
  if (!env.useMongoDB) {
    let wallet = wallets.find((row) => row.user_id === userId);
    if (!wallet) {
      const now = new Date().toISOString();
      wallet = {
        id: crypto.randomUUID(),
        user_id: userId,
        available_points: 0,
        lifetime_earned: 0,
        lifetime_redeemed: 0,
        created_at: now,
        updated_at: now
      };
      wallets.push(wallet);
    }
    return toWallet(wallet);
  }

  const wallet = await Wallet.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return toWallet(wallet);
};

const createTransaction = async ({ userId, type, amount, referenceType, referenceId, description, idempotencyKey }, session = null) => {
  if (!env.useMongoDB) {
    const existing = walletTransactions.find((row) => row.idempotency_key === idempotencyKey);
    if (existing) {
      return { transaction: toTransaction(existing), duplicate: true };
    }

    const wallet = wallets.find((row) => row.user_id === userId) || (await getOrCreateWallet(userId));
    const internalWallet = wallets.find((row) => row.user_id === userId) || wallet;
    const balanceAfter = internalWallet.available_points + amount;

    if (balanceAfter < 0) {
      throw new Error('INSUFFICIENT_POINTS');
    }

    internalWallet.available_points = balanceAfter;
    if (amount > 0) internalWallet.lifetime_earned += amount;
    if (amount < 0) internalWallet.lifetime_redeemed += Math.abs(amount);
    internalWallet.updated_at = new Date().toISOString();

    const transaction = {
      id: crypto.randomUUID(),
      wallet_id: internalWallet.id,
      user_id: userId,
      type,
      amount,
      balance_after: balanceAfter,
      reference_type: referenceType,
      reference_id: referenceId,
      description,
      idempotency_key: idempotencyKey,
      created_at: new Date().toISOString()
    };
    walletTransactions.push(transaction);
    return { transaction: toTransaction(transaction), duplicate: false };
  }

  if (!session) {
    return mongoose.connection.transaction(tx => createTransaction({ userId, type, amount, referenceType, referenceId, description, idempotencyKey }, tx));
  }
  const existing = await WalletTransaction.findOne({ idempotencyKey }).session(session);
  if (existing) return { transaction: toTransaction(existing), duplicate: true };
  await Wallet.updateOne({ userId }, { $setOnInsert: { userId } }, { upsert: true, session });
  const wallet = await Wallet.findOneAndUpdate(
    { userId, ...(amount < 0 ? { availablePoints: { $gte: Math.abs(amount) } } : {}) },
    { $inc: { availablePoints: amount, ...(amount > 0 ? { lifetimeEarned: amount } : { lifetimeRedeemed: Math.abs(amount) }) } },
    { new: true, session }
  );
  if (!wallet) throw new Error('INSUFFICIENT_POINTS');
  const [transaction] = await WalletTransaction.create([{ walletId: wallet._id, userId, type, amount,
    balanceAfter: wallet.availablePoints, referenceType, referenceId, description, idempotencyKey }], { session });
  return { transaction: toTransaction(transaction), duplicate: false };
};

const getTransactionsByUserId = async (userId) => {
  if (!env.useMongoDB) {
    return walletTransactions
      .filter((row) => row.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map(toTransaction);
  }

  const rows = await WalletTransaction.find({ userId }).sort({ createdAt: -1 }).limit(100);
  return rows.map(toTransaction);
};

module.exports = {
  toTransaction,
  Wallet,
  findWallet: async (userId) => { const row = env.useMongoDB ? await Wallet.findOne({ userId }).lean() : wallets.find(row => row.user_id === userId); return row ? toWallet(row) : { userId, availablePoints: 0, lifetimeEarned: 0, lifetimeRedeemed: 0 }; },
  WalletTransaction,
  getOrCreateWallet,
  createTransaction,
  getTransactionsByUserId
};
