const env = require('./env');
const { AppError } = require('../middleware/error.middleware');

function isDevelopmentLoopback(origin) {
  if (env.nodeEnv !== 'development') return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

module.exports = {
  origin(origin, callback) {
    // Vite can choose another port when 3000 is occupied. Local development
    // accepts loopback origins; production always uses the explicit allowlist.
    if (!origin || env.allowedOrigins.includes(origin) || isDevelopmentLoopback(origin)) {
      return callback(null, true);
    }
    return callback(new AppError('Frontend origin is not allowed. Add its exact URL to backend ALLOWED_ORIGINS and restart the backend.', 403, { code: 'CORS_ORIGIN_DENIED' }));
  }
};
