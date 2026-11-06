const healthModel = require('../models/health.model');
const deviceModel = require('../models/device.model');
const ingestion = require('./activity-ingestion.service');
const { dayKey, dayEnd } = require('./daily-rules');
const { AppError } = require('../middleware/error.middleware');
const env = require('../config/env');
const mongoose = require('mongoose');
const { METRIC_UNITS, REWARD_METRICS } = require('./health-metrics');

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
  if (payload.deviceId !== undefined && (typeof payload.deviceId !== 'string' || !payload.deviceId.trim() || payload.deviceId.length > 200)) throw new AppError('Invalid deviceId', 400);
  if (typeof value !== 'number' && typeof value !== 'string') throw new AppError('value must be numeric', 400);

  if (!metricType || value === undefined || value === null || !unit || !recordedAt || !source || !sourceRecordId) {
    throw new AppError('metricType, value, unit, recordedAt, source, and sourceRecordId are required', 400);
  }

  validateMetricType(metricType);

  if (unit !== METRIC_UNITS[metricType]) throw new AppError(`unit must be ${METRIC_UNITS[metricType]} for ${metricType}`, 400);
  if (typeof value === 'string' && !value.trim()) throw new AppError('value must be numeric', 400);
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
  if (payload.metadata) {
    if (Buffer.byteLength(JSON.stringify(payload.metadata)) > 16384) throw new AppError('metadata exceeds 16 KB', 400);
    if (payload.metadata.sampleCount !== undefined && (!Number.isSafeInteger(payload.metadata.sampleCount) || payload.metadata.sampleCount < 1 || payload.metadata.sampleCount > 10000000)) throw new AppError('Invalid sampleCount', 400);
    if (payload.metadata.component !== undefined && (metricType !== 'blood_pressure' || !['systolic', 'diastolic'].includes(payload.metadata.component))) throw new AppError('Invalid measurement component', 400);
  }

};

const createRecord = async (userId, payload, requestId = null, options = {}) => {
  validateHealthRecord(payload);

  if (payload.deviceId) {
    if (!options.validatedDeviceIds?.has(payload.deviceId)) {
      const ownsDevice = await deviceModel.userOwnsDevice(userId, payload.deviceId);
      if (!ownsDevice) {
        throw new AppError('Device is not registered for this user', 403);
      }
      options.validatedDeviceIds?.add(payload.deviceId);
    }
  }

  const result = await ingestion.ingest(userId, payload);
  if (options.touchDevice !== false) await deviceModel.touchDeviceSync(userId, payload.deviceId);
  // Ingestion remains successful if reward evaluation needs a worker retry.
  if (options.evaluateRewards !== false) {
    try{await require('./reward-engine.service').evaluate();}catch(error){console.error('Reward evaluation queued for retry:',error.code||error.name);}
  }
  return result;
};

const syncRecords = async (userId, payload, requestId = null) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AppError('A sync object is required', 400);
  if (!payload.records || !Array.isArray(payload.records) || payload.records.length === 0) {
    throw new AppError('records must be a non-empty array', 400);
  }

  if (payload.records.length > 100) {
    throw new AppError('Cannot sync more than 100 records at once', 400);
  }

  const deviceIds = new Set();
  const identities = new Set();
  for (const [index, recordPayload] of payload.records.entries()) {
    try {
      validateHealthRecord(recordPayload);
      ingestion.extraFields(recordPayload);
      const identity = JSON.stringify([recordPayload.source, recordPayload.sourceRecordId]);
      if (identities.has(identity)) throw new AppError('Duplicate source record identity in batch', 400);
      identities.add(identity);
      if (recordPayload.deviceId) deviceIds.add(recordPayload.deviceId);
    } catch (error) {
      // Identify the failing batch item without echoing health values or
      // timestamps back in the error response.
      error.details = {
        ...(error.details && typeof error.details === 'object' ? error.details : {}),
        recordIndex: index,
        metricType: recordPayload?.metricType || null,
        hasStartTime: Boolean(recordPayload?.startTime),
        hasEndTime: Boolean(recordPayload?.endTime)
      };
      throw error;
    }
  }

  for (const deviceId of deviceIds) {
    if (!(await deviceModel.userOwnsDevice(userId, deviceId))) {
      throw new AppError('Device is not registered for this user', 403);
    }
  }

  const ingestBatch = async session => {
    const results = [];
    // Load all existing identities once inside the transaction instead of a read per item.
    const existingRows = env.useMongoDB ? await healthModel.HealthRecord.find({ userId, $or: payload.records.map(row => ({ source: row.source, sourceRecordId: row.sourceRecordId })) }).session(session) : await healthModel.listAdmin();
    const existing = new Map(existingRows.filter(row => String(row.userId) === String(userId)).map(row => [JSON.stringify([row.source, row.sourceRecordId]), row]));
    // Reject all existing identity conflicts before the first write, including in local storage.
    for (const [index, record] of payload.records.entries()) {
      try { ingestion.assertSourceIdentity(existing.get(JSON.stringify([record.source, record.sourceRecordId])), record); }
      catch (error) { error.details = { recordIndex: index, metricType: record.metricType }; throw error; }
    }
    const affectedDays = new Set();
    for (const [index, recordPayload] of payload.records.entries()) {
      try {
        const result = await ingestion.ingest(userId, recordPayload, session, {
          existingRecord: existing.get(JSON.stringify([recordPayload.source, recordPayload.sourceRecordId])) || null,
          enqueue: false,
        });
        results.push(result);
        if (!result.duplicate && REWARD_METRICS.has(recordPayload.metricType)) affectedDays.add(dayKey(recordPayload.startTime || recordPayload.recordedAt));
      } catch (error) {
        error.details = {
          ...(error.details && typeof error.details === 'object' ? error.details : {}),
          recordIndex: index,
          metricType: recordPayload?.metricType || null,
          hasStartTime: Boolean(recordPayload?.startTime),
          hasEndTime: Boolean(recordPayload?.endTime)
        };
        throw error;
      }
    }
    for (const day of affectedDays) await require('./daily-settlement.service').enqueue(userId, day, session);
    return results;
  };
  let results;
  if (env.useMongoDB) {
    try { results = await mongoose.connection.transaction(ingestBatch); }
    catch (error) {
      if (error.code !== 11000) throw error;
      // Another request may have inserted the same identity after our batch read.
      results = await mongoose.connection.transaction(ingestBatch);
    }
  } else results = await ingestBatch(null);
  for (const deviceId of deviceIds) await deviceModel.touchDeviceSync(userId, deviceId);
  // Rules evaluation scans competitions and their activity data; do this once
  // after the whole batch instead of once for every record.
  try { if (results.some(result => !result.duplicate)) await require('./reward-engine.service').evaluate(); }
  catch (error) { console.error('Reward evaluation queued for retry:', error.code || error.name); }

  // The mobile read window is not a retention policy: preserve synced history.

  return {
    total: results.length,
    created: results.filter((item) => !item.duplicate && !item.updated).length,
    updated: results.filter((item) => item.updated).length,
    duplicates: results.filter((item) => item.duplicate).length,
    pruned: 0,
    rewards: results.flatMap((item) => item.rewards),
    ...(payload.includeRecords === false ? {} : { records: results.map((item) => item.record) })
  };
};

// Compact Health Connect contract: one cumulative step total per local day
// and data origin. Replacing the same key makes retries idempotent and avoids
// uploading every Health Connect interval.
const syncDailySteps = async (userId, payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AppError('A daily steps object is required', 400);
  const { date, steps, dataOrigin, deviceId } = payload;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(+new Date(`${date}T00:00:00+05:30`)) || dayKey(new Date(`${date}T00:00:00+05:30`)) !== date) throw new AppError('date must be a valid YYYY-MM-DD Asia/Kolkata date', 400);
  if (!Number.isSafeInteger(steps) || steps < 0 || steps > 200000) throw new AppError('steps must be an integer from 0 to 200000', 400);
  if (typeof dataOrigin !== 'string' || !dataOrigin.trim() || dataOrigin.length > 200) throw new AppError('dataOrigin is required (max 200 characters)', 400);
  if (payload.recordingMethod !== undefined && !['automatic', 'active'].includes(payload.recordingMethod)) throw new AppError('recordingMethod must be automatic or active', 400);
  if (deviceId !== undefined && (typeof deviceId !== 'string' || !deviceId.trim() || deviceId.length > 200)) throw new AppError('Invalid deviceId', 400);
  if (deviceId && !(await deviceModel.userOwnsDevice(userId, deviceId))) throw new AppError('Device is not registered for this user', 403);

  const startTime = new Date(`${date}T00:00:00+05:30`);
  const endTime = new Date(Math.max(+startTime + 1, Math.min(+dayEnd(date), Date.now())));
  if (+startTime > Date.now()) throw new AppError('Cannot sync steps for a future date', 400);
  const sourceRecordId = `daily-steps:${date}:${dataOrigin}`.slice(0, 256);
  const existing = await healthModel.findBySourceRecord(userId, 'health_connect', sourceRecordId);
  const sourceVersion = existing ? (existing.sourceVersion || 1) + 1 : 1;
  const record = {
    metricType: 'steps', value: steps, unit: 'count', recordedAt: startTime.toISOString(),
    startTime: startTime.toISOString(), endTime: endTime.toISOString(), source: 'health_connect',
    sourceRecordId, sourceVersion, dataOrigin: dataOrigin.trim(),
    recordingMethod: payload.recordingMethod || 'automatic',
    ...(deviceId ? { deviceId } : {}), metadata: { aggregation: 'daily_total' }
  };
  const result = await ingestion.ingest(userId, record);
  if (deviceId) await deviceModel.touchDeviceSync(userId, deviceId);
  try { await require('./reward-engine.service').evaluate(); } catch (error) { console.error('Reward evaluation queued for retry:', error.code || error.name); }
  return { date, steps: result.record.deleted ? 0 : result.record.value, updated: Boolean(result.updated), duplicate: Boolean(result.duplicate), superseded: Boolean(result.superseded), record: result.record };
};

const getRecords = async (userId, filters = {}) => {
  if (filters.metricType) {
    validateMetricType(filters.metricType);
  }

  return healthModel.getHealthRecordsByUserId(userId, filters);
};

const getRecordsPage = async (userId, filters = {}) => {
  if (filters.metricType) validateMetricType(filters.metricType);
  const { page, limit, query } = require('./admin-query.service').buildQuery('records', { metricType: filters.metricType, from: filters.from, to: filters.to, page: filters.page, limit: filters.limit || 100 });
  const rows = await healthModel.getHealthRecordsByUserId(userId, { metricType: filters.metricType, from: query.recordedAt?.$gte, to: query.recordedAt?.$lte, offset: (page - 1) * limit, limit: limit + 1 });
  const hasMore = rows.length > limit;
  return { records: rows.slice(0, limit), page, limit, hasMore, nextPage: hasMore ? page + 1 : null };
};

const getDailyHistory = async (userId, filters = {}) => {
  validateMetricType(filters.metricType);
  // Reuse strict calendar validation and the same IST boundaries as admin.
  const { query } = require('./admin-query.service').buildQuery('records', { from: filters.from, to: filters.to });
  const from = query.recordedAt?.$gte, to = query.recordedAt?.$lte;
  if (!from || !to || !Number.isFinite(+from) || !Number.isFinite(+to) || from > to) throw new AppError('Valid from and to dates are required', 400);
  return healthModel.getDailyHealthHistory(userId, { ...filters, from, to });
};

const getDashboard = async (userId) => {
  return healthModel.getDashboardByUserId(userId);
};

const getSummary = userId => healthModel.getSummaryByUserId(userId);

module.exports = {
  allowedMetricTypes,
  syncRecords,
  syncDailySteps,
  createRecord,
  getRecords,
  getRecordsPage,
  getDailyHistory,
  getSummary,
  getDashboard
};
