/**
 * End-to-end verification of the booking rules against the real database,
 * with WhatsApp delivery stubbed out. Creates test data under reserved phone
 * numbers and restores all settings and schedules when finished.
 *
 * Run with: npm run verify
 */
require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/database');
const env = require('../config/env');

const whatsappService = require('../services/whatsappService');

const outbox = [];
whatsappService.sendTextMessage = async (to, text) => {
  outbox.push({ to, text });
  return { stubbed: true };
};
whatsappService.markMessageAsRead = async () => {};

const messageHandlerService = require('../services/messageHandlerService');
const bookingService = require('../services/bookingService');
const settingsService = require('../services/settingsService');
const counterService = require('../services/counterService');
const processedMessages = require('../utils/processedMessages');

const Booking = require('../models/Booking');
const Conversation = require('../models/Conversation');
const Schedule = require('../models/Schedule');

const { validatePhone, phonesMatch, toLocalNumber } = require('../helpers/phoneHelper');
const { normalizeToken, generateTokenNumber } = require('../helpers/tokenHelper');
const { isGreeting } = require('../helpers/validationHelper');
const {
  calculateReportingTime,
  getTodayDayName,
  parseTimeToMinutes,
  getBookingDate,
} = require('../helpers/timeHelper');

const TEST_NUMBERS = [
  '9000000001',
  '9000000002',
  '9000000003',
  '9000000004',
  '9000000005',
  '9000000006',
];
const waNumber = (local) => `91${local}`;
const ADMIN = toLocalNumber(env.adminPhone);

const results = [];
let messageCounter = 0;

const check = (name, condition, detail = '') => {
  results.push({ name, passed: Boolean(condition), detail });
};

const send = async (from, text) => {
  outbox.length = 0;
  messageCounter += 1;
  await messageHandlerService.handleIncomingMessage(
    from,
    text,
    `selftest-${Date.now()}-${messageCounter}`
  );
  return outbox.map((entry) => entry.text);
};

const lastTo = (phone) => {
  const match = outbox.filter((entry) => phonesMatch(entry.to, phone));
  return match.length ? match[match.length - 1].text : '';
};

const parseClockTime = (label) => {
  const match = String(label).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;
  let hours = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') hours += 12;
  return hours * 60 + Number(match[2]);
};

const runUnitChecks = () => {
  check('Valid 10-digit number accepted', validatePhone('9876543210').valid);
  check('Spaced and prefixed number accepted', validatePhone('+91 98765 43210').valid);
  check('Leading-zero number accepted', validatePhone('09876543210').valid);
  check('Short number rejected', !validatePhone('12345').valid);
  check('Number starting with 1 rejected', !validatePhone('1234567890').valid);
  check('Letters rejected', !validatePhone('hello there').valid);

  check('Same number in two formats matches', phonesMatch('9876543210', '919876543210'));
  check(
    'Different 10-digit numbers do not match',
    !phonesMatch('9182525810', '8252581000')
  );

  check('Token 1 formats as T001', generateTokenNumber(1) === 'T001');
  check('Token 18 formats as T018', generateTokenNumber(18) === 'T018');
  check('Bare number normalises to token', normalizeToken('5') === 'T005');
  check('Lowercase token normalises', normalizeToken('t007') === 'T007');
  check('Invalid token rejected', normalizeToken('abc') === null);

  check('Greeting "Hi" recognised', isGreeting('Hi'));
  check('Greeting "Assalamu Alaikum" recognised', isGreeting('Assalamu Alaikum'));
  check('Greeting with punctuation recognised', isGreeting('hello!'));
  check('Ordinary name not a greeting', !isGreeting('Muhammed Ali'));

  const schedule = {
    morningStart: '10:00',
    morningEnd: '13:00',
    afternoonStart: '14:00',
    afternoonEnd: '16:00',
    tokenLimit: 30,
  };

  const first = calculateReportingTime(schedule, 1, true);
  const last = calculateReportingTime(schedule, 30, true);
  check('First token reports at 10:00 AM', first === '10:00 AM', first);

  const lastMinutes = parseClockTime(last);
  check(
    'Last token reports inside afternoon session',
    lastMinutes >= parseTimeToMinutes('14:00') && lastMinutes <= parseTimeToMinutes('16:00'),
    last
  );

  let allInsideHours = true;
  for (let index = 1; index <= schedule.tokenLimit; index += 1) {
    const minutes = parseClockTime(calculateReportingTime(schedule, index, true));
    const inMorning =
      minutes >= parseTimeToMinutes('10:00') && minutes <= parseTimeToMinutes('13:00');
    const inAfternoon =
      minutes >= parseTimeToMinutes('14:00') && minutes <= parseTimeToMinutes('16:00');
    if (!inMorning && !inAfternoon) allInsideHours = false;
  }
  check('Every reporting time falls inside consultation hours', allInsideHours);

  const fixed = calculateReportingTime(schedule, 12, false);
  check('Static mode returns the session start', fixed.includes('10:00 AM'), fixed);
};

const bookVisitor = async (local, name, place) => {
  const from = waNumber(local);
  const welcome = await send(from, 'Hi');
  const placePrompt = await send(from, name);
  const phonePrompt = await send(from, place);
  const confirmation = await send(from, local);

  return {
    welcome: welcome.join('\n'),
    placePrompt: placePrompt.join('\n'),
    phonePrompt: phonePrompt.join('\n'),
    confirmation: lastTo(from) || confirmation.join('\n'),
    adminNotice: lastTo(ADMIN),
  };
};

const runFlowChecks = async () => {
  const today = getTodayDayName();
  let schedule = await Schedule.findOne({ day: today });
  let createdTempSchedule = false;

  if (!schedule) {
    schedule = await Schedule.create({
      day: today,
      location: 'Self Test Location',
      morningStart: '10:00',
      morningEnd: '13:00',
      afternoonStart: '14:00',
      afternoonEnd: '16:00',
      tokenLimit: 30,
      bookingOpen: true,
      active: true,
    });
    createdTempSchedule = true;
  }

  const originalSchedule = schedule.toObject();
  const settings = await settingsService.getSettings();
  const originalSettings = {
    bookingOpen: settings.bookingOpen,
    consultantOnLeave: settings.consultantOnLeave,
    leaveReason: settings.leaveReason,
  };
  const counterKey = bookingService.tokenCounterKey(new Date());
  const originalSeq = await counterService.peekSequence(counterKey);

  try {
    await Schedule.updateOne(
      { _id: schedule._id },
      { active: true, bookingOpen: true, tokenLimit: 30 }
    );
    await settingsService.updateSettings({
      bookingOpen: true,
      consultantOnLeave: false,
      leaveReason: '',
    });

    // --- Happy path -------------------------------------------------------
    const first = await bookVisitor(TEST_NUMBERS[0], 'Muhammed Ali', 'Kannur');

    check('Greeting returns the welcome message', first.welcome.includes('Full Name'));
    check('Name prompt asks for the place', first.placePrompt.includes('place'));
    check('Place prompt asks for the mobile number', first.phonePrompt.includes('mobile number'));
    check('Visitor receives a confirmation', first.confirmation.includes('Token Number'));
    check(
      'Confirmation names the consultant',
      first.confirmation.includes('Kannavam Thangal')
    );
    check('Admin is notified of the booking', first.adminNotice.includes('New Appointment'));

    const firstBooking = await Booking.findOne({ phone: TEST_NUMBERS[0] });
    check('Booking is stored', Boolean(firstBooking));
    check(
      'Booking captures name and place',
      firstBooking?.visitorName === 'Muhammed Ali' && firstBooking?.place === 'Kannur'
    );
    check(
      'Booking records the consultation day',
      firstBooking?.consultationDay === today,
      `${firstBooking?.consultationDay} vs ${today}`
    );
    check(
      'Reporting time is inside consultation hours',
      (() => {
        const minutes = parseClockTime(firstBooking?.reportingTime);
        if (minutes === null) return false;
        const inMorning =
          minutes >= parseTimeToMinutes(originalSchedule.morningStart) &&
          minutes <= parseTimeToMinutes(originalSchedule.morningEnd);
        const inAfternoon =
          minutes >= parseTimeToMinutes(originalSchedule.afternoonStart) &&
          minutes <= parseTimeToMinutes(originalSchedule.afternoonEnd);
        return inMorning || inAfternoon;
      })(),
      firstBooking?.reportingTime
    );

    // --- Sequential tokens ------------------------------------------------
    const second = await bookVisitor(TEST_NUMBERS[1], 'Abdul Rahman', 'Adhur');
    const secondBooking = await Booking.findOne({ phone: TEST_NUMBERS[1] });
    check('Second visitor is confirmed', second.confirmation.includes('Token Number'));
    check(
      'Token numbers increase by one',
      secondBooking?.tokenSequence === firstBooking?.tokenSequence + 1,
      `${firstBooking?.tokenNumber} then ${secondBooking?.tokenNumber}`
    );

    // --- Duplicate booking ------------------------------------------------
    const duplicateFrom = waNumber(TEST_NUMBERS[0]);
    await send(duplicateFrom, 'Hi');
    await send(duplicateFrom, 'Muhammed Ali');
    await send(duplicateFrom, 'Kannur');
    const duplicateReply = (await send(duplicateFrom, TEST_NUMBERS[0])).join('\n');
    check(
      'Duplicate booking is blocked',
      duplicateReply.includes('already have an appointment'),
      duplicateReply.slice(0, 60)
    );
    check(
      'Duplicate did not create a second row',
      (await Booking.countDocuments({ phone: TEST_NUMBERS[0] })) === 1
    );

    // --- Invalid mobile number -------------------------------------------
    const invalidFrom = waNumber(TEST_NUMBERS[2]);
    await send(invalidFrom, 'Hi');
    await send(invalidFrom, 'Test Visitor');
    await send(invalidFrom, 'Bandichal');
    const invalidReply = (await send(invalidFrom, '12345')).join('\n');
    check('Invalid mobile number is rejected', invalidReply.includes('valid'), invalidReply.slice(0, 60));

    const retryReply = (await send(invalidFrom, TEST_NUMBERS[2])).join('\n');
    check(
      'Flow continues after a corrected number',
      retryReply.includes('Token Number'),
      retryReply.slice(0, 60)
    );

    // --- Cancelled token is never reused ----------------------------------
    const cancelTarget = await Booking.findOne({ phone: TEST_NUMBERS[1] });
    const cancelReply = (await send(waNumber(ADMIN), `cancel ${cancelTarget.tokenNumber}`)).join('\n');
    check('Admin can cancel a booking', cancelReply.includes('cancelled'), cancelReply.slice(0, 60));

    const cancelledAgain = (await send(waNumber(ADMIN), `cancel ${cancelTarget.tokenNumber}`)).join('\n');
    check(
      'Cancelling twice is reported clearly',
      cancelledAgain.includes('already cancelled'),
      cancelledAgain.slice(0, 60)
    );

    await bookVisitor(TEST_NUMBERS[3], 'Yusuf Haji', 'Payyanur');
    const afterCancel = await Booking.findOne({ phone: TEST_NUMBERS[3] });
    check(
      'Token issued after a cancellation is not reused',
      afterCancel && afterCancel.tokenNumber !== cancelTarget.tokenNumber,
      `${cancelTarget.tokenNumber} cancelled, new token ${afterCancel?.tokenNumber}`
    );

    const tokenNumbers = (await bookingService.getAllTodayBookings()).map((b) => b.tokenNumber);
    check(
      'All tokens for the day are unique',
      new Set(tokenNumbers).size === tokenNumbers.length,
      tokenNumbers.join(', ')
    );

    // --- Token limit ------------------------------------------------------
    const activeCount = await bookingService.getActiveBookingCount();
    await Schedule.updateOne({ _id: schedule._id }, { tokenLimit: activeCount });
    const fullFrom = waNumber(TEST_NUMBERS[4]);
    await send(fullFrom, 'Hi');
    await send(fullFrom, 'Full Day Visitor');
    await send(fullFrom, 'Kannur');
    const fullReply = (await send(fullFrom, TEST_NUMBERS[4])).join('\n');
    check(
      'Booking is refused when the limit is reached',
      fullReply.includes('full'),
      fullReply.slice(0, 60)
    );
    await Schedule.updateOne({ _id: schedule._id }, { tokenLimit: 30 });

    // --- Consultant on leave ---------------------------------------------
    await send(waNumber(ADMIN), 'leave Travelling');
    const leaveStatus = await settingsService.getSettings();
    check('Leave closes booking', leaveStatus.consultantOnLeave && !leaveStatus.bookingOpen);

    const leaveFrom = waNumber(TEST_NUMBERS[4]);
    await send(leaveFrom, 'Hi');
    await send(leaveFrom, 'Leave Test');
    await send(leaveFrom, 'Kannur');
    const leaveReply = (await send(leaveFrom, TEST_NUMBERS[4])).join('\n');
    check(
      'Visitor is told the consultant is unavailable',
      leaveReply.includes('unavailable'),
      leaveReply.slice(0, 60)
    );
    check('Leave reason is shown', leaveReply.includes('Travelling'));

    const resumeReply = (await send(waNumber(ADMIN), 'resume')).join('\n');
    check('Resume reopens booking', resumeReply.includes('resumed'));

    // --- Booking closed ---------------------------------------------------
    await send(waNumber(ADMIN), 'close');
    const closedFrom = waNumber(TEST_NUMBERS[5]);
    await send(closedFrom, 'Hi');
    await send(closedFrom, 'Closed Test');
    await send(closedFrom, 'Kannur');
    const closedReply = (await send(closedFrom, TEST_NUMBERS[5])).join('\n');
    check(
      'Booking is refused while closed',
      closedReply.includes('closed'),
      closedReply.slice(0, 60)
    );
    await send(waNumber(ADMIN), 'open');

    // --- Not a consultation day ------------------------------------------
    await Schedule.updateOne({ _id: schedule._id }, { active: false });
    const offDayFrom = waNumber(TEST_NUMBERS[5]);
    await send(offDayFrom, 'Hi');
    await send(offDayFrom, 'Off Day Test');
    await send(offDayFrom, 'Kannur');
    const offDayReply = (await send(offDayFrom, TEST_NUMBERS[5])).join('\n');
    check(
      'Booking is refused on a non-consultation day',
      offDayReply.includes('Tuesday') && offDayReply.includes('Saturday'),
      offDayReply.slice(0, 60)
    );
    await Schedule.updateOne({ _id: schedule._id }, { active: true });

    // --- Admin commands ---------------------------------------------------
    const menu = (await send(waNumber(ADMIN), 'menu')).join('\n');
    check('Menu lists the numbered options', menu.includes('1️⃣') && menu.includes('9️⃣'));

    const status = (await send(waNumber(ADMIN), 'status')).join('\n');
    check(
      'Status reports every required field',
      ['Booking:', 'Leave Status:', 'Consultation Day:', 'Location:', 'Booked Count:', 'Remaining Tokens:'].every(
        (label) => status.includes(label)
      ),
      status.replace(/\n/g, ' | ').slice(0, 120)
    );

    const todayList = (await send(waNumber(ADMIN), 'today')).join('\n');
    check(
      "Today's bookings include an issued token",
      todayList.includes(firstBooking.tokenNumber),
      todayList.slice(0, 60)
    );

    const findReply = (await send(waNumber(ADMIN), `find ${TEST_NUMBERS[0]}`)).join('\n');
    check(
      'Find returns the visitor details',
      findReply.includes('Muhammed Ali') && findReply.includes(firstBooking.tokenNumber)
    );

    const findMissing = (await send(waNumber(ADMIN), 'find 9999999999')).join('\n');
    check('Find reports when nothing matches', findMissing.includes('No booking found'));

    const badLimit = (await send(waNumber(ADMIN), 'limit abc')).join('\n');
    check('Non-numeric limit is rejected', badLimit.includes('Invalid limit'));

    const goodLimit = (await send(waNumber(ADMIN), 'limit 28')).join('\n');
    check('Token limit can be updated', goodLimit.includes('28'), goodLimit.slice(0, 60));
    const limitCheck = await Schedule.findById(schedule._id);
    check('Token limit is persisted', limitCheck.tokenLimit === 28);

    const badDay = (await send(waNumber(ADMIN), 'schedule Funday "Somewhere" 10:00 13:00 14:00 16:00 30')).join('\n');
    check('Invalid weekday is rejected', badDay.includes('Invalid day'), badDay.slice(0, 60));

    const badTime = (await send(waNumber(ADMIN), 'schedule Tuesday "Somewhere" 13:00 10:00 14:00 16:00 30')).join('\n');
    check('Reversed times are rejected', badTime.includes('Invalid time'), badTime.slice(0, 60));

    const badFormat = (await send(waNumber(ADMIN), 'schedule Tuesday Adhur 10:00')).join('\n');
    check('Malformed schedule command is explained', badFormat.includes('Usage'));

    const unknown = (await send(waNumber(ADMIN), 'opne')).join('\n');
    check('Unknown admin command is reported', unknown.includes('Unknown command'), unknown.slice(0, 60));

    const nonAdminMenu = (await send(waNumber('9000000009'), 'menu')).join('\n');
    check(
      'Admin commands from other numbers are ignored',
      !nonAdminMenu.includes('Appointment Manager'),
      nonAdminMenu.slice(0, 60)
    );
    await Conversation.deleteOne({ phone: waNumber('9000000009') });

    // --- Duplicate webhook delivery --------------------------------------
    processedMessages.remember('duplicate-check');
    check('Repeat webhook delivery is detected', processedMessages.isDuplicate('duplicate-check'));
  } finally {
    await Booking.deleteMany({
      $or: [
        { phone: { $in: TEST_NUMBERS } },
        { whatsappNumber: { $in: TEST_NUMBERS } },
      ],
    });
    await Conversation.deleteMany({
      phone: { $in: [...TEST_NUMBERS.map(waNumber), waNumber(ADMIN), ADMIN] },
    });

    if (createdTempSchedule) {
      await Schedule.deleteOne({ _id: schedule._id });
    } else {
      await Schedule.updateOne(
        { _id: schedule._id },
        {
          location: originalSchedule.location,
          morningStart: originalSchedule.morningStart,
          morningEnd: originalSchedule.morningEnd,
          afternoonStart: originalSchedule.afternoonStart,
          afternoonEnd: originalSchedule.afternoonEnd,
          tokenLimit: originalSchedule.tokenLimit,
          bookingOpen: originalSchedule.bookingOpen,
          active: originalSchedule.active,
        }
      );
    }

    await settingsService.updateSettings(originalSettings);
    await counterService.setSequence(bookingService.tokenCounterKey(new Date()), originalSeq);
  }
};

// Prefers the configured database, but falls back to a throwaway in-memory
// MongoDB so the suite still runs when Atlas is unreachable.
const connectForVerification = async () => {
  const startInMemory = async () => {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri('kannavam-verify'));

    return {
      mode: 'temporary in-memory database',
      cleanup: async () => {
        await mongoose.disconnect();
        await server.stop();
      },
    };
  };

  if (process.env.VERIFY_MEMORY === '1') {
    return startInMemory();
  }

  try {
    await connectDB();
    return { mode: 'configured database', cleanup: disconnectDB };
  } catch (error) {
    console.log(`Configured database unreachable: ${error.message.split('.')[0]}.`);
    console.log('Falling back to a temporary in-memory database.\n');
    return startInMemory();
  }
};

const printReport = () => {
  const passed = results.filter((result) => result.passed);
  const failed = results.filter((result) => !result.passed);

  console.log('\n─── Verification report ───\n');
  for (const result of results) {
    const mark = result.passed ? 'PASS' : 'FAIL';
    const detail = result.detail && !result.passed ? `  → ${result.detail}` : '';
    console.log(`${mark}  ${result.name}${detail}`);
  }

  console.log(`\n${passed.length} passed, ${failed.length} failed, ${results.length} total\n`);
  return failed.length === 0;
};

const run = async () => {
  console.log('Running verification against the configured database...');
  console.log(`Timezone: ${env.timezone} · Today: ${getTodayDayName()}`);
  console.log(`Booking date key: ${getBookingDate().toISOString().slice(0, 10)}\n`);

  runUnitChecks();

  const connection = await connectForVerification();
  console.log(`Running database checks against the ${connection.mode}.`);

  try {
    await runFlowChecks();
  } finally {
    await connection.cleanup();
  }

  const ok = printReport();
  process.exit(ok ? 0 : 1);
};

run().catch(async (error) => {
  console.error('\nVerification crashed:', error);
  try {
    await mongoose.disconnect();
  } catch {
    // already disconnected
  }
  printReport();
  process.exit(1);
});
