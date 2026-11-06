// Quantities accumulate during a day; vital measurements are daily averages.
const TOTAL_METRICS = ['steps', 'distance', 'calories', 'sleep', 'workout', 'active_minutes', 'running', 'walking', 'meditation', 'water_checkin', 'sleep_checkin'];
const METRIC_UNITS = {
  steps: 'count', distance: 'km', running: 'km', walking: 'km', calories: 'kcal',
  sleep: 'min', workout: 'min', meditation: 'min', active_minutes: 'min',
  heart_rate: 'bpm', weight: 'kg', blood_pressure: 'mmHg', oxygen_saturation: '%',
  water_checkin: 'checkin', sleep_checkin: 'checkin',
};
const REWARD_METRICS = new Set(['steps', 'workout', 'meditation', 'water_checkin', 'sleep_checkin']);
module.exports = { TOTAL_METRICS, METRIC_UNITS, REWARD_METRICS };

const sampleWeight = row => Number.isSafeInteger(row.metadata?.sampleCount) && row.metadata.sampleCount > 0 && row.metadata.sampleCount <= 10000000 ? row.metadata.sampleCount : 1;
const mongoSampleWeight = { $cond: [{ $and: [{ $isNumber: '$metadata.sampleCount' }, { $gte: ['$metadata.sampleCount', 1] }, { $lte: ['$metadata.sampleCount', 10000000] }] }, '$metadata.sampleCount', 1] };
module.exports.sampleWeight = sampleWeight;
module.exports.mongoSampleWeight = mongoSampleWeight;
