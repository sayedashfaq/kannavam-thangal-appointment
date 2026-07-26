const messageHandlerService = require('../services/messageHandlerService');
const processedMessages = require('../utils/processedMessages');
const env = require('../config/env');
const logger = require('../utils/logger');

const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.whatsapp.verifyToken) {
    logger.info('Webhook verified successfully');
    return res.status(200).send(challenge);
  }

  logger.warn('Webhook verification failed', { mode });
  return res.sendStatus(403);
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
};
