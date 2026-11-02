const authService = require('../services/auth.service');
const { successResponse } = require('../utils/response');

const register = async (req, res, next) => {
  try {
    const data = await authService.register(req.body);
    return successResponse(res, 202, data.deliveryMode === 'development' ? 'Development OTP is ready' : 'Verification code sent to your email', data);
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const data = await authService.login(req.body);
    return successResponse(res, 202, data.deliveryMode === 'development' ? 'Development OTP is ready' : 'Verification code sent to your email', data);
  } catch (error) {
    next(error);
  }
};

const me = async (req, res, next) => {
  try {
    const user = await authService.getCurrentUser(req.user.id);
    return successResponse(res, 200, 'Current user fetched successfully', { user });
  } catch (error) {
    next(error);
  }
};

const refresh = async (req, res, next) => {
  try {
    const data = await authService.refresh(req.body);
    return successResponse(res, 200, 'Token refreshed successfully', data);
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    const data = await authService.logout(req.user.id);
    return successResponse(res, 200, 'Logout successful', data);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  verifyOtp: async (req, res, next) => {
    try { return successResponse(res, 200, 'Email verified', await authService.verifyOtp(req.body)); }
    catch (error) { next(error); }
  },
  register,
  login,
  refresh,
  logout,
  me
};
