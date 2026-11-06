const mongoose = require('mongoose');
const env = require('../config/env');
const crypto = require('crypto');
const { TOTAL_METRICS, sampleWeight, mongoSampleWeight } = require('../services/health-metrics');

const healthRecordSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    metricType: {
      type: String,
      required: true,
      index: true
    },
    value: {
      type: Number,
      required: true
    },
    unit: {
      type: String,
      required: true
    },
    recordedAt: {
      type: Date,
      required: true,
      index: true
    },
    source: {
      type: String,
      required: true
    },
    sourceRecordId: {
      type: String,
      required: true
    },
    deviceId: {
      type: String,
      default: null
    },
    activityDate: { type: String, index: true },
    startTime: Date, endTime: Date, dataOrigin: String, recordingMethod: String, activityType: String,
    sourceVersion: { type: Number, default: 1 }, deleted: { type: Boolean, default: false },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false
    }
  }
);

healthRecordSchema.index({ userId: 1, recordedAt: -1 });
healthRecordSchema.index({ userId: 1, metricType: 1, recordedAt: -1, _id: -1 });
healthRecordSchema.index({ userId: 1, source: 1, sourceRecordId: 1 }, { unique: true });

healthRecordSchema.index({ recordedAt: -1, _id: -1 });
healthRecordSchema.index({ metricType: 1, recordedAt: -1, _id: -1 });
healthRecordSchema.index({ userId: 1, recordedAt: -1, _id: -1 });
healthRecordSchema.index({ createdAt: -1 });
healthRecordSchema.index({ userId: 1, activityDate: 1, deleted: 1 });
healthRecordSchema.index({ userId: 1, metricType: 1, activityDate: 1, deleted: 1 });
const HealthRecord = mongoose.model('HealthRecord', healthRecordSchema);
const healthRecords = [];

const toHealthRecord = (record) => ({
  id: record.id || record._id.toString(),
  userId: record.userId || record.user_id,
  metricType: record.metricType || record.metric_type,
  value: Number(record.value),
  unit: record.unit,
  recordedAt: record.recordedAt || record.recorded_at,
  source: record.source,
  sourceRecordId: record.sourceRecordId || record.source_record_id,
  deviceId: record.deviceId || record.device_id,
  activityDate: record.activityDate, startTime: record.startTime, endTime: record.endTime,
  dataOrigin: record.dataOrigin, recordingMethod: record.recordingMethod, activityType: record.activityType,
  sourceVersion: record.sourceVersion || 1, deleted: record.deleted || false,
  metadata: record.metadata || {},
  createdAt: record.createdAt || record.created_at
});

const createHealthRecord = async ({
  userId,
  metricType,
  value,
  unit,
  recordedAt,
  source,
  sourceRecordId,
  deviceId = null,
  metadata = {},
  ...extra
}, session = null) => {
  if (!env.useMongoDB) {
    const record = {
      ...extra,
      id: crypto.randomUUID(),
      user_id: userId,
      metric_type: metricType,
      value,
      unit,
      recorded_at: new Date(recordedAt).toISOString(),
      source,
      source_record_id: sourceRecordId,
      device_id: deviceId,
      metadata,
      created_at: new Date().toISOString()
    };

    healthRecords.push(record);
    return toHealthRecord(record);
  }

  const [record] = await HealthRecord.create([{
    ...extra,
    userId,
    metricType,
    value,
    unit,
    recordedAt,
    source,
    sourceRecordId,
    deviceId,
    metadata
  }], { session });

  return toHealthRecord(record);
};

const findBySourceRecord = async (userId, source, sourceRecordId) => {
  if (!sourceRecordId) return null;

  if (!env.useMongoDB) {
    const record = healthRecords.find(
      (row) =>
        row.user_id === userId &&
        row.source === source &&
        row.source_record_id === sourceRecordId
    );
    return record ? toHealthRecord(record) : null;
  }

  const record = await HealthRecord.findOne({ userId, source, sourceRecordId });
  return record ? toHealthRecord(record) : null;
};

const pruneHealthConnectRecords = async (userId, before, protectedActivityDates = []) => {
  if (env.useMongoDB) {
    const result = await HealthRecord.deleteMany({ userId, source: 'health_connect', recordedAt: { $lt: before }, activityDate: { $nin: protectedActivityDates } });
    return result.deletedCount || 0;
  }
  let deleted = 0;
  for (let index = healthRecords.length - 1; index >= 0; index -= 1) {
    const record = healthRecords[index];
    if (String(record.user_id) === String(userId) && record.source === 'health_connect' && new Date(record.recorded_at) < before && !protectedActivityDates.includes(record.activityDate)) {
      healthRecords.splice(index, 1);
      deleted += 1;
    }
  }
  return deleted;
};

const getHealthRecordsByUserId = async (userId, filters = {}) => {
  const from = filters.from ? new Date(filters.from) : null;
  const to = filters.to ? new Date(filters.to) : null;
  if (!env.useMongoDB) {
    return healthRecords
      .filter((record) => record.user_id === userId && !record.deleted)
      .filter((record) => !filters.metricType || record.metric_type === filters.metricType)
      .filter((record) => !from || new Date(record.recorded_at) >= from)
      .filter((record) => !to || new Date(record.recorded_at) <= to)
      .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at) || b.id.localeCompare(a.id))
      .slice(filters.offset || 0, (filters.offset || 0) + (filters.limit || 100))
      .map(toHealthRecord);
  }

  const query = { userId, deleted: { $ne: true } };

  if (filters.metricType) {
    query.metricType = filters.metricType;
  }
  if (from || to) query.recordedAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

  const records = await HealthRecord.find(query)
    .sort({ recordedAt: -1, _id: -1 })
    .skip(filters.offset || 0)
    .limit(filters.limit || 100)
    .lean().maxTimeMS(10000);

  return records.map(toHealthRecord);
};

const getDailyHealthHistory = async (userId, { metricType, from, to }) => {
  const start = new Date(from), end = new Date(to);
  const isTotal = require('../services/health-metrics').TOTAL_METRICS.includes(metricType);
  if (!env.useMongoDB) {
    const groups = new Map();
    healthRecords.filter(row => row.user_id === userId && row.metric_type === metricType && !row.deleted && new Date(row.recorded_at) >= start && new Date(row.recorded_at) <= end).forEach(row => {
      const date = row.activityDate || require('../services/daily-rules').dayKey(row.recorded_at);
      const component = row.metadata?.component || null;
      const key = `${date}:${component || ''}`;
      const item = groups.get(key) || { date, component, value: 0, weightedTotal: 0, sampleCount: 0, count: 0, unit: row.unit };
      item.value += Number(row.value); item.weightedTotal += Number(row.value) * sampleWeight(row); item.sampleCount += sampleWeight(row); item.count += 1; groups.set(key, item);
    });
    return [...groups.values()].map(({weightedTotal,...row}) => ({...row, value: isTotal ? row.value : weightedTotal / row.sampleCount})).sort((a,b) => a.date.localeCompare(b.date));
  }
  const rows = await HealthRecord.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId), metricType, deleted: { $ne: true }, recordedAt: { $gte: start, $lte: end } } },
    { $group: { _id: { date: { $ifNull: ['$activityDate', { $dateToString: { date: '$recordedAt', format: '%Y-%m-%d', timezone: 'Asia/Kolkata' } }] }, component: { $ifNull: ['$metadata.component', null] } }, value: { $sum: '$value' }, weightedTotal: { $sum: { $multiply: ['$value', mongoSampleWeight] } }, sampleCount: { $sum: mongoSampleWeight }, count: { $sum: 1 }, unit: { $last: '$unit' } } },
    { $sort: { _id: 1 } }
  ]);
  return rows.map(row => ({ date: row._id.date, component: row._id.component, value: isTotal ? row.value : row.weightedTotal / row.sampleCount, sampleCount: row.sampleCount, count: row.count, unit: row.unit }));
};

const getSummaryByUserId = async (userId) => {
  let groups;
  if (env.useMongoDB) {
    groups = await HealthRecord.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), deleted: { $ne: true } } },
      { $group: { _id: { metric: '$metricType', component: { $ifNull: ['$metadata.component', null] } }, total: { $sum: '$value' }, weightedTotal: { $sum: { $multiply: ['$value', mongoSampleWeight] } }, sampleCount: { $sum: mongoSampleWeight } } },
    ]).option({ maxTimeMS: 10000 });
  } else {
    const map = new Map();
    for (const row of healthRecords.filter(record => record.user_id === userId && !record.deleted).map(toHealthRecord)) {
      const key = JSON.stringify([row.metricType, row.metadata.component || null]);
      const group = map.get(key) || { _id: { metric: row.metricType, component: row.metadata.component || null }, total: 0, weightedTotal: 0, sampleCount: 0 };
      group.total += row.value; group.weightedTotal += row.value * sampleWeight(row); group.sampleCount += sampleWeight(row); map.set(key, group);
    }
    groups = [...map.values()];
  }
  return Object.fromEntries(groups.map(row => {
    const metric = row._id.metric === 'active_minutes' ? 'activeMinutes' : row._id.metric;
    return [row._id.component ? `${metric}_${row._id.component}` : metric, TOTAL_METRICS.includes(row._id.metric) ? row.total : row.weightedTotal / row.sampleCount];
  }));
};

const getDashboardByUserId = async (userId) => {
  let rows;
  if (env.useMongoDB) {
    rows = await HealthRecord.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), deleted: { $ne: true } } },
      { $sort: { metricType: 1, recordedAt: -1, _id: -1 } },
      { $group: { _id: { metric: '$metricType', component: { $ifNull: ['$metadata.component', null] } }, record: { $first: '$$ROOT' }, totalRecords: { $sum: 1 }, latestRecordedAt: { $max: '$recordedAt' } } },
    ]).option({ maxTimeMS: 10000 });
  } else {
    const groups = new Map();
    for (const row of healthRecords.filter(record => record.user_id === userId && !record.deleted).map(toHealthRecord)) {
      const component = row.metadata.component || null, key = JSON.stringify([row.metricType, component]);
      const group = groups.get(key) || { _id: { metric: row.metricType, component }, record: row, totalRecords: 0, latestRecordedAt: row.recordedAt };
      group.totalRecords++;
      if (+new Date(row.recordedAt) > +new Date(group.latestRecordedAt) || (+new Date(row.recordedAt) === +new Date(group.latestRecordedAt) && row.id > group.record.id)) {
        group.record = row; group.latestRecordedAt = row.recordedAt;
      }
      groups.set(key, group);
    }
    rows = [...groups.values()];
  }
  return {
    latestRecords: rows.map(row => toHealthRecord(row.record)).sort((a,b) => new Date(b.recordedAt) - new Date(a.recordedAt)),
    summary: rows.map(row => ({ metricType: row._id.metric, ...(row._id.component ? { component: row._id.component } : {}), totalRecords: row.totalRecords, latestRecordedAt: row.latestRecordedAt })).sort((a,b) => a.metricType.localeCompare(b.metricType)),
  };
};

module.exports = {
  healthRecords, toHealthRecord,
  listAdmin: async () => env.useMongoDB ? (await HealthRecord.find().sort({ createdAt: -1 }).lean()).map(toHealthRecord) : healthRecords.map(toHealthRecord),
  HealthRecord,
  createHealthRecord,
  findBySourceRecord,
  pruneHealthConnectRecords,
  getHealthRecordsByUserId,
  getDailyHealthHistory,
  getDashboardByUserId,
  getSummaryByUserId
};
