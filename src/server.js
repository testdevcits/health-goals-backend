const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const corsOptions = require('./config/cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const rewardWorker = require('./jobs/reward-worker');
const settlementWorker = require('./jobs/settlement-worker');
const challengeWorker = require('./jobs/challenge-worker');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { ensureDatabaseConnected } = require('./config/vercel-database');
const authRoutes = require('./routes/auth.routes');
const healthRoutes = require('./routes/health.routes');
const deviceRoutes = require('./routes/device.routes');
const walletRoutes = require('./routes/wallet.routes');
const rewardRoutes = require('./routes/reward.routes');
const redemptionRoutes = require('./routes/redemption.routes');
const healthController = require('./controllers/health.controller');
const { notFoundHandler, errorHandler } = require('./middleware/error.middleware');
const { requestId } = require('./middleware/request-id.middleware');
const { attachChatGateway } = require('./socket/chat.gateway');
const { setIo } = require('./socket/io-instance');

const app = express();

app.use(helmet());
app.use(cors(corsOptions));
app.use(requestId);
app.use(express.json({ limit: '7mb' }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/api/health', healthController.serverHealth);

app.get('/api/cron/settlement', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(503).json({ error: 'Scheduled settlement is not configured.' });
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await ensureDatabaseConnected();
    const dailySettlement = require('./services/daily-settlement.service');
    const totals = { claimed: 0, settled: 0, failed: 0 };
    // Bound each scheduled invocation; later runs safely continue any backlog.
    for (let batch = 0; batch < 100; batch += 1) {
      const result = await dailySettlement.processBatch({ batchSize: 20, concurrency: 2 });
      totals.claimed += result.claimed;
      totals.settled += result.settled;
      totals.failed += result.failed;
      if (result.claimed < 20) break;
    }
    return res.status(200).json({ ok: true, ...totals });
  } catch (error) {
    console.error('Scheduled settlement failed:', error.code || error.name);
    return res.status(500).json({ error: 'Scheduled settlement failed.' });
  }
});

app.get('/api/cron/challenges', async (req,res)=>{
  const cronSecret=process.env.CRON_SECRET;
  if(!cronSecret)return res.status(503).json({error:'Scheduled challenge finalization is not configured.'});
  if(req.headers.authorization!==`Bearer ${cronSecret}`)return res.status(401).json({error:'Unauthorized'});
  try{await ensureDatabaseConnected();const result=await require('./services/challenge.service').evaluate();return res.status(200).json({ok:true,...result});}
  catch(error){console.error('Scheduled challenge finalization failed:',error.code||error.name);return res.status(500).json({error:'Scheduled challenge finalization failed.'});}
});

if (process.env.VERCEL === '1') {
  app.use('/api/v1', async (req, res, next) => {
    try {
      await ensureDatabaseConnected();
      next();
    } catch (error) {
      next(error);
    }
  });
}

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin', require('./routes/admin.routes'));
app.use('/api/v1/partner', require('./routes/partner.routes'));
app.use('/api/v1/community', require('./routes/community.routes'));
app.use('/api/v1/community', require('./routes/challenge.routes'));
app.use('/api/v1/devices', deviceRoutes);
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/activity', require('./routes/activity.routes'));
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/rewards', rewardRoutes);
app.use('/api/v1/notifications', require('./routes/notification.routes'));
app.use('/api/v1/redemptions', redemptionRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const startServer = async () => {
  let httpServer;
  let server;
  try {
    await connectDatabase();
    httpServer = http.createServer(app);
    const io = new Server(httpServer, {
      cors: { origin: corsOptions.origin, methods: ['GET', 'POST'] },
      serveClient: false,
      maxHttpBufferSize: 1000000
    });
    setIo(io);
    attachChatGateway(io);
    await new Promise((resolve, reject) => {
      server = httpServer.listen(env.port, () => {
        console.log(`Health App backend running on port ${env.port}`);
        resolve();
      });
      server.once('error', reject);
    });
    settlementWorker.start();
    rewardWorker.start();
    challengeWorker.start();
  } catch (error) {
    console.error('Failed to start server:', error.code === 'EADDRINUSE'
      ? `Port ${env.port} is already in use. Stop the process using it or set PORT to a free port.`
      : error.message);
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (httpServer?.listening) await new Promise(resolve => httpServer.close(resolve));
    await settlementWorker.stop();
    await rewardWorker.stop();
    await challengeWorker.stop();
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  }
};

process.on('SIGINT', async () => {
  await settlementWorker.stop();
  await rewardWorker.stop();
  await challengeWorker.stop();
  await disconnectDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await settlementWorker.stop();
  await rewardWorker.stop();
  await challengeWorker.stop();
  await disconnectDatabase();
  process.exit(0);
});

if (require.main === module) startServer();

module.exports = app;
