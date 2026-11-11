const mongoose = require('mongoose');
const env = require('../config/env');
const crypto = require('crypto');

const deviceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceType: { type: String, required: true },
    manufacturer: { type: String, default: null },
    model: { type: String, default: null },
    platform: { type: String, default: 'android' },
    deviceIdentifier: { type: String, required: true },
    lastSyncAt: { type: Date, default: null },
    status: { type: String, enum: ['ACTIVE', 'REMOVED'], default: 'ACTIVE' }
  },
  { timestamps: true }
);

deviceSchema.index({ userId: 1, deviceIdentifier: 1 }, { unique: true });

deviceSchema.index({ createdAt: -1, _id: -1 });
deviceSchema.index({ userId: 1, createdAt: -1, _id: -1 });
deviceSchema.index({ status: 1, createdAt: -1, _id: -1 });
const Device = mongoose.model('Device', deviceSchema);
const devices = [];

const toDevice = (device) => ({
  id: device.id || device._id.toString(),
  userId: device.userId || device.user_id,
  deviceType: device.deviceType || device.device_type,
  manufacturer: device.manufacturer,
  model: device.model,
  platform: device.platform,
  deviceIdentifier: device.deviceIdentifier || device.device_identifier,
  lastSyncAt: device.lastSyncAt || device.last_sync_at,
  status: device.status,
  createdAt: device.createdAt || device.created_at,
  updatedAt: device.updatedAt || device.updated_at
});

const createDevice = async (userId, payload) => {
  if (!env.useMongoDB) {
    const now = new Date().toISOString();
    const existing = devices.find(
      (device) => device.user_id === userId && device.device_identifier === payload.deviceIdentifier
    );

    if (existing) {
      existing.status = 'ACTIVE';
      existing.updated_at = now;
      return toDevice(existing);
    }

    const device = {
      id: crypto.randomUUID(),
      user_id: userId,
      device_type: payload.deviceType,
      manufacturer: payload.manufacturer || null,
      model: payload.model || null,
      platform: payload.platform || 'android',
      device_identifier: payload.deviceIdentifier,
      last_sync_at: null,
      status: 'ACTIVE',
      created_at: now,
      updated_at: now
    };

    devices.push(device);
    return toDevice(device);
  }

  const device = await Device.findOneAndUpdate(
    { userId, deviceIdentifier: payload.deviceIdentifier },
    {
      userId,
      deviceType: payload.deviceType,
      manufacturer: payload.manufacturer || null,
      model: payload.model || null,
      platform: payload.platform || 'android',
      deviceIdentifier: payload.deviceIdentifier,
      status: 'ACTIVE'
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return toDevice(device);
};

const getDevicesByUserId = async (userId) => {
  if (!env.useMongoDB) {
    return devices
      .filter((device) => device.user_id === userId && device.status === 'ACTIVE')
      .map(toDevice);
  }

  const rows = await Device.find({ userId, status: 'ACTIVE' }).sort({ createdAt: -1 });
  return rows.map(toDevice);
};

const removeDevice = async (userId, id) => {
  if (!env.useMongoDB) {
    const device = devices.find((row) => row.id === id && row.user_id === userId);
    if (!device) return null;
    device.status = 'REMOVED';
    device.updated_at = new Date().toISOString();
    return toDevice(device);
  }

  const device = await Device.findOneAndUpdate(
    { _id: id, userId },
    { status: 'REMOVED' },
    { new: true }
  );
  return device ? toDevice(device) : null;
};

const setAdminDeviceStatus = async (id, status) => {
  if (!env.useMongoDB) {
    const row = devices.find(device => device.id === id);
    if (!row) return null;
    row.status = status; row.updated_at = new Date().toISOString(); return toDevice(row);
  }
  const row = await Device.findByIdAndUpdate(id, { status }, { new: true });
  return row ? toDevice(row) : null;
};

const touchDeviceSync = async (userId, deviceIdentifier) => {
  if (!deviceIdentifier) return;

  if (!env.useMongoDB) {
    const device = devices.find(
      (row) => row.user_id === userId && (row.device_identifier === deviceIdentifier || row.id === deviceIdentifier) && row.status === 'ACTIVE'
    );
    if (device) {
      device.last_sync_at = new Date().toISOString();
    }
    return;
  }

  await Device.findOneAndUpdate(
    { userId, status: 'ACTIVE', $or: [{ deviceIdentifier }, ...(mongoose.isValidObjectId(deviceIdentifier) ? [{ _id: deviceIdentifier }] : [])] },
    { lastSyncAt: new Date() }
  );
};

const userOwnsDevice = async (userId, deviceIdentifier) => {
  if (!deviceIdentifier) return true;

  if (!env.useMongoDB) {
    return devices.some(
      (device) =>
        device.user_id === userId &&
        (device.device_identifier === deviceIdentifier || device.id === deviceIdentifier) &&
        device.status === 'ACTIVE'
    );
  }

  const device = await Device.exists({ userId, status: 'ACTIVE', $or: [{ deviceIdentifier }, ...(mongoose.isValidObjectId(deviceIdentifier) ? [{ _id: deviceIdentifier }] : [])] });
  return Boolean(device);
};

module.exports = {
  listAdmin: async () => env.useMongoDB ? (await Device.find().sort({ createdAt: -1 }).lean()).map(toDevice) : devices.map(toDevice),
  Device,
  createDevice,
  getDevicesByUserId,
  removeDevice,
  setAdminDeviceStatus,
  touchDeviceSync,
  userOwnsDevice
};
