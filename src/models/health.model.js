const mongoose = require('mongoose');
const env = require('../config/env');
const crypto = require('crypto');

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
healthRecordSchema.index({ userId: 1, metricType: 1 });
healthRecordSchema.index({ userId: 1, source: 1, sourceRecordId: 1 }, { unique: true });

healthRecordSchema.index({ recordedAt: -1, _id: -1 });
healthRecordSchema.index({ metricType: 1, recordedAt: -1, _id: -1 });
healthRecordSchema.index({ userId: 1, recordedAt: -1, _id: -1 });
healthRecordSchema.index({ createdAt: -1 });
healthRecordSchema.index({ userId: 1, activityDate: 1, deleted: 1 });
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
      .filter((record) => record.user_id === userId)
      .filter((record) => !filters.metricType || record.metric_type === filters.metricType)
      .filter((record) => !from || new Date(record.recorded_at) >= from)
      .filter((record) => !to || new Date(record.recorded_at) <= to)
      .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))
      .slice(0, 100)
      .map(toHealthRecord);
  }

  const query = { userId };

  if (filters.metricType) {
    query.metricType = filters.metricType;
  }
  if (from || to) query.recordedAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

  const records = await HealthRecord.find(query)
    .sort({ recordedAt: -1 })
    .limit(100);

  return records.map(toHealthRecord);
};

const getDailyHealthHistory = async (userId, { metricType, from, to }) => {
  const start = new Date(from), end = new Date(to);
  if (!env.useMongoDB) {
    const groups = new Map();
    healthRecords.filter(row => row.user_id === userId && row.metric_type === metricType && !row.deleted && new Date(row.recorded_at) >= start && new Date(row.recorded_at) <= end).forEach(row => {
      const date = String(row.activityDate || row.recorded_at).slice(0, 10);
      const item = groups.get(date) || { date, value: 0, count: 0, unit: row.unit };
      item.value += Number(row.value); item.count += 1; groups.set(date, item);
    });
    return [...groups.values()].sort((a,b) => a.date.localeCompare(b.date));
  }
  const rows = await HealthRecord.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId), metricType, deleted: { $ne: true }, recordedAt: { $gte: start, $lte: end } } },
    { $group: { _id: { $ifNull: ['$activityDate', { $dateToString: { date: '$recordedAt', format: '%Y-%m-%d', timezone: 'Asia/Kolkata' } }] }, value: { $sum: '$value' }, count: { $sum: 1 }, unit: { $last: '$unit' } } },
    { $sort: { _id: 1 } }
  ]);
  return rows.map(row => ({ date: row._id, value: row.value, count: row.count, unit: row.unit }));
};

const getDashboardByUserId = async (userId) => {
  if (!env.useMongoDB) {
    const records = healthRecords
      .filter((record) => record.user_id === userId)
      .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));

    const latestByMetric = new Map();
    const summaryByMetric = new Map();

    records.forEach((record) => {
      if (!latestByMetric.has(record.metric_type)) {
        latestByMetric.set(record.metric_type, record);
      }

      const currentSummary = summaryByMetric.get(record.metric_type) || {
        metricType: record.metric_type,
        totalRecords: 0,
        latestRecordedAt: record.recorded_at
      };

      currentSummary.totalRecords += 1;
      if (new Date(record.recorded_at) > new Date(currentSummary.latestRecordedAt)) {
        currentSummary.latestRecordedAt = record.recorded_at;
      }

      summaryByMetric.set(record.metric_type, currentSummary);
    });

    return {
      latestRecords: Array.from(latestByMetric.values()).map(toHealthRecord),
      summary: Array.from(summaryByMetric.values()).sort((a, b) =>
        a.metricType.localeCompare(b.metricType)
      )
    };
  }

  const [latestRecords, summary] = await Promise.all([
    HealthRecord.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $sort: { metricType: 1, recordedAt: -1 } },
      {
        $group: {
          _id: '$metricType',
          record: { $first: '$$ROOT' }
        }
      },
      { $replaceRoot: { newRoot: '$record' } },
      { $sort: { recordedAt: -1 } }
    ]),
    HealthRecord.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: '$metricType',
          totalRecords: { $sum: 1 },
          latestRecordedAt: { $max: '$recordedAt' }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);

  return {
    latestRecords: latestRecords.map(toHealthRecord),
    summary: summary.map((row) => ({
      metricType: row._id,
      totalRecords: row.totalRecords,
      latestRecordedAt: row.latestRecordedAt
    }))
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
  getDashboardByUserId
};
