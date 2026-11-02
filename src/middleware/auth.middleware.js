const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AppError } = require('./error.middleware');
const userModel = require('../models/user.model');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Authentication token is required', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.jwt.secret);
    if (!Number.isInteger(decoded.sessionExpiresAt) || decoded.sessionExpiresAt <= Math.floor(Date.now()/1000)) throw new AppError('Session expired. Sign in again.', 401);
    if (decoded.otpVerified !== true) throw new AppError('Email OTP login required', 401);
    const user = await userModel.findUserById(decoded.sub);

    if (!user || user.status !== 'ACTIVE') {
      throw new AppError('Invalid authentication token', 401);
    }

    if ((decoded.authVersion || 0) !== (user.authVersion || 0)) throw new AppError('Session revoked. Sign in again.', 401);
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      next(new AppError('Invalid or expired authentication token', 401));
      return;
    }

    next(error);
  }
};

module.exports = {
  authenticate
};
