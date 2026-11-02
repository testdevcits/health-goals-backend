const deviceModel = require('../models/device.model');
const { AppError } = require('../middleware/error.middleware');
const auditModel = require('../models/audit.model');

const listDevices = (userId) => deviceModel.getDevicesByUserId(userId);

const addDevice = async (userId, payload, requestId) => {
  if (!payload.deviceType || !payload.deviceIdentifier) {
    throw new AppError('deviceType and deviceIdentifier are required', 400);
  }

  const device = await deviceModel.createDevice(userId, payload);
  await auditModel.createAuditLog({
    userId,
    action: 'DEVICE_ADDED',
    metadata: { deviceId: device.id, platform: device.platform },
    requestId
  });
  return device;
};

const removeDevice = async (userId, id, requestId) => {
  const device = await deviceModel.removeDevice(userId, id);
  if (!device) {
    throw new AppError('Device not found', 404);
  }

  await auditModel.createAuditLog({
    userId,
    action: 'DEVICE_REMOVED',
    metadata: { deviceId: id },
    requestId
  });

  return device;
};

module.exports = {
  listDevices,
  addDevice,
  removeDevice
};
