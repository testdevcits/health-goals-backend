const mongoose = require('mongoose');
const env = require('../config/env');
const crypto = require('crypto');

const userSchema = new mongoose.Schema(
  {
    publicId: { type: String, unique: true, sparse: true, immutable: true },
    name: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    passwordHash: {
      type: String,
      required: true
    },
    authVersion: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED'],
      default: 'ACTIVE'
    },
    role: {
      type: String,
      enum: ['USER', 'ADMIN'],
      default: 'USER'
    },
    refreshTokenHash: {
      type: String,
      default: null
    },
    lastLoginAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

userSchema.index({ createdAt: -1, _id: -1 });
userSchema.index({ status: 1, createdAt: -1, _id: -1 });
const User = mongoose.model('User', userSchema);
const users = [];

const toPublicUser = (user) => ({
  id: user.id || user._id.toString(),
  publicId: user.publicId || null,
  name: user.name,
  email: user.email,
  authVersion: user.authVersion || 0,
  status: user.status || 'ACTIVE',
  role: user.role || 'USER',
  lastLoginAt: user.lastLoginAt || user.last_login_at || null,
  createdAt: user.createdAt || user.created_at,
  updatedAt: user.updatedAt || user.updated_at
});

const toAuthUser = (user) => ({
  ...toPublicUser(user),
  password_hash: user.passwordHash || user.password_hash,
  refresh_token_hash: user.refreshTokenHash || user.refresh_token_hash
});

const createUser = async ({ name, email, passwordHash, role = 'USER' }) => {
  const publicId = `USR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  if (!env.useMongoDB) {
    const now = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(),
      name,
      publicId,
      email: email.toLowerCase(),
      password_hash: passwordHash,
      status: 'ACTIVE',
      role,
      refresh_token_hash: null,
      last_login_at: null,
      created_at: now,
      updated_at: now
    };

    users.push(user);
    return toPublicUser(user);
  }

  const user = await User.create({
    publicId,
    name,
    email,
    passwordHash,
    role
  });

  return toPublicUser(user);
};

const updateRefreshToken = async (id, refreshTokenHash) => {
  if (!env.useMongoDB) {
    const user = users.find((currentUser) => currentUser.id === id);
    if (user) {
      user.refresh_token_hash = refreshTokenHash;
      user.updated_at = new Date().toISOString();
    }
    return;
  }

  await User.findByIdAndUpdate(id, { refreshTokenHash });
};

const updateLastLogin = async (id) => {
  if (!env.useMongoDB) {
    const user = users.find((currentUser) => currentUser.id === id);
    if (user) {
      user.last_login_at = new Date().toISOString();
      user.updated_at = new Date().toISOString();
    }
    return;
  }

  await User.findByIdAndUpdate(id, { lastLoginAt: new Date() });
};

const findUserByEmail = async (email) => {
  if (!env.useMongoDB) {
    return users.find((user) => user.email === email.toLowerCase()) || null;
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  return user ? toAuthUser(user) : null;
};

const findUserById = async (id) => {
  if (!env.useMongoDB) {
    const user = users.find((currentUser) => currentUser.id === id);
    return user ? toPublicUser(user) : null;
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  const user = await User.findById(id);
  return user ? toPublicUser(user) : null;
};

const findAuthUserById = async (id) => {
  if (!env.useMongoDB) {
    return users.find((currentUser) => currentUser.id === id) || null;
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  const user = await User.findById(id);
  return user ? toAuthUser(user) : null;
};

module.exports = {
  User,
  rotateRefreshToken: async (id, previousHash, nextHash, authVersion) => {
    if (env.useMongoDB) {
      const version = authVersion === 0 ? { $or: [{ authVersion: 0 }, { authVersion: { $exists: false } }] } : { authVersion };
      const result = await User.updateOne({ _id: id, refreshTokenHash: previousHash, status: 'ACTIVE', ...version }, { $set: { refreshTokenHash: nextHash } });
      return result.modifiedCount === 1;
    }
    const user = users.find(row => row.id === id && row.refresh_token_hash === previousHash && (row.authVersion || 0) === authVersion && row.status === 'ACTIVE');
    if (!user) return false;
    user.refresh_token_hash = nextHash; return true;
  },
  revokeSessions: async (id) => {
    if (env.useMongoDB) { await User.updateOne({ _id: id }, { $set: { refreshTokenHash: null }, $inc: { authVersion: 1 } }); return; }
    const user = users.find(row => row.id === id);
    if (user) { user.refresh_token_hash = null; user.authVersion = (user.authVersion || 0) + 1; }
  },
  updateStatus: async (id, status) => {
    if (env.useMongoDB) {
      const user = await User.findOneAndUpdate({ _id: id, status: { $ne: status } }, { $set: { status, refreshTokenHash: null }, $inc: { authVersion: 1 } }, { new: true });
      return user ? toPublicUser(user) : findUserById(id);
    }
    const user = users.find(row => row.id === id);
    if (user && user.status !== status) { user.status = status; user.authVersion = (user.authVersion || 0) + 1; user.refresh_token_hash = null; user.updated_at = new Date().toISOString(); }
    return user ? toPublicUser(user) : null;
  },
  listUsers: async () => env.useMongoDB ? (await User.find().sort({ createdAt: -1 }).lean()).map(toPublicUser) : users.map(toPublicUser),
  createUser,
  findUserByEmail,
  findUserByPublicId: async (publicId) => {
    if (!env.useMongoDB) return users.find(user => user.publicId === publicId) || null;
    const user = await User.findOne({ publicId });
    return user ? toAuthUser(user) : null;
  },
  findUserById,
  findAuthUserById,
  updateRefreshToken,
  updateLastLogin,
  toPublicUser
};
