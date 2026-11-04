const healthModel = require('../models/health.model');
const deviceModel = require('../models/device.model');
const ingestion = require('./activity-ingestion.service');
const { AppError } = require('../middleware/error.middleware');

const allowedMetricTypes = new Set([
  'steps', 'workout', 'meditation', 'water_checkin', 'sleep_checkin',
  'running',
  'walking',
  'heart_rate',
  'sleep',
  'oxygen_saturation',
  'weight',
  'blood_pressure',
  'calories',
  'distance',
  'active_minutes'
]);

const validationRules = {
  workout: { min: 0, max: 1440 }, meditation: { min: 0, max: 1440 }, water_checkin: { min: 1, max: 1 }, sleep_checkin: { min: 1, max: 1 },
  steps: { min: 0, max: 200000 },
  distance: { min: 0, max: 500 },
  running: { min: 0, max: 500 },
  walking: { min: 0, max: 500 },
  heart_rate: { min: 20, max: 250 },
  sleep: { min: 0, max: 1440 },
  oxygen_saturation: { min: 50, max: 100 },
  weight: { min: 1, max: 700 },
  blood_pressure: { min: 1, max: 400 },
  calories: { min: 0, max: 50000 },
  active_minutes: { min: 0, max: 1440 }
};

const validateMetricType = (metricType) => {
  if (!metricType || !allowedMetricTypes.has(metricType)) {
    throw new AppError('Invalid metric type', 400, {
      allowedMetricTypes: Array.from(allowedMetricTypes)
    });
  }
};

const validateHealthRecord = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AppError('A health record object is required', 400);
  const { metricType, value, unit, recordedAt, source, sourceRecordId } = payload;
  for (const [field, item] of Object.entries({ metricType, unit, recordedAt, source, sourceRecordId })) {
    if (typeof item !== 'string' || !item.trim() || item.length > 256) throw new AppError(`${field} must be a non-empty string (max 256 characters)`, 400);
  }
  if (typeof value !== 'number' && typeof value !== 'string') throw new AppError('value must be numeric', 400);

  if (!metricType || value === undefined || value === null || !unit || !recordedAt || !source || !sourceRecordId) {
    throw new AppError('metricType, value, unit, recordedAt, source, and sourceRecordId are required', 400);
  }

  validateMetricType(metricType);

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new AppError('value must be numeric', 400);
  }

  const rules = validationRules[metricType];
  if (numericValue < rules.min || numericValue > rules.max) {
    throw new AppError(`value is outside allowed range for ${metricType}`, 400, {
      min: rules.min,
      max: rules.max
    });
  }

  const timestamp = new Date(recordedAt);
  if (Number.isNaN(timestamp.getTime())) {
    throw new AppError('recordedAt must be a valid timestamp', 400);
  }

  const futureToleranceMs = 5 * 60 * 1000;
  if (timestamp.getTime() > Date.now() + futureToleranceMs) {
    throw new AppError('recordedAt cannot be in the future', 400);
  }

  if (payload.metadata !== undefined && (payload.metadata === null || typeof payload.metadata !== 'object' || Array.isArray(payload.metadata))) {
    throw new AppError('metadata must be an object when provided', 400);
  }
};

const createRecord = async (userId, payload, requestId = null) => {
  validateHealthRecord(payload);

  if (payload.deviceId) {
    const ownsDevice = await deviceModel.userOwnsDevice(userId, payload.deviceId);
    if (!ownsDevice) {
      throw new AppError('Device is not registered for this user', 403);
    }
  }

  const result = await ingestion.ingest(userId, payload);
  await deviceModel.touchDeviceSync(userId, payload.deviceId);
  // Ingestion remains successful if reward evaluation needs a worker retry.
  try{await require('./reward-engine.service').evaluate();}catch(error){console.error('Reward evaluation queued for retry:',error.code||error.name);}
  return result;
};

const syncRecords = async (userId, payload, requestId = null) => {
  if (!payload.records || !Array.isArray(payload.records) || payload.records.length === 0) {
    throw new AppError('records must be a non-empty array', 400);
  }

  if (payload.records.length > 100) {
    throw new AppError('Cannot sync more than 100 records at once', 400);
  }

  const results = [];
  for (const recordPayload of payload.records) {
    const result = await createRecord(userId, recordPayload, requestId);
    results.push(result);
  }

  // Keep the same rolling window read by Android. Prune only Health Connect
  // imports so manually entered or other-source health records are preserved.
  const retentionCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const pruned = await healthModel.pruneHealthConnectRecords(userId, retentionCutoff);

  return {
    total: results.length,
    created: results.filter((item) => !item.duplicate && !item.updated).length,
    updated: results.filter((item) => item.updated).length,
    duplicates: results.filter((item) => item.duplicate).length,
    pruned,
    rewards: results.flatMap((item) => item.rewards),
    records: results.map((item) => item.record)
  };
};

const getRecords = async (userId, filters = {}) => {
  if (filters.metricType) {
    validateMetricType(filters.metricType);
  }

  return healthModel.getHealthRecordsByUserId(userId, filters);
};

const getDailyHistory = async (userId, filters = {}) => {
  validateMetricType(filters.metricType);
  const from = new Date(`${filters.from}T00:00:00+05:30`), to = new Date(`${filters.to}T23:59:59.999+05:30`);
  if (!filters.from || !filters.to || !Number.isFinite(+from) || !Number.isFinite(+to) || from > to) throw new AppError('Valid from and to dates are required', 400);
  return healthModel.getDailyHealthHistory(userId, { ...filters, from, to });
};

const getDashboard = async (userId) => {
  return healthModel.getDashboardByUserId(userId);
};

const getSummary = async (userId) => {
  const records = await healthModel.getHealthRecordsByUserId(userId);
  return records.reduce((summary, record) => {
    const key = record.metricType === 'active_minutes' ? 'activeMinutes' : record.metricType;
    summary[key] = (summary[key] || 0) + record.value;
    return summary;
  }, {});
};

module.exports = {
  allowedMetricTypes,
  syncRecords,
  createRecord,
  getRecords,
  getDailyHistory,
  getSummary,
  getDashboard
};
