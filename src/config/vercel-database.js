const mongoose = require('mongoose');
const env = require('./env');
const { connectDatabase } = require('./database');

let connectionPromise = null;

async function ensureDatabaseConnected() {
  if (!env.useMongoDB) {
    throw new Error('MongoDB must be enabled in Vercel; in-memory storage does not persist between function invocations.');
  }
  if (mongoose.connection.readyState === 1) return;
  if (!connectionPromise) {
    connectionPromise = connectDatabase().catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }
  await connectionPromise;
}

module.exports = { ensureDatabaseConnected };
