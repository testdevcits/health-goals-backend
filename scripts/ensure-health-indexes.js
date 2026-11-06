// Add declared health indexes without dropping any existing database indexes.
const mongoose = require('mongoose');
const env = require('../src/config/env');
const { HealthRecord } = require('../src/models/health.model');
(async () => {
  if (!env.useMongoDB) throw new Error('MongoDB is disabled');
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10000, autoIndex: false });
  await HealthRecord.createIndexes();
  const indexes = await HealthRecord.collection.indexes();
  console.log(JSON.stringify({ collection: HealthRecord.collection.name, indexes: indexes.map(index => index.name) }));
  const metrics = await HealthRecord.distinct('metricType', { deleted: { $ne: true } });
  const plans = await Promise.all(metrics.map(async metricType => {
    const sample = await HealthRecord.findOne({ metricType, deleted: { $ne: true } }).select('userId recordedAt').lean();
    if (!sample) return null;
    const plan = await HealthRecord.find({ userId: sample.userId, metricType, recordedAt: { $lte: sample.recordedAt } })
      .sort({ recordedAt: -1, _id: -1 }).limit(20).explain('executionStats');
    const indexNames = new Set();
    const inspect = node => {
      if (!node || typeof node !== 'object') return;
      if (node.indexName) indexNames.add(node.indexName);
      Object.values(node).forEach(inspect);
    };
    inspect(plan.queryPlanner.winningPlan);
    const stats = plan.executionStats;
    return { metricType, indexes: [...indexNames], returned: stats.nReturned, keysExamined: stats.totalKeysExamined, documentsExamined: stats.totalDocsExamined, executionTimeMillis: stats.executionTimeMillis };
  }));
  console.log(JSON.stringify({ query: 'user metric date history', plans: plans.filter(Boolean) }));

})().catch(error => {
  console.error('Health index setup failed:', error.code || error.name);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
