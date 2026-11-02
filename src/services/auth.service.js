const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const userModel = require('../models/user.model');
const { AppError } = require('../middleware/error.middleware');

const otpService = require('./otp.service');

const refreshDigest = token => crypto.createHash('sha256').update(token).digest('hex');
const issueTokens = async (user, sessionExpiresAt = Math.floor(Date.now()/1000) + 3600, previousHash = null) => {
  const now = Math.floor(Date.now()/1000);
  const remaining = sessionExpiresAt - now;
  if (remaining <= 0) throw new AppError('Your one-hour session has expired. Sign in again.', 401);
  const accessSeconds = Math.min(900, remaining);
  const claims = { sub: user.id, otpVerified: true, authVersion: user.authVersion || 0, sessionExpiresAt };
  const accessToken = jwt.sign({ ...claims, email: user.email }, env.jwt.secret, { expiresIn: accessSeconds, jwtid: crypto.randomUUID() });
  const refreshToken = jwt.sign(claims, env.jwt.refreshSecret, { expiresIn: remaining, jwtid: crypto.randomUUID() });
  const refreshTokenHash = await bcrypt.hash(refreshDigest(refreshToken), 12);
  if (previousHash) {
    const rotated = await userModel.rotateRefreshToken(user.id, previousHash, refreshTokenHash, user.authVersion || 0);
    if (!rotated) throw new AppError('Refresh token was already used or revoked', 401);
  } else await userModel.updateRefreshToken(user.id, refreshTokenHash);
  return { accessToken, refreshToken, sessionExpiresAt: sessionExpiresAt * 1000, accessTokenExpiresAt: (now + accessSeconds) * 1000 };
};

const normalizeEmail = (email) => {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new AppError('Valid email is required', 400);
  return email.trim().toLowerCase();
};
const register = async ({ name, email, password, admin = false }) => {
  email = normalizeEmail(email);
  if (admin && !env.adminEmails.includes(email)) throw new AppError('This email is not approved for admin access', 403);
  if (typeof name !== 'string' || !name.trim() || name.length > 120 || !email || !password) {
    throw new AppError('Name, email, and password are required', 400);
  }

  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    throw new AppError('Password must be at least 8 characters long', 400);
  }

  const existingUser = await userModel.findUserByEmail(email);
  if (existingUser) {
    throw new AppError('Email is already registered', 409);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  return otpService.request({ email, purpose: 'register', payload: { name: name.trim(), email, passwordHash } });
};

const login = async ({ identifier, userId, email, password, admin = false }) => {
  const input = identifier ?? userId ?? email;
  if (typeof input !== 'string' || !input.trim() || input.length > 256 || typeof password !== 'string' || !password) {
    throw new AppError('Email or User ID and password are required', 400);
  }
  const value = input.trim();
  const isPublicId = /^USR-[A-F0-9]{12}$/i.test(value);
  const user = isPublicId
    ? await userModel.findUserByPublicId(value.toUpperCase())
    : await userModel.findUserByEmail(normalizeEmail(value));
  if (!user || !await bcrypt.compare(password, user.password_hash)) throw new AppError('Invalid email, User ID or password', 401);
  if (admin && !env.adminEmails.includes(user.email.toLowerCase())) throw new AppError('This email is not approved for admin access', 403);
  if (user.status === 'SUSPENDED') throw new AppError('Account is suspended', 403);
  const challenge = await otpService.request({ email: user.email, purpose: 'login', payload: { userId: user.id } });
  const [local, domain] = user.email.split('@');
  return { ...challenge, maskedEmail: `${local.slice(0, 1)}***@${domain}` };
};

const verifyOtp = async ({ challengeId, otp }) => {
  const challenge = await otpService.consume(challengeId, otp);
  let user;
  if (challenge.purpose === 'register') {
    if (await userModel.findUserByEmail(challenge.email)) throw new AppError('Email is already registered', 409);
    user = await userModel.createUser({ ...challenge.payload, role: env.adminEmails.includes(challenge.email) ? 'ADMIN' : 'USER' });
  } else {
    user = await userModel.findUserById(challenge.payload.userId);
  }
  if (!user || user.status !== 'ACTIVE') throw new AppError('Account unavailable', 403);
  await userModel.updateLastLogin(user.id);
  const tokens = await issueTokens(user);
  return { user, token: tokens.accessToken, ...tokens };
};

const refresh = async ({ refreshToken }) => {
  if (!refreshToken) {
    throw new AppError('Refresh token is required', 400);
  }

  let decoded;

  try {
    decoded = jwt.verify(refreshToken, env.jwt.refreshSecret);
  } catch (error) {
    throw new AppError('Invalid or expired refresh token', 401);
  }

  if (!Number.isInteger(decoded.sessionExpiresAt) || decoded.sessionExpiresAt <= Math.floor(Date.now()/1000)) throw new AppError('Session expired. Sign in again.', 401);
  if (decoded.otpVerified !== true) throw new AppError('Email OTP login required', 401);
  const user = await userModel.findAuthUserById(decoded.sub);
  if (!user || user.status !== 'ACTIVE' || !(user.password_hash || user.passwordHash)) {
    throw new AppError('Invalid refresh token', 401);
  }

  if ((decoded.authVersion || 0) !== (user.authVersion || 0)) throw new AppError('Session revoked. Sign in again.', 401);
  const refreshTokenHash = user.refresh_token_hash || user.refreshTokenHash;
  if (!refreshTokenHash) {
    throw new AppError('Refresh token has been revoked', 401);
  }

  const tokenMatches = await bcrypt.compare(refreshDigest(refreshToken), refreshTokenHash);
  if (!tokenMatches) {
    throw new AppError('Invalid refresh token', 401);
  }

  const publicUser = userModel.toPublicUser(user);
  const tokens = await issueTokens(publicUser, decoded.sessionExpiresAt, refreshTokenHash);

  return {
    user: publicUser,
    token: tokens.accessToken,
    ...tokens
  };
};

const logout = async (userId) => {
  await userModel.revokeSessions(userId);
  return { loggedOut: true };
};

const getCurrentUser = async (userId) => {
  const user = await userModel.findUserById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  return user;
};

module.exports = {
  verifyOtp,
  register,
  login,
  refresh,
  logout,
  getCurrentUser
};
