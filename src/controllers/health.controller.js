const healthService = require('../services/health.service');
const { successResponse } = require('../utils/response');

const serverHealth = (req, res) => {
  return successResponse(res, 200, 'Server is healthy', {
    status: 'ok',
    timestamp: new Date().toISOString()
  });
};

const createRecord = async (req, res, next) => {
  try {
    const result = await healthService.createRecord(req.user.id, req.body, req.requestId);
    return successResponse(res, result.duplicate ? 200 : 201, 'Health record processed successfully', result);
  } catch (error) {
    next(error);
  }
};

const syncRecords = async (req, res, next) => {
  try {
    const result = await healthService.syncRecords(req.user.id, req.body, req.requestId);
    return successResponse(res, 200, 'Health sync processed successfully', result);
  } catch (error) {
    next(error);
  }
};

const getRecords = async (req, res, next) => {
  try {
    const records = await healthService.getRecords(req.user.id, {
      metricType: req.query.metricType
    });
    return successResponse(res, 200, 'Health records fetched successfully', { records });
  } catch (error) {
    next(error);
  }
};

const getDashboard = async (req, res, next) => {
  try {
    const dashboard = await healthService.getDashboard(req.user.id);
    return successResponse(res, 200, 'Health dashboard fetched successfully', dashboard);
  } catch (error) {
    next(error);
  }
};

const getSummary = async (req, res, next) => {
  try {
    const summary = await healthService.getSummary(req.user.id);
    return successResponse(res, 200, 'Health summary fetched successfully', summary);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  serverHealth,
  createRecord,
  syncRecords,
  getRecords,
  getSummary,
  getDashboard
};
