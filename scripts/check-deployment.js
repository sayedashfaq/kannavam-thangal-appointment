/**
 * Verifies the deployed service end to end: posts a webhook payload to the
 * live URL and confirms the message was processed and persisted in MongoDB.
 */
require('dotenv').config();

const axios = require('axios');
const mongoose = require('mongoose');
const env = require('../config/env');

const LIVE_URL =
  process.env.LIVE_URL || 'https://kannavam-thangal-appointment.onrender.com';
const TEST_WA_NUMBER = '919000007777';

const payload = (text) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'LIVE_CHECK',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: env.whatsapp.phoneNumberId },
            messages: [
              {
                from: TEST_WA_NUMBER,
                id: `wamid.LIVECHECK.${Date.now()}`,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: 'text',
                text: { body: text },
              },
            ],
          },
        },
      ],
    },
  ],
});

const run = async () => {
  console.log(`Checking deployment: ${LIVE_URL}\n`);

  const health = await axios.get(`${LIVE_URL}/health`, { timeout: 60000 });
  console.log('Health:', JSON.stringify(health.data));

  const verify = await axios.get(`${LIVE_URL}/webhook`, {
    params: {
      'hub.mode': 'subscribe',
      'hub.verify_token': env.whatsapp.verifyToken,
      'hub.challenge': 'live_challenge_42',
    },
    timeout: 30000,
    transformResponse: [(data) => data],
  });
  console.log(
    'Webhook handshake:',
    verify.status === 200 && String(verify.data) === 'live_challenge_42' ? 'OK' : 'MISMATCH'
  );

  const post = await axios.post(`${LIVE_URL}/webhook`, payload('Hi'), {
    timeout: 30000,
  });
  console.log('Webhook POST status:', post.status);

  console.log('\nWaiting for the service to process the message...');
  await new Promise((resolve) => setTimeout(resolve, 6000));

  await mongoose.connect(env.mongodbUri, { serverSelectionTimeoutMS: 20000 });
  const Conversation = require('../models/Conversation');

  const conversation = await Conversation.findOne({ phone: TEST_WA_NUMBER });

  if (conversation) {
    console.log('\nLive service processed the message and saved state:');
    console.log(`  phone:       ${conversation.phone}`);
    console.log(`  currentStep: ${conversation.currentStep}`);
    console.log(`  updatedAt:   ${conversation.updatedAt.toISOString()}`);
    await Conversation.deleteOne({ _id: conversation._id });
    console.log('\nTest conversation removed. Deployment is working.');
  } else {
    console.log('\nNo conversation record found. The deployed service did not');
    console.log('process the webhook, or it points at a different database.');
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('\nCheck failed:', error.response?.data || error.message);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
