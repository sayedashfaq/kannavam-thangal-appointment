const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');
const { formatPhoneForWhatsApp } = require('../helpers/phoneHelper');

const MAX_BODY_LENGTH = 3900;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 15000;

// Splits on line boundaries where possible so tables of bookings stay readable
// when they exceed the WhatsApp body limit.
const splitIntoChunks = (text, maxLength = MAX_BODY_LENGTH) => {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let current = '';

  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;

    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);

    if (line.length <= maxLength) {
      current = line;
    } else {
      for (let i = 0; i < line.length; i += maxLength) {
        const slice = line.slice(i, i + maxLength);
        if (i + maxLength >= line.length) {
          current = slice;
        } else {
          chunks.push(slice);
        }
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
};

const isRetryable = (error) => {
  const status = error.response?.status;
  if (!status) return true;
  return status === 429 || status >= 500;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class WhatsAppService {
  constructor() {
    this.client = axios.create({
      baseURL: `${env.whatsapp.apiUrl}/${env.whatsapp.apiVersion}`,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${env.whatsapp.token}`,
        'Content-Type': 'application/json',
      },
    });
    this.messagesPath = `/${env.whatsapp.phoneNumberId}/messages`;
  }

  async post(payload, { retryable = true } = {}) {
    let lastError;

    for (let attempt = 1; attempt <= (retryable ? MAX_ATTEMPTS : 1); attempt += 1) {
      try {
        const response = await this.client.post(this.messagesPath, payload);
        return response.data;
      } catch (error) {
        lastError = error;

        if (!retryable || !isRetryable(error) || attempt === MAX_ATTEMPTS) break;

        await delay(attempt * 1000);
      }
    }

    throw lastError;
  }

  async sendTextMessage(to, text, { previewUrl = false } = {}) {
    const recipient = formatPhoneForWhatsApp(to);

    if (!recipient) {
      logger.warn('Skipped WhatsApp message with empty recipient');
      return null;
    }

    const chunks = splitIntoChunks(String(text));
    let lastResult = null;

    for (const chunk of chunks) {
      try {
        lastResult = await this.post({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'text',
          text: { preview_url: Boolean(previewUrl), body: chunk },
        });

        logger.info('Outgoing WhatsApp message', {
          to: recipient,
          preview: chunk.slice(0, 120),
        });
      } catch (error) {
        logger.error('Failed to send WhatsApp message', {
          to: recipient,
          error: error.response?.data?.error?.message || error.message,
          status: error.response?.status,
        });
        throw error;
      }
    }

    return lastResult;
  }

  async markMessageAsRead(messageId) {
    try {
      await this.post(
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        },
        { retryable: false }
      );
    } catch (error) {
      logger.debug('Could not mark message as read', {
        messageId,
        error: error.response?.data?.error?.message || error.message,
      });
    }
  }
}

module.exports = new WhatsAppService();
