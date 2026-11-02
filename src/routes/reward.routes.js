const express = require('express');
const rewardController = require('../controllers/reward.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { redemptionLimiter } = require('../middleware/rate-limit.middleware');

const router = express.Router();

router.get('/', authenticate, rewardController.listRewards);
router.post('/:id/redeem', authenticate, redemptionLimiter, rewardController.redeemReward);

module.exports = router;
