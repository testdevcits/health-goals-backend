const express = require('express');
const rewardController = require('../controllers/reward.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { redemptionLimiter } = require('../middleware/rate-limit.middleware');

const router = express.Router();

router.get('/competitions',authenticate,async(req,res,next)=>{try{const engine=require('../services/reward-engine.service');await engine.evaluate();require('../utils/response').successResponse(res,200,'Rule competitions',await engine.forUser(req.user.id));}catch(error){next(error);}});

router.get('/', authenticate, rewardController.listRewards);
router.post('/:id/redeem', authenticate, redemptionLimiter, rewardController.redeemReward);

module.exports = router;
