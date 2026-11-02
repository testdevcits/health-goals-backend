const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const env = require('./config/env');
const corsOptions = require('./config/cors');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { attachChatGateway } = require('./socket/chat.gateway');

async function startSocketServer() {
  await connectDatabase();
  const app = express();
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: corsOptions.origin, methods: ['GET', 'POST'] },
    serveClient: false,
    maxHttpBufferSize: 1000000
  });
  attachChatGateway(io);
  server.listen(env.port, () => console.log(`Health App chat server running on port ${env.port}`));
  server.on('error', async (error) => {
    console.error('Failed to start chat server:', error.message);
    await disconnectDatabase();
    process.exit(1);
  });
  process.on('SIGINT', async () => { await new Promise(resolve => io.close(resolve)); await disconnectDatabase(); process.exit(0); });
  process.on('SIGTERM', async () => { await new Promise(resolve => io.close(resolve)); await disconnectDatabase(); process.exit(0); });
}

startSocketServer().catch(async (error) => {
  console.error('Failed to start chat server:', error.message);
  await disconnectDatabase();
  process.exit(1);
});
