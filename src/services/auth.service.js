const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const env = require('../config/env');
const userModel = require('../models/user.model');
const { AppError } = require('../middleware/error.middleware');

const otpService = require('./otp.service');
const googleClient = new OAuth2Client();

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
const register = async ({ name, email, password, companyCode = '', goal = '', admin = false }) => {
  email = normalizeEmail(email);
  if (admin && !env.adminEmails.includes(email)) throw new AppError('This email is not approved for admin access', 403);
  if (typeof name !== 'string' || !name.trim() || name.length > 120 || !email || !password) {
    throw new AppError('Name, email, and password are required', 400);
  }

  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    throw new AppError('Password must be at least 8 characters long', 400);
  }

  if (typeof companyCode !== 'string' || companyCode.length > 64 || typeof goal !== 'string' || goal.length > 64) {
    throw new AppError('Company code or goal is invalid', 400);
  }

  const existingUser = await userModel.findUserByEmail(email);
  if (existingUser) {
    throw new AppError('Email is already registered', 409);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  return otpService.request({ email, purpose: 'register', payload: { name: name.trim(), email, passwordHash, companyCode: companyCode.trim(), goal: goal.trim() } });
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

const requestPasswordReset = async ({ email }) => {
  email = normalizeEmail(email);
  const user = await userModel.findUserByEmail(email);
  // Return the same response for unknown email addresses to avoid account discovery.
  if (!user) return { accepted: true };
  return otpService.request({ email, purpose: 'password_reset', payload: { userId: user.id } });
};

const resetPassword = async ({ challengeId, otp, password }) => {
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    throw new AppError('Password must be at least 8 characters long', 400);
  }
  const challenge = await otpService.consume(challengeId, otp);
  if (challenge.purpose !== 'password_reset') throw new AppError('Invalid password reset challenge', 400);
  const passwordHash = await bcrypt.hash(password, 12);
  const updated = await userModel.updatePassword(challenge.payload.userId, passwordHash);
  if (!updated) throw new AppError('Account not found', 404);
  return { passwordReset: true };
};

const loginWithGoogle = async ({ idToken }) => {
  if (!env.googleClientId) throw new AppError('Google sign-in is not configured on the server', 503);
  if (typeof idToken !== 'string' || !idToken) throw new AppError('Google ID token is required', 400);
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: env.googleClientId });
    payload = ticket.getPayload();
  } catch {
    throw new AppError('Google sign-in could not be verified', 401);
  }
  if (!payload?.email || payload.email_verified !== true) {
    throw new AppError('Google sign-in could not be verified', 401);
  }
  const email = normalizeEmail(payload.email);
  let user = await userModel.findUserByEmail(email);
  if (!user) {
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    user = await userModel.createUser({ name: String(payload.name || email.split('@')[0]).slice(0, 120), email, passwordHash });
    user = await userModel.findAuthUserById(user.id);
  }
  if (!user || user.status !== 'ACTIVE') throw new AppError('Account unavailable', 403);
  await userModel.updateLastLogin(user.id);
  const tokens = await issueTokens(user);
  return { user: userModel.toPublicUser(user), token: tokens.accessToken, ...tokens };
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
  const user = await userModel.findUserProfileById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  return user;
};

const updateCurrentProfile = async (userId, payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AppError('Profile details are required', 400);
  const allowed = ['name', 'goal', 'heightCm', 'weightKg', 'birthDate', 'phone'];
  const profile = {};
  for (const field of allowed) {
    if (payload[field] === undefined) continue;
    const value = payload[field];
    if (field === 'heightCm' || field === 'weightKg') {
      if (value === null || value === '') { profile[field] = null; continue; }
      const number = Number(value);
      const valid = field === 'heightCm' ? number >= 50 && number <= 300 : number >= 20 && number <= 500;
      if (!Number.isFinite(number) || !valid) throw new AppError(`${field} is outside the allowed range`, 400);
      profile[field] = number;
    } else if (field === 'phone') {
      if (typeof value !== 'string' || value.trim().length > 24) throw new AppError('phone must be a valid phone number', 400);
      const phone = value.trim();
      const digits = phone.replace(/\D/g, '');
      if (phone && (digits.length < 10 || digits.length > 15)) throw new AppError('phone must contain 10 to 15 digits', 400);
      profile.encryptedPhone = phone ? require('./voucher-code.service').encrypt(phone) : null;
    } else {
      if (typeof value !== 'string' || value.trim().length > (field === 'name' ? 100 : 500)) throw new AppError(`${field} must be text`, 400);
      if (field === 'name' && !value.trim()) throw new AppError('Name cannot be empty', 400);
      profile[field] = value.trim();
    }
  }
  if (profile.birthDate && !/^\d{2}\/\d{2}\/\d{4}$/.test(profile.birthDate)) throw new AppError('birthDate must use DD/MM/YYYY', 400);
  if (!Object.keys(profile).length) throw new AppError('No profile fields supplied', 400);
  const user = await userModel.updateProfile(userId, profile);
  if (!user) throw new AppError('User not found', 404);
  return user;
};

const updateCurrentHealthGoal = async (userId, payload) => {
  const allowed = { steps: [100, 200000], sleep: [30, 1440], heart_rate: [20, 250], stress: [0, 10] };
  if (!payload || !Object.prototype.hasOwnProperty.call(allowed, payload.metricType)) throw new AppError('Unsupported health goal metric', 400);
  const targetValue = Number(payload.targetValue);
  const [min, max] = allowed[payload.metricType];
  if (!Number.isFinite(targetValue) || targetValue < min || targetValue > max) throw new AppError('Goal target is outside the allowed range', 400);
  const user = await userModel.updateHealthGoal(userId, payload.metricType, targetValue);
  if (!user) throw new AppError('User not found', 404);
  return user;
};

const updateCurrentDeviceProfile = async (userId, payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('Phone device details are required', 400);
  }
  const fields = ['deviceIdentifier', 'manufacturer', 'brand', 'model', 'platform', 'osVersion', 'appVersion'];
  const profile = {};
  for (const field of fields) {
    const value = payload[field];
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) {
      throw new AppError(`${field} must be a non-empty string of at most 160 characters`, 400);
    }
    profile[field] = value.trim();
  }
  if (profile.platform !== 'android') throw new AppError('Only Android phone profiles are supported by this app', 400);
  profile.deviceType = 'phone';
  const user = await userModel.updateDeviceProfile(userId, profile);
  if (!user) throw new AppError('User not found', 404);
  return user;
};

module.exports = {
  verifyOtp,
  register,
  login,
  requestPasswordReset,
  resetPassword,
  loginWithGoogle,
  refresh,
  logout,
  getCurrentUser,
  updateCurrentProfile,
  updateCurrentHealthGoal,
  updateCurrentDeviceProfile
};
