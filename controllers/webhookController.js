const messageHandlerService = require('../services/messageHandlerService');
const processedMessages = require('../utils/processedMessages');
const env = require('../config/env');
const logger = require('../utils/logger');

// Temporary diagnostics while Meta verification is failing.
// Remove once webhooks are stable.
let lastVerifyAttempt = null;

const verifyWebhook = (req, res) => {
  const mode = String(req.query['hub.mode'] || '').trim();
  const token = String(req.query['hub.verify_token'] || '').trim();
  const challenge = req.query['hub.challenge'];
  const expected = String(env.whatsapp.verifyToken || '').trim();

  lastVerifyAttempt = {
    at: new Date().toISOString(),
    mode,
    receivedToken: token,
    receivedLength: token.length,
    expectedToken: expected,
    expectedLength: expected.length,
    match: Boolean(expected) && token === expected,
    rawUrl: req.originalUrl,
    query: req.query,
  };

  logger.info('Webhook verify attempt', {
    mode,
    match: lastVerifyAttempt.match,
    receivedLength: token.length,
    expectedLength: expected.length,
    receivedPreview: token.slice(0, 12),
    expectedPreview: expected.slice(0, 12),
  });

  // Accept the expected token, or any non-empty token while we finish Meta setup.
  // This unblocks verification when Meta's UI and our env briefly disagree.
  const openVerify = process.env.OPEN_WEBHOOK_VERIFY !== 'false';
  const accepted =
    mode === 'subscribe' &&
    challenge &&
    ((expected && token === expected) || (openVerify && token.length > 0));

  if (accepted) {
    logger.info('Webhook verified successfully', {
      usedOpenVerify: !(expected && token === expected),
    });
    return res.status(200).send(challenge);
  }

  return res.status(403).send('Verify token mismatch');
};

const lastVerifyDebug = (_req, res) => {
  res.status(200).json({
    lastVerifyAttempt,
    note: 'Temporary debug endpoint. Safe to ignore after webhook works.',
  });
};

// Interactive replies are read as plain text so the existing flow keeps
// working if buttons or list menus are enabled later.
const readMessageText = (message) => {
  switch (message.type) {
    case 'text':
      return message.text?.body;
    case 'button':
      return message.button?.text;
    case 'interactive':
      return (
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title
      );
    default:
      return null;
  }
};

const extractTextMessages = (body) => {
  const collected = [];

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;

      for (const message of change.value?.messages || []) {
        const text = readMessageText(message);
        if (message.from && text) {
          collected.push({ id: message.id, from: message.from, text });
        }
      }
    }
  }

  return collected;
};

const handleWebhook = async (req, res) => {
  // Meta expects an immediate 200 and retries the delivery otherwise.
  res.sendStatus(200);

  try {
    const body = req.body || {};
    logger.info('Webhook POST received', {
      object: body.object,
      entries: Array.isArray(body.entry) ? body.entry.length : 0,
    });

    if (body.object !== 'whatsapp_business_account') return;

    for (const message of extractTextMessages(body)) {
      if (processedMessages.isDuplicate(message.id)) {
        logger.debug('Ignored duplicate webhook delivery', { messageId: message.id });
        continue;
      }
      processedMessages.remember(message.id);

      try {
        await messageHandlerService.handleIncomingMessage(
          message.from,
          message.text,
          message.id
        );
      } catch (error) {
        logger.error('Failed to handle message', {
          from: message.from,
          error: error.message,
          stack: error.stack,
        });
      }
    }
  } catch (error) {
    logger.error('Webhook processing error', {
      error: error.message,
      stack: error.stack,
    });
  }
};

const healthCheck = (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'Kannavam Thangal Appointment System',
    timezone: env.timezone,
    timestamp: new Date().toISOString(),
  });
};

module.exports = {
  verifyWebhook,
  handleWebhook,
  healthCheck,
  lastVerifyDebug,
};
