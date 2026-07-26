/**
 * Live smoke test against the running server on localhost:3000.
 * Posts real webhook payloads and attempts a real outbound WhatsApp send.
 */
require('dotenv').config();
const axios = require('axios');
const env = require('../config/env');

const BASE = `http://127.0.0.1:${env.port || 3000}`;
const results = [];

const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  → ${detail}` : ''}`);
};

const webhookPayload = (from, text, id) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'TEST_WABA',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '15551372874',
              phone_number_id: env.whatsapp.phoneNumberId,
            },
            contacts: [{ wa_id: from, profile: { name: 'Live Tester' } }],
            messages: [
              {
                from,
                id: id || `wamid.LIVE.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
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

const postMessage = async (from, text) => {
  const response = await axios.post(`${BASE}/webhook`, webhookPayload(from, text), {
    validateStatus: () => true,
    timeout: 20000,
  });
  // Give the async handler a moment to finish
  await new Promise((r) => setTimeout(r, 1500));
  return response.status;
};

const run = async () => {
  console.log(`\nLive smoke test → ${BASE}\n`);

  // 1. Health
  try {
    const health = await axios.get(`${BASE}/health`, { timeout: 10000 });
    check('Health endpoint', health.status === 200 && health.data.status === 'ok', JSON.stringify(health.data));
  } catch (error) {
    check('Health endpoint', false, error.message);
    printSummary();
    process.exit(1);
  }

  // 2. Webhook verification (what Meta does)
  try {
    const verify = await axios.get(`${BASE}/webhook`, {
      params: {
        'hub.mode': 'subscribe',
        'hub.verify_token': env.whatsapp.verifyToken,
        'hub.challenge': 'challenge_ok_123',
      },
      timeout: 10000,
      transformResponse: [(data) => data],
    });
    check(
      'Webhook verify handshake',
      verify.status === 200 && String(verify.data) === 'challenge_ok_123',
      `status=${verify.status} body=${verify.data}`
    );
  } catch (error) {
    check('Webhook verify handshake', false, error.message);
  }

  // 3. Bad verify token rejected
  try {
    const bad = await axios.get(`${BASE}/webhook`, {
      params: {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong_token',
        'hub.challenge': 'nope',
      },
      validateStatus: () => true,
      timeout: 10000,
    });
    check('Bad verify token rejected', bad.status === 403, `status=${bad.status}`);
  } catch (error) {
    check('Bad verify token rejected', false, error.message);
  }

  // 4. Visitor greeting via webhook
  const visitor = '919000001111';
  try {
    const status = await postMessage(visitor, 'Hi');
    check('Visitor Hi accepted by webhook', status === 200, `status=${status}`);
  } catch (error) {
    check('Visitor Hi accepted by webhook', false, error.message);
  }

  // 5. Continue booking flow
  try {
    await postMessage(visitor, 'Live Test Visitor');
    await postMessage(visitor, 'Kannur');
    const status = await postMessage(visitor, '9000001111');
    check('Booking flow webhook chain accepted', status === 200, `status=${status}`);
  } catch (error) {
    check('Booking flow webhook chain accepted', false, error.message);
  }

  // 6. Admin menu via webhook
  const admin = env.adminPhone;
  try {
    const status = await postMessage(admin, 'menu');
    check('Admin menu webhook accepted', status === 200, `status=${status}`);
  } catch (error) {
    check('Admin menu webhook accepted', false, error.message);
  }

  try {
    const status = await postMessage(admin, 'status');
    check('Admin status webhook accepted', status === 200, `status=${status}`);
  } catch (error) {
    check('Admin status webhook accepted', false, error.message);
  }

  // 7. Real outbound WhatsApp API call to admin
  try {
    const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${env.whatsapp.phoneNumberId}/messages`;
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: admin,
        type: 'text',
        text: {
          body:
            '✅ Kannavam Thangal system live test\n\nYour appointment server is reachable and the WhatsApp API token works.\n\nReply *menu* after the webhook is connected.',
        },
      },
      {
        headers: {
          Authorization: `Bearer ${env.whatsapp.token}`,
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
        timeout: 20000,
      }
    );

    const ok = response.status >= 200 && response.status < 300;
    const detail = ok
      ? `message_id=${response.data?.messages?.[0]?.id || 'ok'}`
      : JSON.stringify(response.data?.error || response.data).slice(0, 200);

    check('Real WhatsApp send to admin number', ok, detail);

    if (!ok && response.data?.error?.code === 131030) {
      console.log(
        '\nNote: Meta test numbers can only message numbers on the allow list.\nAdd your admin number in Meta → WhatsApp → API Setup → Manage phone number list.\n'
      );
    }
  } catch (error) {
    check('Real WhatsApp send to admin number', false, error.message);
  }

  // 8. Confirm booking exists for today if consultation day
  try {
    const mongoose = require('mongoose');
    await mongoose.connect(env.mongodbUri);
    const Booking = require('../models/Booking');
    const { getBookingDate } = require('../helpers/timeHelper');
    const count = await Booking.countDocuments({
      bookingDate: getBookingDate(),
      phone: '9000001111',
    });
    // Today is Sunday — booking should be refused, so 0 is expected
    const day = require('../helpers/timeHelper').getTodayDayName();
    if (['Tuesday', 'Wednesday', 'Saturday'].includes(day)) {
      check('Booking saved for visitor', count >= 1, `count=${count}`);
    } else {
      check(
        'Non-consultation day correctly has no booking',
        count === 0,
        `today=${day} count=${count}`
      );
    }
    await mongoose.disconnect();
  } catch (error) {
    check('Database booking check', false, error.message);
  }

  printSummary();
};

const printSummary = () => {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${passed} passed, ${failed} failed, ${results.length} total\n`);
  process.exit(failed ? 1 : 0);
};

run().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
