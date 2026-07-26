const express = require('express');
const webhookController = require('../controllers/webhookController');
const verifySignature = require('../middlewares/verifySignature');

const router = express.Router();

router.get('/webhook', webhookController.verifyWebhook);
router.post('/webhook', verifySignature, webhookController.handleWebhook);
router.get('/health', webhookController.healthCheck);
router.get('/debug/last-verify', webhookController.lastVerifyDebug);

module.exports = router;
