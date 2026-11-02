const dotenv = require('dotenv');

dotenv.config();

const appMode = (process.env.APP_MODE || 'live').trim().toLowerCase();
if (!['dev', 'live'].includes(appMode)) throw new Error('APP_MODE must be dev or live');
if (process.env.NODE_ENV === 'production' && appMode === 'dev') throw new Error('APP_MODE=dev cannot be used with NODE_ENV=production');

const useMongoDB = process.env.USE_MONGODB !== 'false';

const requiredEnvVars = useMongoDB
  ? ['MONGODB_URI', 'JWT_SECRET', 'JWT_REFRESH_SECRET']
  : ['JWT_SECRET', 'JWT_REFRESH_SECRET'];

const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

module.exports = {
  appMode,
  settlementEnabled: process.env.SETTLEMENT_ENABLED !== 'false',
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  useMongoDB,
  mongoUri: process.env.MONGODB_URI,
  adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean),
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
  },
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
};
