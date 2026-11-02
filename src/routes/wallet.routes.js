const express = require('express');
const walletController = require('../controllers/wallet.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', authenticate, walletController.getWallet);

module.exports = router;
