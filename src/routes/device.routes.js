const express = require('express');
const deviceController = require('../controllers/device.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', authenticate, deviceController.listDevices);
router.post('/', authenticate, deviceController.addDevice);
router.delete('/:id', authenticate, deviceController.removeDevice);

module.exports = router;
