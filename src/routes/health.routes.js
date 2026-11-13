const express = require('express');
const healthController = require('../controllers/health.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { syncLimiter } = require('../middleware/rate-limit.middleware');

const router = express.Router();

router.post('/records', authenticate, syncLimiter, healthController.createRecord);
router.post('/sync', authenticate, syncLimiter, healthController.syncRecords);
router.get('/sync', authenticate, healthController.getRecords);
router.post('/steps/daily', authenticate, syncLimiter, healthController.syncDailySteps);
router.get('/records', authenticate, healthController.getRecords);
router.get('/history', authenticate, healthController.getHistory);
router.get('/trends', authenticate, healthController.getTrends);
router.get('/summary', authenticate, healthController.getSummary);
router.get('/dashboard', authenticate, healthController.getDashboard);

module.exports = router;
