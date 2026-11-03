const crypto = require('crypto');
const mongoose = require('mongoose');
const env = require('../config/env');
const { AppError } = require('../middleware/error.middleware');

const schema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 100 },
  audience: { type: String, enum: ['INDIVIDUAL', 'GROUP'], required: true },
  metric: { type: String, enum: ['STEPS', 'WORKOUT_HOURS', 'MEDITATION_HOURS'], required: true },
  targetValue: { type: Number, required: true, min: 1, max: 100000000 },
  period: { type: String, enum: ['MONTHLY'], default: 'MONTHLY' },
  badgeTitle: { type: String, required: true, trim: true, maxlength: 60 },
  bonusPoints: { type: Number, default: 0, min: 0, max: 100000 },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
schema.index({ status: 1, audience: 1, createdAt: -1 });
const RewardRule = mongoose.model('AdminRewardRule', schema);
const memoryRules = [];
const idOf = row => String(row?._id || row?.id);
const dto = row => ({ id: idOf(row), title: row.title, audience: row.audience, metric: row.metric, targetValue: row.targetValue, period: row.period || 'MONTHLY', badgeTitle: row.badgeTitle, bonusPoints: row.bonusPoints || 0, status: row.status, createdAt: row.createdAt || row.created_at, updatedAt: row.updatedAt || row.updated_at });

function validate(input, partial = false) {
  const body = input || {};
  const allowed = ['title', 'audience', 'metric', 'targetValue', 'period', 'badgeTitle', 'bonusPoints', 'status'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new AppError('Unsupported reward rule field', 400);
  const data = {};
  for (const key of allowed) if (body[key] !== undefined) data[key] = body[key];
  if (!partial || data.title !== undefined) {
    if (typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 100) throw new AppError('Rule name must be 1 to 100 characters', 400);
    data.title = data.title.trim();
  }
  if (!partial || data.audience !== undefined) if (!['INDIVIDUAL', 'GROUP'].includes(data.audience)) throw new AppError('Choose individual or group scope', 400);
  if (!partial || data.metric !== undefined) if (!['STEPS', 'WORKOUT_HOURS', 'MEDITATION_HOURS'].includes(data.metric)) throw new AppError('Choose a supported activity target', 400);
  if (!partial || data.targetValue !== undefined) if (!Number.isSafeInteger(data.targetValue) || data.targetValue < 1 || data.targetValue > 100000000) throw new AppError('Target must be a positive whole number', 400);
  if (!partial || data.period !== undefined) if (data.period !== 'MONTHLY') throw new AppError('Only monthly reward rules are currently supported', 400);
  if (!partial || data.badgeTitle !== undefined) {
    if (typeof data.badgeTitle !== 'string' || !data.badgeTitle.trim() || data.badgeTitle.trim().length > 60) throw new AppError('Badge name must be 1 to 60 characters', 400);
    data.badgeTitle = data.badgeTitle.trim();
  }
  if (data.bonusPoints === undefined && !partial) data.bonusPoints = 0;
  if (data.bonusPoints !== undefined && (!Number.isSafeInteger(data.bonusPoints) || data.bonusPoints < 0 || data.bonusPoints > 100000)) throw new AppError('Points bonus must be between 0 and 100000', 400);
  if (!partial || data.status !== undefined) {
    if (data.status === undefined && !partial) data.status = 'ACTIVE';
    else if (!['ACTIVE', 'INACTIVE'].includes(data.status)) throw new AppError('Invalid reward rule status', 400);
  }
  if (partial && !Object.keys(data).length) throw new AppError('Provide at least one field to update', 400);
  return data;
}

async function list() {
  const rows = env.useMongoDB ? await RewardRule.find().sort({ createdAt: -1, _id: -1 }).lean() : [...memoryRules].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { items: rows.map(dto), total: rows.length };
}
async function create(input, adminId, now = new Date()) {
  const data = validate(input);
  const row = { ...data, createdBy: adminId, updatedBy: adminId };
  if (env.useMongoDB) return dto(await RewardRule.create(row));
  const saved = { ...row, id: crypto.randomUUID(), created_at: now.toISOString(), updated_at: now.toISOString() };
  memoryRules.unshift(saved);
  return dto(saved);
}
async function update(id, input, adminId, now = new Date()) {
  const data = validate(input, true);
  if (env.useMongoDB) {
    if (!mongoose.isValidObjectId(id)) return null;
    const row = await RewardRule.findByIdAndUpdate(id, { $set: { ...data, updatedBy: adminId } }, { new: true, runValidators: true }).lean();
    return row ? dto(row) : null;
  }
  const row = memoryRules.find(item => item.id === id);
  if (!row) return null;
  Object.assign(row, data, { updatedBy: adminId, updated_at: now.toISOString() });
  return dto(row);
}
module.exports = { RewardRule, list, create, update };
