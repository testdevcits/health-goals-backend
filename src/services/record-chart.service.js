const env = require('../config/env');
const health = require('../models/health.model');
const { buildQuery } = require('./admin-query.service');
const { dayKey } = require('./daily-rules');
const { TOTAL_METRICS, sampleWeight, mongoSampleWeight } = require('./health-metrics');
async function chart(userId, params = {}) {
  const { query } = buildQuery('records', { ...params, userId, q: '' });
  if (env.useMongoDB) {
    query.userId = new (require('mongoose').Types.ObjectId)(userId);
    return { items: await health.HealthRecord.aggregate([
      { $match: { ...query, deleted: { $ne: true } } },
      { $group: {
        _id: { day: { $dateToString: { date: '$recordedAt', format: '%Y-%m-%d', timezone: 'Asia/Kolkata' } }, metric: '$metricType', unit: '$unit', component: { $ifNull: ['$metadata.component', null] } },
        total: { $sum: '$value' }, weightedTotal: { $sum: { $multiply: ['$value', mongoSampleWeight] } }, sampleCount: { $sum: mongoSampleWeight },
        count: { $sum: 1 }, min: { $min: '$value' }, max: { $max: '$value' },
      } },
      { $sort: { '_id.day': 1, '_id.metric': 1, '_id.component': 1 } },
      { $project: { _id: 0, day: '$_id.day', metric: '$_id.metric', unit: '$_id.unit', component: '$_id.component', value: { $cond: [{ $in: ['$_id.metric', TOTAL_METRICS] }, '$total', { $divide: ['$weightedTotal', '$sampleCount'] }] }, count: 1, sampleCount: 1, min: 1, max: 1 } },
    ]).option({ maxTimeMS: 10000 }) };
  }
  const groups = new Map();
  for (const row of await health.listAdmin()) {
    if (String(row.userId) !== userId || row.deleted || params.metricType && row.metricType !== params.metricType) continue;
    const timestamp = new Date(row.recordedAt);
    if (query.recordedAt?.$gte && timestamp < query.recordedAt.$gte || query.recordedAt?.$lte && timestamp > query.recordedAt.$lte) continue;
    const day = dayKey(timestamp), key = JSON.stringify([day, row.metricType, row.unit, row.metadata?.component]);
    const group = groups.get(key) || { day, metric: row.metricType, unit: row.unit, component: row.metadata?.component || null, value: 0, weightedTotal: 0, sampleCount: 0, count: 0, min: Infinity, max: -Infinity };
    group.value += Number(row.value); group.weightedTotal += Number(row.value) * sampleWeight(row); group.sampleCount += sampleWeight(row); group.count++;
    group.min = Math.min(group.min, row.value); group.max = Math.max(group.max, row.value); groups.set(key, group);
  }
  return { items: [...groups.values()].map(({ weightedTotal, ...row }) => ({ ...row, value: TOTAL_METRICS.includes(row.metric) ? row.value : weightedTotal / row.sampleCount })).sort((a, b) => a.day.localeCompare(b.day)) };
}
module.exports = { chart };
