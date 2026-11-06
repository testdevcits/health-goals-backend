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

const syncDailySteps = async (req, res, next) => {
  try {
    const result = await healthService.syncDailySteps(req.user.id, req.body);
    return successResponse(res, result.updated ? 200 : 201, 'Daily steps synced successfully', result);
  } catch (error) { next(error); }
};

const getRecords = async (req, res, next) => {
  try {
    const result = await healthService.getRecordsPage(req.user.id, req.query);
    return successResponse(res, 200, 'Health records fetched successfully', result);
  } catch (error) {
    next(error);
  }
};

const getHistory = async (req, res, next) => {
  try {
    const history = await healthService.getDailyHistory(req.user.id, req.query);
    return successResponse(res, 200, 'Daily health history fetched successfully', { history });
  } catch (error) { next(error); }
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
  syncDailySteps,
  getRecords,
  getHistory,
  getSummary,
  getDashboard
};
