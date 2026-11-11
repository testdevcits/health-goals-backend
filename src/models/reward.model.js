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
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null, index: true },
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
    redeemedAt: { type: Date, default: null },
    redeemedByPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', default: null },
    redeemedByPartnerUsername: { type: String, default: null },
    redeemedByStaffId: { type: String, default: null },
    redeemedByStaffEmail: { type: String, default: null }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const Reward = mongoose.model('Reward', rewardSchema);
const Redemption = mongoose.model('Redemption', redemptionSchema);
const voucherCodeSchema = new mongoose.Schema({
  rewardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Reward', required: true, index: true },
  codeHash: { type: String, required: true, unique: true },
  encryptedCode: { type: String, required: true },
  expiresAt: { type: Date, default: null },
  status: { type: String, enum: ['AVAILABLE', 'ASSIGNED'], default: 'AVAILABLE', index: true },
  redemptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Redemption', default: null },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });
voucherCodeSchema.index({ rewardId: 1, status: 1, createdAt: 1 });
const VoucherCode = mongoose.model('VoucherCode', voucherCodeSchema);
const rewards = [];
const redemptions = [];
const memoryVoucherCodes = [];

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
  partnerId: reward.partnerId ? String(reward.partnerId._id || reward.partnerId) : null,
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
  redemptionCode: (() => { const value = redemption.redemptionCode || redemption.redemption_code; return value?.startsWith('enc1:') ? require('../services/voucher-code.service').decrypt(value.slice(5)) : value; })(),
  expiresAt: redemption.expiresAt || redemption.expires_at,
  redeemedAt: redemption.redeemedAt || redemption.redeemed_at,
  redeemedByPartnerId: (() => { const partner = redemption.redeemedByPartnerId || redemption.redeemed_by_partner_id || null; return partner ? String(partner._id || partner) : null; })(),
  redeemedByPartnerName: (() => { const partner = redemption.redeemedByPartnerId || redemption.redeemed_by_partner_id; return partner?.name || null; })(),
  redeemedByPartnerUsername: redemption.redeemedByPartnerUsername || redemption.redeemed_by_partner_username || null,
  redeemedByStaffId: redemption.redeemedByStaffId || redemption.redeemed_by_staff_id || null,
  redeemedByStaffEmail: redemption.redeemedByStaffEmail || redemption.redeemed_by_staff_email || null,
  createdAt: redemption.createdAt || redemption.created_at
});

const listAllRewards = async () => env.useMongoDB
  ? (await Reward.find().sort({ createdAt: -1, _id: -1 })).map(toReward)
  : (seedRewards(), rewards.map(toReward));
const listAllRedemptions = async () => env.useMongoDB
  ? (await Redemption.find().sort({ createdAt: -1, _id: -1 })).map(toRedemption)
  : Promise.all(redemptions.map(async row => { const partnerId = row.redeemedByPartnerId || row.redeemed_by_partner_id; const partner = partnerId ? await require('./partner.model').find(String(partnerId)) : null; return { ...toRedemption(row), rewardTitle: rewards.find(reward => reward.id === row.reward_id)?.title || 'Reward', redeemedByPartnerName: partner?.name || null }; }));

const createReward = async payload => env.useMongoDB
  ? toReward(await Reward.create(payload))
  : (rewards.push({ stock: 0, ...payload, id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }), toReward(rewards[rewards.length - 1]));
const updateReward = async (id, payload) => {
  if (env.useMongoDB) {
    const row = await Reward.findByIdAndUpdate(id, { $set: payload }, { new: true, runValidators: true });
    return row ? toReward(row) : null;
  }
  const row = rewards.find(item => item.id === id);
  if (!row) return null;
  Object.assign(row, payload, { updated_at: new Date().toISOString() });
  return toReward(row);
};

const getActiveRewards = async () => {
  if (!env.useMongoDB) {
    seedRewards();
    return rewards.filter((reward) => reward.status === 'ACTIVE' && reward.stock > 0 && memoryVoucherCodes.some(code => code.rewardId === reward.id && code.status === 'AVAILABLE'))
      .map(reward => ({ ...toReward(reward), availableVoucherCount: memoryVoucherCodes.filter(code => code.rewardId === reward.id && code.status === 'AVAILABLE').length }));
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
  return (await Promise.all(rows.map(async row => ({ ...toReward(row), availableVoucherCount: await countAvailableVoucherCodes(row._id) }))))
    .filter(row => row.availableVoucherCount > 0);
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

const createRedemption = async ({ userId, rewardId, pointsUsed, redemptionCode, expiresAt: voucherExpiry = null, session = null }) => {
  const expiresAt = voucherExpiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const issuedCode = redemptionCode ? `enc1:${require('../services/voucher-code.service').encrypt(redemptionCode)}` : `RD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  if (!env.useMongoDB) {
    const redemption = {
      id: crypto.randomUUID(),
      user_id: userId,
      reward_id: rewardId,
      points_used: pointsUsed,
      status: 'ISSUED',
      redemption_code: issuedCode,
      expires_at: expiresAt.toISOString(),
      redeemed_at: null,
      created_at: new Date().toISOString()
    };
    redemptions.push(redemption);
    return toRedemption(redemption);
  }

  const [redemption] = await Redemption.create([{
    userId,
    rewardId,
    pointsUsed,
    redemptionCode: issuedCode,
    expiresAt
  }], session ? { session } : undefined);
  return toRedemption(redemption);
};

const importVoucherCodes = async (rewardId, rows, session = null) => {
  if (!env.useMongoDB) {
    const reward = rewards.find(row => row.id === rewardId);
    if (!reward) return 0;
    const known = new Set(memoryVoucherCodes.map(row => row.codeHash));
    const fresh = rows.filter(row => { if (known.has(row.codeHash)) return false; known.add(row.codeHash); return true; });
    memoryVoucherCodes.push(...fresh.map(row => ({ ...row, rewardId, status: 'AVAILABLE', id: crypto.randomUUID(), createdAt: new Date().toISOString() })));
    reward.stock += fresh.length;
    reward.updated_at = new Date().toISOString();
    return fresh.length;
  }
  await VoucherCode.insertMany(rows.map(row => ({ rewardId, ...row })), { ordered: true, ...(session ? { session } : {}) });
  const updated = await Reward.updateOne({ _id: rewardId }, { $inc: { stock: rows.length } }, session ? { session } : {});
  return updated.modifiedCount ? rows.length : 0;
};
const countAvailableVoucherCodes = rewardId => env.useMongoDB
  ? VoucherCode.countDocuments({ rewardId, status: 'AVAILABLE' })
  : memoryVoucherCodes.filter(row => row.rewardId === rewardId && row.status === 'AVAILABLE').length;
const listVoucherCodes = async (rewardId, { page = 1, limit = 50 } = {}) => {
  const offset = (page - 1) * limit;
  if (!env.useMongoDB) {
    const all = memoryVoucherCodes.filter(row => row.rewardId === rewardId).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const items = all.slice(offset, offset + limit).map(row => {
      const redemption = row.redemptionId ? redemptions.find(item => String(item.id || item._id) === String(row.redemptionId)) : null;
      let status = row.status === 'AVAILABLE' ? 'AVAILABLE' : redemption?.status || 'ISSUED';
      if (status === 'ISSUED' && row.expiresAt && new Date(row.expiresAt) <= new Date()) status = 'EXPIRED';
      return { id: String(row.id || row._id), code: require('../services/voucher-code.service').decrypt(row.encryptedCode), status, expiresAt: row.expiresAt || null, createdAt: row.createdAt || null, redeemedAt: redemption?.redeemedAt || redemption?.redeemed_at || null };
    });
    return { items, total: all.length, availableVoucherCount: all.filter(row => row.status === 'AVAILABLE').length };
  }
  const filter = { rewardId };
  const [rows, total, availableVoucherCount] = await Promise.all([
    VoucherCode.find(filter).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit).populate('redemptionId', 'status redeemedAt createdAt').lean(),
    VoucherCode.countDocuments(filter),
    countAvailableVoucherCodes(rewardId)
  ]);
  const items = rows.map(row => {
    let status = row.status === 'AVAILABLE' ? 'AVAILABLE' : row.redemptionId?.status || 'ISSUED';
    if (status === 'ISSUED' && row.expiresAt && new Date(row.expiresAt) <= new Date()) status = 'EXPIRED';
    return { id: String(row._id), code: require('../services/voucher-code.service').decrypt(row.encryptedCode), status, expiresAt: row.expiresAt || null, createdAt: row.createdAt || null, redeemedAt: row.redemptionId?.redeemedAt || null };
  });
  return { items, total, availableVoucherCount };
};
const assignVoucherCode = async (rewardId, userId, redemptionId, session) => {
  if (!env.useMongoDB) {
    const row = memoryVoucherCodes.find(item => item.rewardId === rewardId && item.status === 'AVAILABLE');
    if (!row) return null;
    row.status = 'ASSIGNED'; row.userId = userId; row.redemptionId = redemptionId;
    return row;
  }
  const row = await VoucherCode.findOneAndUpdate(
    { rewardId, status: 'AVAILABLE' },
    { $set: { status: 'ASSIGNED', userId, redemptionId } },
    { new: true, sort: { createdAt: 1, _id: 1 }, session }
  );
  return row;
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

const getRedemptionForPartnerCode = async (codeHash, partnerId) => {
  if (!env.useMongoDB) {
    const voucher = memoryVoucherCodes.find(row => row.codeHash === codeHash && row.status === 'ASSIGNED');
    if (!voucher) return null;
    const raw = redemptions.find(row => row.id === voucher.redemptionId);
    if (!raw) return null;
    const reward = rewards.find(row => row.id === raw.reward_id);
    if (!reward?.partnerId || String(reward.partnerId) !== String(partnerId)) return null;
    const redemption = toRedemption(raw);
    return { redemption, rewardTitle: reward.title, partnerId: String(reward.partnerId) };
  }
  const voucher = await VoucherCode.findOne({ codeHash, status: 'ASSIGNED' }).lean();
  if (!voucher?.redemptionId) return null;
  const raw = await Redemption.findById(voucher.redemptionId).populate('rewardId', 'title partnerId').lean();
  if (!raw?.rewardId?.partnerId || String(raw.rewardId.partnerId) !== String(partnerId)) return null;
  const user = await mongoose.model('User').findById(raw.userId).select('name').lean();
  return { redemption: toRedemption({ ...raw, rewardId: raw.rewardId._id }), rewardTitle: raw.rewardId.title, partnerId: String(raw.rewardId.partnerId), userName: user?.name || '' };
};

const getPartnerRedemptions = async partnerId => {
  if (!env.useMongoDB) {
    const rewardRows = rewards.filter(row => String(row.partnerId || '') === String(partnerId));
    const rewardById = new Map(rewardRows.map(row => [row.id, row]));
    const rows = redemptions.filter(row => rewardById.has(row.reward_id)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const items = rows.slice(0, 100).map(row => ({ ...toRedemption(row), rewardTitle: rewardById.get(row.reward_id)?.title || 'Reward' }));
    return { total: rows.length, used: rows.filter(row => row.status === 'REDEEMED').length, expired: rows.filter(row => row.status === 'ISSUED' && new Date(row.expires_at) <= new Date()).length, active: rows.filter(row => row.status === 'ISSUED' && new Date(row.expires_at) > new Date()).length, items };
  }
  const ownedRewards = await Reward.find({ partnerId }).select('_id title').lean();
  const ids = ownedRewards.map(row => row._id);
  if (!ids.length) return { total: 0, used: 0, items: [] };
  const filter = { rewardId: { $in: ids } };
  const now = new Date();
  const [total, used, expired, active, rows] = await Promise.all([
    Redemption.countDocuments(filter),
    Redemption.countDocuments({ ...filter, status: 'REDEEMED' }),
    Redemption.countDocuments({ ...filter, status: 'ISSUED', expiresAt: { $lte: now } }),
    Redemption.countDocuments({ ...filter, status: 'ISSUED', expiresAt: { $gt: now } }),
    Redemption.find(filter).sort({ createdAt: -1, _id: -1 }).limit(100).populate('rewardId', 'title').lean()
  ]);
  return { total, used, expired, active, items: rows.map(row => ({ ...toRedemption({ ...row, rewardId: row.rewardId?._id || row.rewardId }), rewardTitle: row.rewardId?.title || 'Reward' })) };
};

const markRedemptionUsed = async (id, { partnerId, staffId = null, staffEmail = null, partnerUsername = null }) => {
  const usedAt = new Date();
  if (!env.useMongoDB) {
    const row = redemptions.find(item => item.id === id);
    if (!row || row.status !== 'ISSUED' || new Date(row.expires_at) <= usedAt) return null;
    row.status = 'REDEEMED'; row.redeemed_at = usedAt.toISOString(); row.redeemedByPartnerId = partnerId; row.redeemedByStaffId = staffId; row.redeemedByStaffEmail = staffEmail; row.redeemedByPartnerUsername = partnerUsername;
    const reward = rewards.find(item => item.id === row.reward_id);
    return { redemption: toRedemption(row), rewardTitle: reward?.title || 'Reward', partnerId: String(partnerId) };
  }
  const row = await Redemption.findOneAndUpdate({ _id: id, status: 'ISSUED', expiresAt: { $gt: usedAt } }, { $set: { status: 'REDEEMED', redeemedAt: usedAt, redeemedByPartnerId: partnerId, redeemedByPartnerUsername: partnerUsername, redeemedByStaffId: staffId, redeemedByStaffEmail: staffEmail } }, { new: true }).populate('rewardId', 'title partnerId').lean();
  if (!row) return null;
  return { redemption: toRedemption({ ...row, rewardId: row.rewardId?._id || row.rewardId }), rewardTitle: row.rewardId?.title || 'Reward', partnerId: String(row.rewardId?.partnerId || partnerId) };
};

module.exports = {
  Reward,
  Redemption,
  memoryRedemptions: redemptions,
  VoucherCode,
  getActiveRewards,
  findRewardById,
  decrementStock,
  createRedemption,
  importVoucherCodes,
  countAvailableVoucherCodes,
  listVoucherCodes,
  assignVoucherCode,
  getRedemptionsByUserId,
  getRedemptionById,
  getRedemptionForPartnerCode,
  getPartnerRedemptions,
  markRedemptionUsed,
  listAllRewards,
  listAllRedemptions,
  createReward,
  updateReward,
  toReward,
  toRedemption
};
