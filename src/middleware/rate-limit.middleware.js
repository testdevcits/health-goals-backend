const rateLimit = require('express-rate-limit');

const createLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message
      }
    }
  });

const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many auth requests. Please try again later.'
});

const adminWriteLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many admin changes. Please try again shortly.'
});

const syncLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many sync requests. Please slow down.'
});

const redemptionLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many redemption requests. Please try again later.'
});

module.exports = {
  authLimiter,
  adminWriteLimiter,
  syncLimiter,
  redemptionLimiter
};
