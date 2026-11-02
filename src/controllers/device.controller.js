const deviceService = require('../services/device.service');
const { successResponse } = require('../utils/response');

const listDevices = async (req, res, next) => {
  try {
    const devices = await deviceService.listDevices(req.user.id);
    return successResponse(res, 200, 'Devices fetched successfully', { devices });
  } catch (error) {
    next(error);
  }
};

const addDevice = async (req, res, next) => {
  try {
    const device = await deviceService.addDevice(req.user.id, req.body, req.requestId);
    return successResponse(res, 201, 'Device saved successfully', { device });
  } catch (error) {
    next(error);
  }
};

const removeDevice = async (req, res, next) => {
  try {
    const device = await deviceService.removeDevice(req.user.id, req.params.id, req.requestId);
    return successResponse(res, 200, 'Device removed successfully', { device });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listDevices,
  addDevice,
  removeDevice
};
