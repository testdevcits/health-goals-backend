const express = require('express');
const cors = require('cors');
const corsOptions = require('./config/cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const settlementWorker = require('./jobs/settlement-worker');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const authRoutes = require('./routes/auth.routes');
const healthRoutes = require('./routes/health.routes');
const deviceRoutes = require('./routes/device.routes');
const walletRoutes = require('./routes/wallet.routes');
const rewardRoutes = require('./routes/reward.routes');
const redemptionRoutes = require('./routes/redemption.routes');
const healthController = require('./controllers/health.controller');
const { notFoundHandler, errorHandler } = require('./middleware/error.middleware');
const { requestId } = require('./middleware/request-id.middleware');

const app = express();

app.use(helmet());
app.use(cors(corsOptions));
app.use(requestId);
app.use(express.json());
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/api/health', healthController.serverHealth);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin', require('./routes/admin.routes'));
app.use('/api/v1/devices', deviceRoutes);
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/activity', require('./routes/activity.routes'));
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/rewards', rewardRoutes);
app.use('/api/v1/redemptions', redemptionRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const startServer = async () => {
  try {
    await connectDatabase();
    settlementWorker.start();
    const server = app.listen(env.port, () => {
      console.log(`Health App backend running on port ${env.port}`);
    });
    server.on('error', async (error) => {
      console.error('Failed to start server:', error.message);
      await disconnectDatabase();
      process.exit(1);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    await disconnectDatabase();
    process.exit(1);
  }
};

process.on('SIGINT', async () => {
  await settlementWorker.stop();
  await disconnectDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await settlementWorker.stop();
  await disconnectDatabase();
  process.exit(0);
});

if (require.main === module) startServer();

module.exports = app;
