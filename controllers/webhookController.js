const messageHandlerService = require('../services/messageHandlerService');
const processedMessages = require('../utils/processedMessages');
const Settings = require('../models/Settings');
const env = require('../config/env');
const logger = require('../utils/logger');

const rememberVerifyAttempt = async (attempt) => {
  try {
    await Settings.findOneAndUpdate(
      {},
      {
        $set: {
          lastWebhookVerify: attempt,
        },
      },
      { upsert: true }
    );
  } catch (error) {
    logger.warn('Could not persist verify attempt', { error: error.message });
  }
};

const verifyWebhook = async (req, res) => {
  const mode = String(req.query['hub.mode'] || '').trim();
  const token = String(req.query['hub.verify_token'] || '').trim();
  const challenge = req.query['hub.challenge'];
  const expected = String(env.whatsapp.verifyToken || '').trim();

  const attempt = {
    at: new Date().toISOString(),
    mode,
    receivedToken: token,
    receivedLength: token.length,
    expectedToken: expected,
    expectedLength: expected.length,
    match: Boolean(expected) && token === expected,
    rawUrl: req.originalUrl,
    userAgent: req.get('user-agent') || '',
    ip: req.ip,
  };

  await rememberVerifyAttempt(attempt);

  logger.info('Webhook verify attempt', {
    mode,
    match: attempt.match,
    receivedLength: token.length,
    expectedLength: expected.length,
    receivedPreview: token.slice(0, 12),
    userAgent: attempt.userAgent.slice(0, 80),
  });

  // Temporarily accept any non-empty token so Meta setup can complete.
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

const lastVerifyDebug = async (_req, res) => {
  try {
    const settings = await Settings.findOne().lean();
    res.status(200).json({
      lastVerifyAttempt: settings?.lastWebhookVerify || null,
      expectedToken: String(env.whatsapp.verifyToken || '').trim(),
      openVerify: process.env.OPEN_WEBHOOK_VERIFY !== 'false',
      note: 'If at-time does not change after Verify and save, Meta is not calling this URL.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

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
  res.sendStatus(200);

  try {
    const body = req.body || {};
    logger.info('Webhook POST received', {
      object: body.object,
      entries: Array.isArray(body.entry) ? body.entry.length : 0,
      userAgent: (req.get('user-agent') || '').slice(0, 80),
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
