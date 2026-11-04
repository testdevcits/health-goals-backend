const env = require('../config/env');
const users = require('../models/user.model');
const health = require('../models/health.model');
const community = require('../models/community.model');
const { AppError } = require('../middleware/error.middleware');
const { calculate, dayKey } = require('./daily-rules');

function monthRange(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new AppError('month must use YYYY-MM format', 400);
  const [year, monthNumber] = month.split('-').map(Number);
  const startLocal = new Date(Date.UTC(year, monthNumber - 1, 1) - 330 * 60000);
  const endLocal = new Date(Date.UTC(year, monthNumber, 1) - 330 * 60000);
  const nowLocal = new Date(Date.now() + 330 * 60000);
  const currentMonth = `${nowLocal.getUTCFullYear()}-${String(nowLocal.getUTCMonth() + 1).padStart(2, '0')}`;
  if (month >= currentMonth) throw new AppError('Ticket rewards are available only for a completed month', 400);
  return { start: startLocal, end: endLocal };
}

async function recordsForMonth(month) {
  const { start, end } = monthRange(month);
  if (env.useMongoDB) return (await health.HealthRecord.find({ metricType: 'steps', deleted: { $ne: true }, recordedAt: { $gte: start, $lt: end } }).lean()).map(health.toHealthRecord);
  return health.healthRecords.filter(row => row.metric_type === 'steps' && !row.deleted && new Date(row.recorded_at) >= start && new Date(row.recorded_at) < end).map(health.toHealthRecord);
}

function userMonthTotals(records) {
  const byUserDay = new Map();
  for (const row of records) {
    const userId = String(row.userId);
    const day = row.activityDate || dayKey(row.recordedAt);
    const key = `${userId}:${day}`;
    if (!byUserDay.has(key)) byUserDay.set(key, { userId, rows: [] });
    byUserDay.get(key).rows.push(row);
  }
  const totals = new Map();
  for (const { userId, rows } of byUserDay.values()) totals.set(userId, (totals.get(userId) || 0) + calculate(rows).steps);
  return totals;
}

async function leaderboard(month, audience) {
  monthRange(month);
  if (!['INDIVIDUAL', 'GROUP'].includes(audience)) throw new AppError('audience must be INDIVIDUAL or GROUP', 400);
  const [allUsers, records] = await Promise.all([users.listUsers(), recordsForMonth(month)]);
  const eligibleUsers = allUsers.filter(user => user.role !== 'ADMIN' && user.status !== 'SUSPENDED');
  const byId = new Map(eligibleUsers.map(user => [String(user.id || user._id), user]));
  const totals = userMonthTotals(records);
  if (audience === 'INDIVIDUAL') {
    return [...byId.entries()].map(([id, user]) => ({ id, name: user.name || 'User', email: user.email, profileImageUrl: user.profileImageUrl || '', steps: totals.get(id) || 0, rank: 0 }))
      .sort((a,b) => b.steps-a.steps || a.name.localeCompare(b.name)).map((row,index) => ({ ...row, rank: index + 1 }));
  }
  const groups = env.useMongoDB ? await community.Group.find().lean() : community.memoryGroups;
  return groups.map(group => {
    const members = (group.members || []).map(member => String(member.userId?._id || member.userId || member));
    const leaderId = String(group.createdBy?._id || group.createdBy || '');
    const leader = byId.get(leaderId);
    const memberSnapshot = members.map(id => ({ id, name: byId.get(id)?.name || 'Member', email: byId.get(id)?.email || '', steps: totals.get(id) || 0, role: id === leaderId ? 'GL' : 'MEMBER' }));
    return { id: String(group._id || group.id), name: group.name || 'Group', imageUrl: group.imageUrl || null, leaderId, leaderName: leader?.name || 'Group leader', leaderEmail: leader?.email || '', members: memberSnapshot, memberCount: memberSnapshot.length, steps: memberSnapshot.reduce((sum, member) => sum + member.steps, 0), rank: 0 };
  }).sort((a,b) => b.steps-a.steps || a.name.localeCompare(b.name)).map((row,index) => ({ ...row, rank: index + 1 }));
}

module.exports = { leaderboard, monthRange };
