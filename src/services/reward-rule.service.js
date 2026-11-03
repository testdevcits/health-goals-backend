const crypto = require('crypto');
const mongoose = require('mongoose');
const env = require('../config/env');
const { AppError } = require('../middleware/error.middleware');
const userModel = require('../models/user.model');
const community = require('../models/community.model');

const schema = new mongoose.Schema({
  duplicateKey: { type: String },
  seedKey: { type: String },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  ruleType: { type: String, enum: ['BADGE', 'LEADERBOARD', 'CHALLENGE'], default: 'BADGE' },
  audience: { type: String, enum: ['INDIVIDUAL', 'GROUP'], required: true },
  targetUserId: { type: String, default: null, index: true },
  targetGroupId: { type: String, default: null, index: true },
  metric: { type: String, enum: ['STEPS', 'WORKOUT_HOURS', 'MEDITATION_HOURS'], required: true },
  targetValue: { type: Number, required: true, min: 1, max: 100000000 },
  period: { type: String, enum: ['WEEKLY', 'MONTHLY', 'DURATION'], default: 'MONTHLY' },
  durationDays: { type: Number, default: null, min: 1, max: 30 },
  winnersCount: { type: Number, default: 1, min: 1, max: 1000 },
  badgeTitle: { type: String, trim: true, maxlength: 60, default: '' },
  bonusPoints: { type: Number, default: 0, min: 0, max: 100000 },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
schema.index({ seedKey: 1 }, { unique: true, sparse: true });
schema.index({ duplicateKey: 1 }, { unique: true, sparse: true });
schema.index({ status: 1, audience: 1, createdAt: -1 });
const RewardRule = mongoose.model('AdminRewardRule', schema);
const memoryRules = [];
const idOf = row => String(row?._id || row?.id);
const dto = row => ({ id: idOf(row), title: row.title, ruleType: row.ruleType || 'BADGE', audience: row.audience, targetUserId: row.targetUserId || null, targetGroupId: row.targetGroupId || null, targetValue: row.targetValue, metric: row.metric, period: row.period || 'MONTHLY', durationDays: row.durationDays || null, winnersCount: row.winnersCount || 1, badgeTitle: row.badgeTitle || '', bonusPoints: row.bonusPoints || 0, status: row.status, createdAt: row.createdAt || row.created_at, updatedAt: row.updatedAt || row.updated_at });

function validate(input, partial = false) {
  const body = input || {};
  const allowed = ['title', 'ruleType', 'audience', 'targetUserId', 'targetGroupId', 'metric', 'targetValue', 'period', 'durationDays', 'winnersCount', 'badgeTitle', 'bonusPoints', 'status'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new AppError('Unsupported reward rule field', 400);
  const data = {};
  for (const key of allowed) if (body[key] !== undefined) data[key] = body[key];
  if (!partial || data.title !== undefined) {
    if (typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 100) throw new AppError('Rule name must be 1 to 100 characters', 400);
    data.title = data.title.trim();
  }
  if (!partial || data.audience !== undefined) if (!['INDIVIDUAL', 'GROUP'].includes(data.audience)) throw new AppError('Choose individual or group scope', 400);
  for (const field of ['targetUserId','targetGroupId']) if (data[field] !== undefined && data[field] !== null && (typeof data[field] !== 'string' || data[field].length > 100)) throw new AppError(`Invalid ${field}`,400);
  if (!partial && data.targetUserId === undefined) data.targetUserId = null;
  if (!partial && data.targetGroupId === undefined) data.targetGroupId = null;
  if (!partial || data.ruleType !== undefined) {
    if (data.ruleType === undefined && !partial) data.ruleType = 'BADGE';
    else if (!['BADGE', 'LEADERBOARD', 'CHALLENGE'].includes(data.ruleType)) throw new AppError('Choose a badge, leaderboard, or challenge rule', 400);
  }
  if (!partial || data.metric !== undefined) if (!['STEPS', 'WORKOUT_HOURS', 'MEDITATION_HOURS'].includes(data.metric)) throw new AppError('Choose a supported activity target', 400);
  if (!partial || data.targetValue !== undefined) if (!Number.isSafeInteger(data.targetValue) || data.targetValue < 1 || data.targetValue > 100000000) throw new AppError('Target must be a positive whole number', 400);
  if (!partial || data.period !== undefined) {
    if (data.period === undefined && !partial) data.period = 'MONTHLY';
    else if (!['WEEKLY', 'MONTHLY', 'DURATION'].includes(data.period)) throw new AppError('Choose a weekly, monthly, or duration-based period', 400);
  }
  if (data.period === 'DURATION' && (data.durationDays === undefined || !Number.isSafeInteger(data.durationDays) || data.durationDays < 1 || data.durationDays > 30)) throw new AppError('Duration must be between 1 and 30 days', 400);
  if (data.durationDays !== undefined && data.durationDays !== null && (!Number.isSafeInteger(data.durationDays) || data.durationDays < 1 || data.durationDays > 30)) throw new AppError('Duration must be between 1 and 30 days', 400);
  if (!partial && data.durationDays === undefined) data.durationDays = null;
  if (data.winnersCount !== undefined && (!Number.isSafeInteger(data.winnersCount) || data.winnersCount < 1 || data.winnersCount > 1000)) throw new AppError('Winner count must be between 1 and 1000', 400);
  if (!partial && data.winnersCount === undefined) data.winnersCount = 1;
  if (!partial || data.badgeTitle !== undefined) {
    data.badgeTitle = typeof data.badgeTitle === 'string' ? data.badgeTitle.trim() : '';
    if (data.badgeTitle.length > 60) throw new AppError('Badge name must be no more than 60 characters', 400);
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
async function options() {
  const allUsers=env.useMongoDB
    ? await userModel.User.find({role:'USER'}).select('name email publicId status').sort({name:1,_id:1}).lean()
    : (await userModel.listUsers()).filter(user=>user.role!=='ADMIN').sort((a,b)=>a.name.localeCompare(b.name));
  const users=allUsers.map(user=>({id:String(user._id||user.id),name:user.name,email:user.email,publicId:user.publicId||null,status:user.status||'ACTIVE'}));
  const groups=env.useMongoDB
    ? await community.Group.find().select('name description emoji isPrivate maxMembers members createdAt').sort({createdAt:-1,_id:-1}).lean()
    : community.memoryGroups;
  const userById=new Map(users.map(user=>[user.id,user]));
  return {users,groups:groups.map(group=>({id:String(group._id||group.id),name:group.name,description:group.description||'',emoji:group.emoji||'🏃',private:Boolean(group.isPrivate??group.private),memberCount:(group.members||[]).length,maxMembers:Number(group.maxMembers||50),members:(group.members||[]).map(member=>userById.get(String(member.userId?._id||member.userId||member))||null).filter(Boolean)}))};
}
async function validateAudience(data) {
  if (data.audience==='GROUP') {
    if (!data.targetGroupId) throw new AppError('Select the group this rule applies to',400);
    if(env.useMongoDB&&!mongoose.isValidObjectId(data.targetGroupId))throw new AppError('Selected group was not found. Refresh group options.',404);
    const exists=env.useMongoDB ? await community.Group.exists({_id:data.targetGroupId}) : community.memoryGroups.some(group=>String(group.id)===data.targetGroupId);
    if (!exists) throw new AppError('Selected group was not found. Refresh group options.',404);
    data.targetUserId=null;
  } else {
    data.targetGroupId=null;
    if(data.targetUserId){
      if(env.useMongoDB&&!mongoose.isValidObjectId(data.targetUserId))throw new AppError('Selected active user was not found. Refresh user options.',404);
      const exists=env.useMongoDB?await userModel.User.exists({_id:data.targetUserId,status:'ACTIVE',role:'USER'}):(await userModel.listUsers()).some(user=>String(user.id)===data.targetUserId&&user.status==='ACTIVE'&&user.role!=='ADMIN');
      if(!exists)throw new AppError('Selected active user was not found. Refresh user options.',404);
    }
  }
  return data;
}
// Names and status do not change the goal: prevent the same configuration twice.
function duplicateKey(data) {
  return crypto.createHash('sha256').update(JSON.stringify([
    data.ruleType || 'BADGE', data.audience, data.targetUserId || null,
    data.targetGroupId || null, data.metric, Number(data.targetValue),
    data.period || 'MONTHLY', data.period === 'DURATION' ? Number(data.durationDays) : null,
    data.ruleType === 'LEADERBOARD' ? Number(data.winnersCount || 1) : 1,
    (data.badgeTitle || '').trim().toLowerCase(), Number(data.bonusPoints || 0)
  ])).digest('hex');
}
async function ensureUnique(data, excludeId) {
  const key = duplicateKey(data);
  const rows = env.useMongoDB ? await RewardRule.find(excludeId ? { _id: { $ne: excludeId } } : {}).lean() : memoryRules.filter(row => row.id !== excludeId);
  if (rows.some(row => duplicateKey(row) === key)) throw new AppError('This reward rule already exists. Edit the existing rule instead.', 409);
  return key;
}
function duplicateError(error) {
  if (error.code === 11000) throw new AppError('This reward rule already exists. Edit the existing rule instead.', 409);
  throw error;
}
async function create(input, adminId, now = new Date()) {
  const data = await validateAudience(validate(input));
  const key = await ensureUnique(data);
  const row = { ...data, duplicateKey: key, createdBy: adminId, updatedBy: adminId };
  if (env.useMongoDB) { try { return dto(await RewardRule.create(row)); } catch (error) { duplicateError(error); } }
  if (memoryRules.some(item => duplicateKey(item) === key)) throw new AppError('This reward rule already exists. Edit the existing rule instead.', 409);
  const saved = { ...row, id: crypto.randomUUID(), created_at: now.toISOString(), updated_at: now.toISOString() };
  memoryRules.unshift(saved);
  return dto(saved);
}
async function update(id, input, adminId, now = new Date()) {
  const data = validate(input, true);
  const existing=env.useMongoDB?(mongoose.isValidObjectId(id)?await RewardRule.findById(id).lean():null):memoryRules.find(item=>item.id===id);
  if(!existing)return null;
  if(data.audience!==undefined||data.targetUserId!==undefined||data.targetGroupId!==undefined){
    const current=env.useMongoDB?(mongoose.isValidObjectId(id)?await RewardRule.findById(id).lean():null):memoryRules.find(item=>item.id===id);
    if(!current)return null;
    const resolved=await validateAudience({...current,...data,audience:data.audience||current.audience});
    Object.assign(data,{targetUserId:resolved.targetUserId,targetGroupId:resolved.targetGroupId});
  }
  data.duplicateKey = await ensureUnique({...existing,...data}, id);
  if (env.useMongoDB) {
    if (!mongoose.isValidObjectId(id)) return null;
    let row;
    try { row = await RewardRule.findByIdAndUpdate(id, { $set: { ...data, updatedBy: adminId } }, { new: true, runValidators: true }).lean(); } catch (error) { duplicateError(error); }
    return row ? dto(row) : null;
  }
  const row = memoryRules.find(item => item.id === id);
  if (!row) return null;
  Object.assign(row, data, { updatedBy: adminId, updated_at: now.toISOString() });
  return dto(row);
}
async function remove(id) {
  if(env.useMongoDB){if(!mongoose.isValidObjectId(id))return null;const row=await RewardRule.findByIdAndDelete(id).lean();return row?dto(row):null;}
  const index=memoryRules.findIndex(row=>row.id===id);if(index<0)return null;
  return dto(memoryRules.splice(index,1)[0]);
}
module.exports = { RewardRule, list, options, create, update, remove };
