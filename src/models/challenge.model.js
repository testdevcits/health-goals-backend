const mongoose = require('mongoose');
const env = require('../config/env');
const crypto = require('crypto');
const wallet = require('./wallet.model');

const schema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, default: '', maxlength: 1000 },
  metric: { type: String, enum: ['STEPS', 'WORKOUT_MINUTES', 'ACTIVE_MINUTES'], required: true },
  targetValue: { type: Number, required: true, min: 1 },
  month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  winnerMode: { type: String, enum: ['TOP_N', 'ALL_TARGET_MET'], default: 'TOP_N' },
  winnersCount: { type: Number, default: 3, min: 1 },
  rewardDescription: { type: String, default: '', maxlength: 300 },
  rewardPoints: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['DRAFT', 'PUBLISHED', 'PAUSED', 'ENDED'], default: 'DRAFT', index: true },
  participants: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, joinedAt: { type: Date, default: Date.now } }],
  results: [{ userId: String, name: String, value: Number, rank: Number, winner: Boolean }],
  finalizedAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
schema.index({ status: 1, startsAt: 1, endsAt: 1 });
schema.index({ status: 1, 'participants.userId': 1, startsAt: 1 });
const Challenge = mongoose.models.AdminChallenge || mongoose.model('AdminChallenge', schema);
const memoryChallenges = [];
const idOf = value => String(value?._id || value?.id || value);
const dto = row => ({
  id: idOf(row), title: row.title, description: row.description || '', metric: row.metric,
  targetValue: Number(row.targetValue), month: row.month, startsAt: row.startsAt, endsAt: row.endsAt,
  winnerMode: row.winnerMode || 'TOP_N', winnersCount: Number(row.winnersCount || 1),
  rewardDescription: row.rewardDescription || '', rewardPoints: Number(row.rewardPoints || 0),
  status: row.status, participantCount: Number(row.participantCount ?? (row.participants || []).length), results: row.results || [],
  finalizedAt: row.finalizedAt || null, createdAt: row.createdAt || row.created_at, updatedAt: row.updatedAt || row.updated_at
});
async function listAdmin() {
  const rows = env.useMongoDB
    ? await Challenge.find().populate('participants.userId', 'name email publicId').sort({ month: -1, createdAt: -1 }).lean()
    : [...memoryChallenges].sort((a,b)=>String(b.month).localeCompare(String(a.month)));
  const users = env.useMongoDB ? null : await require('./user.model').listUsers();
  return rows.map(row => ({
    ...dto(row),
    participants: (row.participants || []).map(participant => {
      const user = env.useMongoDB
        ? participant.userId
        : users.find(item => String(item.id) === idOf(participant.userId?._id || participant.userId));
      return {
        userId: idOf(user?._id || user?.id || participant.userId),
        name: user?.name || 'Member',
        email: user?.email || '',
        publicId: user?.publicId || null,
        joinedAt: participant.joinedAt || null
      };
    })
  }));
}
async function find(id) {
  if (env.useMongoDB) return mongoose.isValidObjectId(id) ? Challenge.findById(id) : null;
  return memoryChallenges.find(row => row.id === String(id)) || null;
}
async function create(data, adminId) {
  const value = { ...data, status: 'DRAFT', participants: [], results: [], createdBy: adminId, updatedBy: adminId };
  if (env.useMongoDB) return dto(await Challenge.create(value));
  const row = { ...value, id: crypto.randomUUID(), createdAt: new Date(), updatedAt: new Date() };
  memoryChallenges.unshift(row); return dto(row);
}
async function update(id, changes, adminId) {
  const current = await find(id); if (!current) return null;
  if (current.finalizedAt) return null;
  if (env.useMongoDB) return Challenge.findOneAndUpdate({ _id:id,status:current.status,finalizedAt:null }, { $set: { ...changes, updatedBy: adminId } }, { new: true, runValidators: true }).lean().then(row => row && dto(row));
  Object.assign(current, changes, { updatedBy: adminId, updatedAt: new Date() }); return dto(current);
}
async function publish(id, adminId) {
  const current = await find(id); if (!current) return null;
  if (current.finalizedAt || current.status === 'ENDED') return null;
  if (env.useMongoDB) return Challenge.findOneAndUpdate({ _id:id,status:current.status,finalizedAt:null }, { $set: { status: 'PUBLISHED', updatedBy: adminId } }, { new: true }).lean().then(row => row && dto(row));
  Object.assign(current, { status: 'PUBLISHED', updatedBy: adminId, updatedAt: new Date() }); return dto(current);
}
async function setStatus(id, status, adminId) {
  const current = await find(id); if (!current) return null;
  if (current.finalizedAt) return null;
  if (env.useMongoDB) return Challenge.findOneAndUpdate({ _id:id,finalizedAt:null }, { $set: { status, updatedBy: adminId } }, { new: true }).lean().then(row => row && dto(row));
  Object.assign(current, { status, updatedBy: adminId, updatedAt: new Date() }); return dto(current);
}
async function join(id, userId, now = new Date()) {
  const current = await find(id); if (!current) return null;
  if (current.status !== 'PUBLISHED') return { error: 'This challenge is not open for joining' };
  if (now < new Date(current.startsAt) || now >= new Date(current.endsAt)) return { error: 'This challenge is outside its join period' };
  if (env.useMongoDB) {
    await Challenge.updateOne({ _id: id, status: 'PUBLISHED', startsAt:{$lte:now},endsAt:{$gt:now}, 'participants.userId': { $ne: userId } }, { $push: { participants: { userId, joinedAt: now } } });
    return Challenge.findById(id).lean().then(dto);
  }
  if (!(current.participants || []).some(row => idOf(row.userId) === String(userId))) current.participants.push({ userId, joinedAt: now });
  return dto(current);
}
async function userChallenges(userId, now = new Date()) {
  let rows;
  if (env.useMongoDB) {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    rows = await Challenge.aggregate([
      { $match: {
      $or: [
        { status: 'PUBLISHED', endsAt: { $gt: now } },
        { 'participants.userId': userObjectId, status: { $in: ['PUBLISHED', 'PAUSED', 'ENDED'] } },
      ],
      } },
      { $addFields: {
        participantCount: { $size: { $ifNull: ['$participants', []] } },
        joined: { $in: [userObjectId, { $ifNull: ['$participants.userId', []] }] },
      } },
      { $addFields: {
        participants: { $cond: [
          '$joined',
          { $filter: { input: { $ifNull: ['$participants', []] }, as: 'participant', cond: { $eq: ['$$participant.userId', userObjectId] } } },
          [],
        ] },
      } },
      { $project: { title: 1, description: 1, metric: 1, targetValue: 1, month: 1, startsAt: 1, endsAt: 1, winnerMode: 1, winnersCount: 1, rewardDescription: 1, rewardPoints: 1, status: 1, participantCount: 1, participants: 1, results: 1, finalizedAt: 1, createdAt: 1, joined: 1 } },
      { $sort: { startsAt: 1 } },
    ]);
  } else {
    rows = memoryChallenges.filter(row =>
      (row.status === 'PUBLISHED' && new Date(row.endsAt) > now) ||
      (['PUBLISHED', 'PAUSED', 'ENDED'].includes(row.status) &&
       (row.participants || []).some(item => idOf(item.userId?._id || item.userId) === String(userId))),
    );
  }
  const visible = rows;
  const progressMap = await progressFor(visible, now, userId);
  return visible.map(row => {
    const base = dto(row), joined = row.joined ?? (row.participants || []).some(item => idOf(item.userId?._id||item.userId) === String(userId));
    const currentValue = joined ? (progressMap.get(`${base.id}:${userId}`) || 0) : 0;
    const status=row.status==='PUBLISHED'&&now>=new Date(row.endsAt)?'FINALIZING':row.status;
    return { ...base, status, joined, currentValue, progress: Math.min(100, Math.round(currentValue / base.targetValue * 100)), joinable: !joined && base.status === 'PUBLISHED' && now >= new Date(base.startsAt) && now < new Date(base.endsAt), leaderboard: joined ? (row.finalizedAt ? base.results : (progressMap.get(`${base.id}:leaderboard`) || [])) : [] };
  }).sort((a,b)=>Number(b.joined)-Number(a.joined)||new Date(a.startsAt)-new Date(b.startsAt));
}
async function communityChallengesForUser(userId, now = new Date()) {
  const community = require('./community.model');
  const [managed, legacy] = await Promise.all([
    userChallenges(userId, now),
    community.listChallenges(userId),
  ]);
  const metricType = { STEPS: 'steps', WORKOUT_MINUTES: 'workout', ACTIVE_MINUTES: 'active_minutes' };
  const managedItems = managed.map(item => ({
    ...item,
    metricType: metricType[item.metric] || String(item.metric || '').toLowerCase(),
    category: categoryForMetric(metricType[item.metric] || String(item.metric || '').toLowerCase()),
    legacy: false,
  }));
  const legacyItems = legacy.map(item => ({ ...item, category: categoryForMetric(item.metricType), legacy: true }));
  return [...managedItems, ...legacyItems].sort((a, b) => {
    if (Boolean(a.joined) !== Boolean(b.joined)) return Number(Boolean(b.joined)) - Number(Boolean(a.joined));
    return new Date(a.startsAt || 0) - new Date(b.startsAt || 0);
  });
}
function categoryForMetric(metricType) {
  if (metricType === 'steps') return 'steps';
  if (metricType === 'workout') return 'strength';
  if (metricType === 'meditation') return 'mind';
  return 'other';
}
async function getUserChallenge(id,userId,now=new Date()){
 const row=await find(id);if(!row)return null;
 const joined=(row.participants||[]).some(item=>idOf(item.userId)===String(userId));
 const joinable=row.status==='PUBLISHED'&&now>=new Date(row.startsAt)&&now<new Date(row.endsAt);
 if(!joined&&!joinable)return null;
 const progress=await progressFor([row],now),base=dto(row),currentValue=joined?(progress.get(`${base.id}:${userId}`)||0):0;
 return {...base,joined,joinable:!joined&&joinable,currentValue,progress:Math.min(100,Math.round(currentValue/base.targetValue*100)),leaderboard:joined?(row.finalizedAt?base.results:(progress.get(`${base.id}:leaderboard`)||[])):[]};
}
async function progressFor(challenges, now = new Date(), focusUserId = null) {
  const windows = challenges.map(row => ({ row, start: new Date(row.startsAt), end: new Date(row.endsAt) }));
  const participants = [...new Set(windows.flatMap(({row}) => (row.participants || []).map(item => idOf(item.userId?._id||item.userId))))];
  const trackedUserIds = focusUserId ? [String(focusUserId)] : participants;
  const health = require('./health.model');
  const start = windows.length ? new Date(Math.min(...windows.map(window => +window.start))) : now;
  const end = windows.length ? new Date(Math.min(+now, Math.max(...windows.map(window => +window.end)))) : now;
  const metrics = [...new Set(windows.map(({ row }) => row.metric === 'STEPS' ? 'steps' : row.metric === 'WORKOUT_MINUTES' ? 'workout' : 'active_minutes'))];
  const records = env.useMongoDB
    ? (trackedUserIds.length && windows.length ? await health.HealthRecord.find({ userId: { $in: trackedUserIds.map(id => mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : id) }, metricType: { $in: metrics }, recordedAt: { $gte: start, $lt: end }, deleted: { $ne: true } }).select('userId metricType value recordedAt source activityDate startTime endTime metadata deleted').lean().then(rows => rows.map(health.toHealthRecord)) : [])
    : health.healthRecords.filter(record =>
      (!focusUserId || String(record.user_id || record.userId) === String(focusUserId)) &&
      metrics.includes(record.metric_type || record.metricType) &&
      new Date(record.recorded_at || record.recordedAt) >= start &&
      new Date(record.recorded_at || record.recordedAt) < end,
    ).map(health.toHealthRecord);
  const users = focusUserId ? [] : await require('./user.model').listUsers();
  const output = new Map();
  for (const {row,start,end} of windows) {
    const people = focusUserId
      ? ((row.participants || []).some(item => idOf(item.userId?._id || item.userId) === String(focusUserId)) ? [String(focusUserId)] : [])
      : (row.participants || []).map(item => idOf(item.userId?._id||item.userId));
    const byUser = new Map(people.map(id => [id, 0]));
    for (const record of records) {
      const userId = String(record.userId?._id||record.userId || record.user_id), day = record.activityDate || istDay(record.recordedAt);
      const date = new Date(`${day}T00:00:00+05:30`);
      if (!byUser.has(userId) || record.deleted || date < start || date >= end || new Date(record.recordedAt) > now || date > new Date(`${istDay(now)}T00:00:00+05:30`)) continue;
      if (row.metric === 'STEPS' && record.metricType === 'steps' && record.source === 'health_connect' && (record.metadata?.aggregation === 'daily_total' || record.metadata?.aggregationScope === 'health_connect')) byUser.set(userId, byUser.get(userId) + Number(record.value));
      if (row.metric === 'WORKOUT_MINUTES' && record.metricType === 'workout' && record.startTime && record.endTime) byUser.set(userId, byUser.get(userId) + Math.max(0, +new Date(record.endTime) - +new Date(record.startTime)) / 60000);
      if (row.metric === 'ACTIVE_MINUTES' && record.metricType === 'active_minutes') byUser.set(userId, byUser.get(userId) + Number(record.value));
    }
    for (const [userId,value] of byUser) output.set(`${idOf(row)}:${userId}`, Math.round(value));
    const ranking = people.map(userId => { const user = users.find(item => String(item.id) === userId); return { id: userId, userId, name: user?.name || 'Member', value: Math.round(byUser.get(userId) || 0) }; }).sort((a,b)=>b.value-a.value||a.id.localeCompare(b.id));
    let rank = 0, previous = null;
    const ranked = ranking.map((item,index)=>{ if(item.value!==previous)rank=index+1; previous=item.value; return {...item,rank,progress:Math.min(100,item.value/Number(row.targetValue)*100),achieved:item.value>=Number(row.targetValue)}; });
    output.set(`${idOf(row)}:leaderboard`, ranked);
  }
  return output;
}
function istDay(value) { return new Date(+new Date(value) + 330 * 60000).toISOString().slice(0,10); }
async function finalizeDue(now = new Date(), notify = async () => {}) {
  const due = env.useMongoDB ? await Challenge.find({ status: { $in: ['PUBLISHED','PAUSED'] }, endsAt: { $lte: now }, finalizedAt: null }) : memoryChallenges.filter(row => ['PUBLISHED','PAUSED'].includes(row.status) && !row.finalizedAt && new Date(row.endsAt) <= now);
  let finalized = 0;
  for (const row of due) {
    const progress = await progressFor([row], now), leaderboard = progress.get(`${idOf(row)}:leaderboard`) || [];
    const qualifying = row.winnerMode === 'ALL_TARGET_MET' ? leaderboard.filter(item => item.achieved) : (leaderboard[0]?.rank > 0 ? leaderboard.filter(item => item.rank <= Number(row.winnersCount || 1)) : []);
    const winners = new Set(qualifying.map(item => item.id));
    const results = leaderboard.map(({id,name,value,rank}) => ({ userId:id, name, value, rank, winner:winners.has(id) }));
    if (row.rewardPoints > 0) for (const winnerId of winners) {
      const walletUserId=env.useMongoDB?new mongoose.Types.ObjectId(winnerId):winnerId;
      try { await wallet.createTransaction({ userId:walletUserId, type:'BONUS', amount:row.rewardPoints, referenceType:'CHALLENGE_WIN', referenceId:idOf(row), description:`Winner bonus: ${row.title}`, idempotencyKey:`challenge:${idOf(row)}:winner:${winnerId}` }); }
      catch(error){ if(error.code!==11000)throw error; }
    }
    if (env.useMongoDB) {
      const saved = await Challenge.findOneAndUpdate({ _id: row._id, finalizedAt: null }, { $set: { status: 'ENDED', results, finalizedAt: now } }, { new: true });
      if (!saved) continue;
    } else Object.assign(row, { status:'ENDED', results, finalizedAt:now });
    for (const item of results) await notify(item.userId, { type:'CHALLENGE_RESULT', title: winners.has(item.userId) ? `You won ${row.title}!` : `${row.title} results are ready`, body: winners.has(item.userId) ? `You ranked #${item.rank} with ${item.value.toLocaleString()} ${row.metric.toLowerCase().replaceAll('_',' ')}.` : `Final rank #${item.rank} · ${item.value.toLocaleString()} recorded.`, data:{challengeId:idOf(row)}, key:`challenge:${idOf(row)}:result:${item.userId}` });
    finalized++;
  }
  return { finalized };
}
module.exports = { Challenge, dto, listAdmin, find, create, update, publish, setStatus, join, userChallenges, communityChallengesForUser, getUserChallenge, progressFor, finalizeDue, memoryChallenges };
