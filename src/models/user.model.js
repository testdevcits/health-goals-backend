const mongoose = require('mongoose');
const env = require('../config/env');
const crypto = require('crypto');

const deviceProfileSchema = new mongoose.Schema({
  deviceIdentifier: { type: String, default: null },
  deviceType: { type: String, default: 'phone' },
  manufacturer: { type: String, default: null },
  brand: { type: String, default: null },
  model: { type: String, default: null },
  platform: { type: String, default: 'android' },
  osVersion: { type: String, default: null },
  appVersion: { type: String, default: null },
  lastSeenAt: { type: Date, default: Date.now }
}, { _id: false });

const userSchema = new mongoose.Schema(
  {
    publicId: { type: String, unique: true, sparse: true, immutable: true },
    name: {
      type: String,
      required: true,
      trim: true
    },
    companyCode: { type: String, default: '' },
    goal: { type: String, default: '' },
    healthGoals: { type: Map, of: Number, default: {} },
    heightCm: { type: Number, default: null },
    weightKg: { type: Number, default: null },
    birthDate: { type: String, default: '' },
    gender: { type: String, default: '' },
    profileAnswers: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    profileImageUrl: { type: String, default: '' },
    activeGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityGroup', default: null, index: true },
    encryptedPhone: { type: String, default: null, select: false },
    deviceProfile: { type: deviceProfileSchema, default: null },
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
      enum: ['USER', 'ADMIN', 'SUB_ADMIN'],
      default: 'USER'
    },
    adminPermissions: { type: [String], default: null },
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
  companyCode: user.companyCode || '',
  goal: user.goal || '',
  healthGoals: user.healthGoals instanceof Map ? Object.fromEntries(user.healthGoals) : (user.healthGoals || {}),
  heightCm: user.heightCm ?? user.height_cm ?? null,
  weightKg: user.weightKg ?? user.weight_kg ?? null,
  birthDate: user.birthDate || user.birth_date || '',
  gender: user.gender || '',
  profileAnswers: user.profileAnswers instanceof Map ? Object.fromEntries(user.profileAnswers) : (user.profileAnswers || {}),
  profileImageUrl: user.profileImageUrl || user.profile_image_url || '',
  deviceProfile: user.deviceProfile || user.device_profile || null,
  email: user.email,
  authVersion: user.authVersion || 0,
  status: user.status || 'ACTIVE',
  role: user.role || 'USER',
  adminPermissions: user.adminPermissions ?? user.admin_permissions ?? null,
  lastLoginAt: user.lastLoginAt || user.last_login_at || null,
  createdAt: user.createdAt || user.created_at,
  updatedAt: user.updatedAt || user.updated_at
});

const toAuthUser = (user) => ({
  ...toPublicUser(user),
  password_hash: user.passwordHash || user.password_hash,
  refresh_token_hash: user.refreshTokenHash || user.refresh_token_hash
});

const toProfileUser = user => ({ ...toPublicUser(user), phone: user.encryptedPhone ? require('../services/voucher-code.service').decrypt(user.encryptedPhone) : '' });

const createUser = async ({ name, email, passwordHash, role = 'USER', companyCode = '', goal = '', adminPermissions = null }) => {
  const publicId = `USR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  if (!env.useMongoDB) {
    const now = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(),
      name,
      companyCode,
      goal,
      gender: '',
      heightCm: null,
      weightKg: null,
      birthDate: '',
      profileAnswers: {},
      publicId,
      email: email.toLowerCase(),
      password_hash: passwordHash,
      status: 'ACTIVE',
      role,
      admin_permissions: adminPermissions,
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
    companyCode,
    goal,
    gender: '',
    email,
    passwordHash,
    role,
    adminPermissions: role === 'SUB_ADMIN' ? null : adminPermissions
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
  updateAdminPermissions: async (id, adminPermissions) => {
    if (env.useMongoDB) { const user=await User.findOneAndUpdate({_id:id,role:'SUB_ADMIN'},{$set:{adminPermissions}},{new:true});return user?toPublicUser(user):null; }
    const user=users.find(row=>row.id===id&&row.role==='SUB_ADMIN');if(!user)return null;user.admin_permissions=[...adminPermissions];user.updated_at=new Date().toISOString();return toPublicUser(user);
  },
  listUsers: async () => env.useMongoDB ? (await User.find().sort({ createdAt: -1 }).lean()).map(toPublicUser) : users.map(toPublicUser),
  listAdministrators: async () => {
    const rows = env.useMongoDB
      ? await User.find({ $or: [{ role: { $in: ['ADMIN', 'SUB_ADMIN'] } }, { email: { $in: env.adminEmails } }] }).sort({ createdAt: -1 }).lean()
      : users.filter(user => ['ADMIN', 'SUB_ADMIN'].includes(user.role) || env.adminEmails.includes(user.email));
    return rows.map(row => ({ ...toPublicUser(row), role: env.adminEmails.includes(String(row.email).toLowerCase()) ? 'ADMIN' : row.role }));
  },
  findUserProfileById: async (id) => {
    if (!env.useMongoDB) { const user=users.find(row=>row.id===id); return user?toProfileUser(user):null; }
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const user=await User.findById(id).select('+encryptedPhone'); return user?toProfileUser(user):null;
  },
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
  updateDeviceProfile: async (id, profile) => {
    if (!env.useMongoDB) {
      const user = users.find((currentUser) => currentUser.id === id);
      if (!user) return null;
      user.device_profile = { ...profile, lastSeenAt: new Date().toISOString() };
      user.updated_at = new Date().toISOString();
      return toPublicUser(user);
    }
    const user = await User.findByIdAndUpdate(id, {
      $set: { deviceProfile: { ...profile, lastSeenAt: new Date() } }
    }, { new: true });
    return user ? toPublicUser(user) : null;
  },
  updateProfile: async (id, profile) => {
    if (!env.useMongoDB) {
      const user = users.find((currentUser) => currentUser.id === id);
      if (!user) return null;
      Object.assign(user, profile, { updated_at: new Date().toISOString() });
      return toProfileUser(user);
    }
    const user = await User.findByIdAndUpdate(id, { $set: profile }, { new: true, runValidators: true }).select('+encryptedPhone');
    return user ? toProfileUser(user) : null;
  },
  updateHealthGoal: async (id, metricType, targetValue) => {
    if (!env.useMongoDB) {
      const user = users.find((currentUser) => currentUser.id === id);
      if (!user) return null;
      user.healthGoals = { ...(user.healthGoals || {}), [metricType]: targetValue };
      user.updated_at = new Date().toISOString();
      return toPublicUser(user);
    }
    const user = await User.findByIdAndUpdate(id, { $set: { [`healthGoals.${metricType}`]: targetValue } }, { new: true, runValidators: true });
    return user ? toPublicUser(user) : null;
  },
  updateProfileImage: async (id, profileImageUrl) => {
    if (!env.useMongoDB) {
      const user = users.find(currentUser => currentUser.id === id);
      if (!user) return null;
      user.profileImageUrl = profileImageUrl;
      user.updated_at = new Date().toISOString();
      return toPublicUser(user);
    }
    const user = await User.findByIdAndUpdate(id, { $set: { profileImageUrl } }, { new: true });
    return user ? toPublicUser(user) : null;
  },
  updatePassword: async (id, passwordHash) => {
    if (!env.useMongoDB) {
      const user = users.find((currentUser) => currentUser.id === id);
      if (!user) return false;
      user.password_hash = passwordHash;
      user.refresh_token_hash = null;
      user.authVersion = (user.authVersion || 0) + 1;
      user.updated_at = new Date().toISOString();
      return true;
    }
    const result = await User.updateOne({ _id: id }, {
      $set: { passwordHash, refreshTokenHash: null },
      $inc: { authVersion: 1 }
    });
    return result.modifiedCount === 1;
  },
  toPublicUser
};
