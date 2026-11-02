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

const updateDeviceProfile = async (req, res, next) => {
  try {
    const user = await authService.updateCurrentDeviceProfile(req.user.id, req.body);
    return successResponse(res, 200, 'Phone profile saved successfully', { user });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const user = await authService.updateCurrentProfile(req.user.id, req.body);
    return successResponse(res, 200, 'Profile updated successfully', { user });
  } catch (error) { next(error); }
};

const updateHealthGoal = async (req, res, next) => {
  try {
    const user = await authService.updateCurrentHealthGoal(req.user.id, req.body);
    return successResponse(res, 200, 'Health goal saved successfully', { user });
  } catch (error) { next(error); }
};

const uploadProfileImage = async (req, res, next) => {
  try {
    const result = await require('../services/cloudinary.service').uploadProfileImage(req.body?.image, req.user.id);
    const user = await require('../models/user.model').updateProfileImage(req.user.id, result.url);
    if (!user) throw new (require('../middleware/error.middleware').AppError)('User not found', 404);
    return successResponse(res, 200, 'Profile image uploaded to Cloudinary', { user });
  } catch (error) { next(error); }
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
  requestPasswordReset: async (req, res, next) => {
    try { return successResponse(res, 202, 'If the account exists, a reset code has been sent', await authService.requestPasswordReset(req.body)); }
    catch (error) { next(error); }
  },
  resetPassword: async (req, res, next) => {
    try { return successResponse(res, 200, 'Password reset successfully', await authService.resetPassword(req.body)); }
    catch (error) { next(error); }
  },
  google: async (req, res, next) => {
    try { return successResponse(res, 200, 'Google sign-in successful', await authService.loginWithGoogle(req.body)); }
    catch (error) { next(error); }
  },
  register,
  login,
  refresh,
  logout,
  me,
  updateDeviceProfile,
  updateProfile,
  updateHealthGoal,
  uploadProfileImage
};
