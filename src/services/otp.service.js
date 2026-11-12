const crypto = require('crypto');
const mongoose = require('mongoose');
const env = require('../config/env');
const mail = require('./mail.service');
const { AppError } = require('../middleware/error.middleware');

const getDeliveryMode = () => (env.appMode === 'dev' ? 'development' : 'live');

const schema = new mongoose.Schema({
  _id: String, challengeId: String, email: { type: String, unique: true }, purpose: String, mode: String,
  hash: String, payload: mongoose.Schema.Types.Mixed, attempts: Number,
  createdAt: Date, expiresAt: { type: Date, expires: 0 }
});
const Challenge = mongoose.model('OtpChallenge', schema);
const memory = new Map();
const digest = (id, otp) => crypto.createHmac('sha256', env.jwt.secret).update(`${id}:${otp}`).digest('hex');

exports.request = async ({ email, purpose, payload }) => {
  const now = Date.now();
  const deliveryMode = getDeliveryMode();
  for (const [key, row] of memory) if (new Date(row.expiresAt).getTime() <= now) memory.delete(key);
  const row = { _id: crypto.randomUUID(), email, purpose, payload, mode: deliveryMode, attempts: 0,
    createdAt: new Date(now), expiresAt: new Date(now + 5 * 60 * 1000) };
  const otp = deliveryMode === 'development' ? '123456' : String(crypto.randomInt(100000, 1000000));
  row.hash = digest(row._id, otp);
  if (env.useMongoDB) {
    try {
      const { _id, ...fields } = row;
      await Challenge.updateOne({ email, createdAt: { $lte: new Date(now - 60000) } }, { $set: { ...fields, challengeId: _id }, $setOnInsert: { _id: email } }, { upsert: true });
    } catch (error) {
      if (error.code === 11000) throw new AppError('Wait 60 seconds before requesting another code', 429);
      throw error;
    }
  } else {
    const prior = memory.get(email);
    if (prior && now - new Date(prior.createdAt).getTime() < 60000) throw new AppError('Wait 60 seconds before requesting another code', 429);
    memory.set(email, row);
  }

  if (deliveryMode !== 'development') {
    try { await mail.sendOtp(email, otp, purpose); }
    catch (error) {
      if (env.useMongoDB) await Challenge.deleteOne({ challengeId: row._id });
      else if (memory.get(email)?._id === row._id) memory.delete(email);
      throw error;
    }
  }

  return { requiresOtp: true, challengeId: row._id, expiresIn: 300, resendAfter: 60, deliveryMode: deliveryMode === 'development' ? 'development' : 'email' };
};

exports.consume = async (id, otp) => {
  if (typeof id !== 'string' || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) throw new AppError('Challenge ID and six-digit OTP are required', 400);
  let row;
  if (env.useMongoDB) {
    row = await Challenge.findOneAndUpdate({ challengeId: id, attempts: { $lt: 5 }, expiresAt: { $gt: new Date() } }, { $inc: { attempts: 1 } }, { new: true }).lean();
  } else {
    row = [...memory.values()].find(r => r._id === id);
    if (row && (row.attempts >= 5 || new Date(row.expiresAt) <= new Date())) row = null;
    if (row) row.attempts++;
  }
  if (!row) throw new AppError('Code expired or attempt limit reached. Request a new code.', 401);
  const expectedMode = getDeliveryMode();
  if ((row.mode || 'live') !== expectedMode) throw new AppError('Authentication mode changed. Request a new code.', 401);
  const matches = crypto.timingSafeEqual(Buffer.from(row.hash, 'hex'), Buffer.from(digest(id, otp), 'hex'));
  if (!matches) throw new AppError('Invalid verification code', 401);
  if (env.useMongoDB) {
    const result = await Challenge.deleteOne({ challengeId: id });
    if (!result.deletedCount) throw new AppError('Code already used', 401);
  } else {
    if (memory.get(row.email)?._id !== id) throw new AppError('Code already used', 401);
    memory.delete(row.email);
  }
  return row;
};
