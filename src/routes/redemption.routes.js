const express = require('express');
const rewardController = require('../controllers/reward.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', authenticate, rewardController.listRedemptions);
router.get('/:id', authenticate, rewardController.getRedemption);

module.exports = router;
