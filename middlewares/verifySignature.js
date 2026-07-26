const crypto = require('crypto');
const env = require('../config/env');
const logger = require('../utils/logger');

// Confirms the payload really came from Meta. Skipped when no app secret is
// configured so local testing with curl or ngrok still works.
const verifySignature = (req, res, next) => {
  if (!env.whatsapp.appSecret) return next();

  const signature = req.get('x-hub-signature-256');

  if (!signature || !req.rawBody) {
    logger.warn('Webhook rejected: missing signature');
    return res.sendStatus(401);
  }

  const expected = `sha256=${crypto
    .createHmac('sha256', env.whatsapp.appSecret)
    .update(req.rawBody)
    .digest('hex')}`;

  const received = Buffer.from(signature);
  const computed = Buffer.from(expected);

  if (received.length !== computed.length || !crypto.timingSafeEqual(received, computed)) {
    logger.warn('Webhook rejected: invalid signature');
    return res.sendStatus(401);
  }

  return next();
};

module.exports = verifySignature;
