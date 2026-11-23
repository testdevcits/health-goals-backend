const mongoose = require('mongoose');
const env = require('./env');

const connectDatabase = async () => {
  if (!env.useMongoDB) {
    console.log('MongoDB disabled. Using in-memory local storage.');
    return;
  }

  // Fail with a useful connection error instead of waiting for the driver's
  // relatively long default server selection timeout during local startup.
  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS) || 15000,
    connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS) || 10000
  });
  {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('Daily point settlement requires MongoDB Atlas or a replica set for atomic transactions. Standalone MongoDB is not supported.');
  }
  // Collections and unique indexes must exist before transactional ingestion.
  require('../services/activity-ingestion.service');
  require('../models/wallet.model');
  require('../services/coin-rules.service');
  require('../services/reward-engine.service');
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  console.log('MongoDB connected; indexes ready.');
};

const disconnectDatabase = async () => {
  if (env.useMongoDB) {
    await mongoose.disconnect();
  }
};

module.exports = {
  connectDatabase,
  disconnectDatabase
};
