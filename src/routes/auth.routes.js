const express = require('express');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authLimiter } = require('../middleware/rate-limit.middleware');

const router = express.Router();

router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.post('/verify-otp', authLimiter, authController.verifyOtp);
router.post('/password/forgot', authLimiter, authController.requestPasswordReset);
router.post('/password/reset', authLimiter, authController.resetPassword);
router.post('/google', authLimiter, authController.google);
router.post('/refresh', authLimiter, authController.refresh);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);
router.patch('/me', authenticate, authController.updateProfile);
router.patch('/me/goals', authenticate, authController.updateHealthGoal);
router.post('/me/profile-image', authenticate, authController.uploadProfileImage);
router.post('/me/device', authenticate, authController.updateDeviceProfile);

module.exports = router;
