/**
 * End-to-end verification of the booking rules against the real database,
 * with WhatsApp delivery stubbed out. Creates test data under reserved phone
 * numbers and restores all settings and schedules when finished.
 *
 * Run with: npm run verify
 */
require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB, disconnectDB, ensureBookingTokenIndex } = require('../config/database');
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
const DayLeave = require('../models/DayLeave');

const { validatePhone, phonesMatch, toLocalNumber } = require('../helpers/phoneHelper');
const { normalizeToken, generateTokenNumber } = require('../helpers/tokenHelper');
const { isGreeting } = require('../helpers/validationHelper');
const {
  calculateReportingTime,
  getTodayDayName,
  parseTimeToMinutes,
  getBookingDate,
  addLocalDays,
} = require('../helpers/timeHelper');

const TEST_NUMBERS = [
  '9000000001',
  '9000000002',
  '9000000003',
  '9000000004',
  '9000000005',
  '9000000006',
  '9000000007',
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

  const { parseFlexibleTime, parseTimeRanges, isWithinAdvanceBookingWindow, addLocalDays, getBookingDate } =
    require('../helpers/timeHelper');
  check('Flexible time parses 10am', parseFlexibleTime('10am') === '10:00');
  check('Flexible time parses 12 pm', parseFlexibleTime('12 pm') === '12:00');
  check('Flexible time parses 1:30pm', parseFlexibleTime('1:30pm') === '13:30');
  check(
    'Time ranges parse morning and afternoon',
    (() => {
      const ranges = parseTimeRanges('10am to 12pm 1pm to 4pm');
      return (
        ranges?.length === 2 &&
        ranges[0].start === '10:00' &&
        ranges[0].end === '12:00' &&
        ranges[1].start === '13:00' &&
        ranges[1].end === '16:00'
      );
    })()
  );

  const consultation = addLocalDays(new Date(), 1);
  const priorNoonUtc = new Date(
    `${getBookingDate(addLocalDays(consultation, -1)).toISOString().slice(0, 10)}T06:30:00.000Z`
  ); // ~12:00 IST
  check(
    'Booking window open on the day before consultation',
    isWithinAdvanceBookingWindow(priorNoonUtc, consultation)
  );

  // 08:30 IST = 03:00 UTC, 10:00 IST = 04:30 UTC on the consultation date.
  const consultKey = getBookingDate(consultation).toISOString().slice(0, 10);
  const eightThirtyIst = new Date(`${consultKey}T03:00:00.000Z`);
  const tenAmIst = new Date(`${consultKey}T04:30:00.000Z`);
  check(
    'Booking window open before 9 AM on consultation morning',
    isWithinAdvanceBookingWindow(eightThirtyIst, consultation),
    eightThirtyIst.toISOString()
  );
  check(
    'Booking window closed after 9 AM on consultation morning',
    !isWithinAdvanceBookingWindow(tenAmIst, consultation),
    tenAmIst.toISOString()
  );

  const { phoneLookupCandidates } = require('../helpers/phoneHelper');
  check(
    'Phone lookup matches WhatsApp and local forms',
    phoneLookupCandidates('919876543210').includes('9876543210') &&
      phoneLookupCandidates('9876543210').includes('919876543210')
  );

  const schedule = {
    morningStart: '10:00',
    morningEnd: '13:00',
    afternoonStart: '14:00',
    afternoonEnd: '16:00',
    tokenLimit: 30,
  };

  const first = calculateReportingTime(schedule, 1);
  const second = calculateReportingTime(schedule, 2);
  const last = calculateReportingTime(schedule, 30);
  check('First token reports at 10:00 AM', first === '10:00 AM', first);
  check('Second token is 10 minutes later', second === '10:10 AM', second);

  const lastMinutes = parseClockTime(last);
  check(
    'Last token reports inside afternoon session',
    lastMinutes >= parseTimeToMinutes('14:00') && lastMinutes <= parseTimeToMinutes('16:00'),
    last
  );

  let allInsideHours = true;
  for (let index = 1; index <= schedule.tokenLimit; index += 1) {
    const minutes = parseClockTime(calculateReportingTime(schedule, index));
    const inMorning =
      minutes >= parseTimeToMinutes('10:00') && minutes <= parseTimeToMinutes('13:00');
    const inAfternoon =
      minutes >= parseTimeToMinutes('14:00') && minutes <= parseTimeToMinutes('16:00');
    if (!inMorning && !inAfternoon) allInsideHours = false;
  }
  check('Every reporting time falls inside consultation hours', allInsideHours);
};

const bookVisitor = async (local, name, place, members = 2) => {
  const from = waNumber(local);
  const welcome = await send(from, 'Hi');
  const placePrompt = await send(from, name);
  const phonePrompt = await send(from, place);
  const membersPrompt = await send(from, local);
  await send(from, String(members));

  const visitorTexts = outbox
    .filter((entry) => phonesMatch(entry.to, from))
    .map((entry) => entry.text);
  const confirmation =
    visitorTexts.find((text) => text.includes('Token Number')) ||
    visitorTexts.join('\n');
  const locationPin =
    visitorTexts.find((text) => text.includes('Open map:') || text.includes('maps.')) || '';

  return {
    welcome: welcome.join('\n'),
    placePrompt: placePrompt.join('\n'),
    phonePrompt: phonePrompt.join('\n'),
    membersPrompt: membersPrompt.join('\n'),
    confirmation,
    locationPin,
    adminNotice: lastTo(ADMIN),
  };
};

const runFlowChecks = async () => {
  await ensureBookingTokenIndex();

  const bookableDate = addLocalDays(new Date(), 1);
  const bookableDay = getTodayDayName(bookableDate);
  let schedule = await Schedule.findOne({ day: bookableDay });
  let createdTempSchedule = false;

  if (!schedule) {
    schedule = await Schedule.create({
      day: bookableDay,
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
  const otherSchedules = await Schedule.find({ _id: { $ne: schedule._id } });
  const otherScheduleSnapshots = otherSchedules.map((item) => item.toObject());

  const settings = await settingsService.getSettings();
  const originalSettings = {
    bookingOpen: settings.bookingOpen,
    consultantOnLeave: settings.consultantOnLeave,
    leaveReason: settings.leaveReason,
  };
  const counterKey = bookingService.tokenCounterKey(bookableDate);
  const originalSeq = await counterService.peekSequence(counterKey);

  try {
    // Keep only the next bookable day's schedule active so the suite matches
    // the real rule: visitors book a consultation on the previous day only.
    await Schedule.updateMany({ _id: { $ne: schedule._id } }, { active: false });
    await Schedule.updateOne(
      { _id: schedule._id },
      { active: true, bookingOpen: true, tokenLimit: 30 }
    );
    await DayLeave.deleteMany({});
    // Clear every booking for the bookable consultation day so leftover live
    // tokens (T002, T003, …) cannot collide with this suite.
    await Booking.deleteMany({
      $or: [
        { phone: { $in: TEST_NUMBERS } },
        { whatsappNumber: { $in: TEST_NUMBERS } },
        { bookingDate: getBookingDate(bookableDate) },
      ],
    });
    await Conversation.deleteMany({
      phone: { $in: [...TEST_NUMBERS.map(waNumber), waNumber(ADMIN), ADMIN] },
    });
    await counterService.setSequence(counterKey, 0);
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
    check(
      'Phone prompt asks for family members',
      first.membersPrompt.toLowerCase().includes('members'),
      first.membersPrompt.slice(0, 60)
    );
    check('Visitor receives a confirmation', first.confirmation.includes('Token Number'));
    check(
      'Confirmation includes member count',
      first.confirmation.includes('Members'),
      first.confirmation.slice(0, 80)
    );
    check(
      'Confirmation asks to arrive 30 minutes early',
      first.confirmation.includes('30 minutes'),
      first.confirmation.slice(0, 100)
    );
    check(
      'Visitor receives a location map link',
      first.locationPin.includes('maps.') || first.locationPin.includes('Open map:'),
      first.locationPin.slice(0, 80)
    );
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
      firstBooking?.consultationDay === bookableDay,
      `${firstBooking?.consultationDay} vs ${bookableDay}`
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
    const hiAgain = (await send(duplicateFrom, 'Hi')).join('\n');
    check(
      'Hi again shows existing token immediately',
      hiAgain.includes('already have an appointment') &&
        hiAgain.includes(firstBooking.tokenNumber),
      hiAgain.slice(0, 100)
    );

    await send(duplicateFrom, 'Muhammed Ali');
    await send(duplicateFrom, 'Kannur');
    await send(duplicateFrom, TEST_NUMBERS[0]);
    const duplicateReply = (await send(duplicateFrom, '2')).join('\n');
    check(
      'Duplicate booking is blocked even mid-flow',
      duplicateReply.includes('already have an appointment') ||
        duplicateReply.includes(firstBooking.tokenNumber),
      duplicateReply.slice(0, 80)
    );
    check(
      'Duplicate did not create a second row',
      (await Booking.countDocuments({ phone: TEST_NUMBERS[0], status: 'BOOKED' })) === 1
    );

    // --- Invalid mobile number -------------------------------------------
    const invalidFrom = waNumber(TEST_NUMBERS[2]);
    await send(invalidFrom, 'Hi');
    await send(invalidFrom, 'Test Visitor');
    await send(invalidFrom, 'Bendichal');
    const invalidReply = (await send(invalidFrom, '12345')).join('\n');
    check('Invalid mobile number is rejected', invalidReply.includes('valid'), invalidReply.slice(0, 60));

    const membersAsk = (await send(invalidFrom, TEST_NUMBERS[2])).join('\n');
    check(
      'Flow continues after a corrected number',
      membersAsk.toLowerCase().includes('members'),
      membersAsk.slice(0, 60)
    );
    const retryReply = (await send(invalidFrom, '3')).join('\n');
    check(
      'Members step completes the booking',
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
    // Fill every consultation day whose token window is open right now, so
    // the system cannot silently skip to Tuesday/Wednesday instead.
    const snapshotForLimit = await bookingService.getAvailabilitySnapshot();
    const openWindowDays = (snapshotForLimit.upcoming || []).filter((d) => d.windowOpen);
    for (const day of openWindowDays) {
      // eslint-disable-next-line no-await-in-loop
      const count = await bookingService.getActiveBookingCount(day.date);
      // eslint-disable-next-line no-await-in-loop
      await Schedule.updateOne({ day: day.dayName }, { tokenLimit: Math.max(1, count) });
    }
    const fullFrom = waNumber(TEST_NUMBERS[4]);
    const fullReply = (await send(fullFrom, 'Hi')).join('\n');
    check(
      'Booking is refused when the limit is reached',
      fullReply.toLowerCase().includes('full'),
      fullReply.slice(0, 80)
    );
    for (const day of openWindowDays) {
      // eslint-disable-next-line no-await-in-loop
      await Schedule.updateOne(
        { day: day.dayName },
        { tokenLimit: day.dayName === bookableDay ? 30 : day.schedule.tokenLimit }
      );
    }
    await Schedule.updateOne({ _id: schedule._id }, { tokenLimit: 30 });

    // --- Day-specific leave ----------------------------------------------
    const leaveTargetDay = bookableDay;
    const beforeLeave = await bookVisitor(TEST_NUMBERS[6], 'Leave Notify', 'Adhur');
    check(
      'Leave-notify visitor was booked first',
      beforeLeave.confirmation.includes('Token Number')
    );
    const leaveBooking = await Booking.findOne({ phone: TEST_NUMBERS[6] });

    const leaveAdminReply = (
      await send(waNumber(ADMIN), `leave ${leaveTargetDay} Travelling`)
    ).join('\n');
    check(
      'Day leave is confirmed to admin',
      leaveAdminReply.toLowerCase().includes('leave set') ||
        leaveAdminReply.includes(leaveTargetDay),
      leaveAdminReply.slice(0, 100)
    );
    check(
      'Day leave notifies and cancels existing bookings',
      /Cancelled bookings:\s*[1-9]/.test(leaveAdminReply) &&
        /Visitors notified:\s*[1-9]/.test(leaveAdminReply),
      leaveAdminReply.match(/Cancelled bookings:.*|Visitors notified:.*/g)?.join(' | ') ||
        leaveAdminReply.slice(0, 120)
    );

    const cancelledLeaveBooking = await Booking.findById(leaveBooking._id);
    check(
      'Leave cancels the visitor booking',
      cancelledLeaveBooking?.status === 'CANCELLED'
    );

    const leaveFrom = waNumber(TEST_NUMBERS[4]);
    const leaveReply = (await send(leaveFrom, 'Hi')).join('\n');
    // Today is on leave — visitor should either be offered another day or
    // be told this day is on leave with a next-opening hint.
    check(
      'Visitor is guided away from a leave day',
      leaveReply.toLowerCase().includes('leave') ||
        leaveReply.includes('Full Name') ||
        leaveReply.includes('Wednesday') ||
        leaveReply.includes('Saturday') ||
        leaveReply.includes('Tuesday'),
      leaveReply.slice(0, 100)
    );

    const resumeReply = (await send(waNumber(ADMIN), `resume ${leaveTargetDay}`)).join('\n');
    check(
      'Resume clears day leave',
      resumeReply.toLowerCase().includes('open again') ||
        resumeReply.toLowerCase().includes('leave cleared') ||
        resumeReply.toLowerCase().includes('cleared'),
      resumeReply.slice(0, 80)
    );

    // Re-book after leave cancelled earlier tokens, so later list checks have data.
    const afterResume = await bookVisitor(TEST_NUMBERS[0], 'Muhammed Ali', 'Kannur');
    const firstBookingAfterLeave = await Booking.findOne({
      phone: TEST_NUMBERS[0],
      status: 'BOOKED',
    });
    check(
      'Visitor can book again after leave is cleared',
      afterResume.confirmation.includes('Token Number') && Boolean(firstBookingAfterLeave)
    );
    check(
      'Tokens restart at T001 after leave reopen',
      firstBookingAfterLeave?.tokenNumber === 'T001' &&
        firstBookingAfterLeave?.tokenSequence === 1,
      `${firstBookingAfterLeave?.tokenNumber} seq=${firstBookingAfterLeave?.tokenSequence}`
    );
    check(
      'Reporting time restarts at morning start after leave reopen',
      String(firstBookingAfterLeave?.reportingTime || '').includes('10:00'),
      firstBookingAfterLeave?.reportingTime
    );

    // --- Venue change notifies booked visitors ---------------------------
    const venueChangeReply = (await send(waNumber(ADMIN), `change bendichal ${bookableDay}`)).join(
      '\n'
    );
    const bookingAfterVenue = await Booking.findById(firstBookingAfterLeave._id);
    const venueNotice = lastTo(TEST_NUMBERS[0]);
    check(
      'Admin venue change confirms update',
      venueChangeReply.includes('Venue updated') &&
        venueChangeReply.toLowerCase().includes('bendichal') &&
        venueChangeReply.includes('Visitors notified'),
      venueChangeReply.slice(0, 120)
    );
    check(
      'Booked visitor is notified of venue change',
      venueNotice.includes('السَّلاَمُ عَلَيْكُمْ') &&
        venueNotice.includes(firstBookingAfterLeave.tokenNumber) &&
        venueNotice.toLowerCase().includes('bendichal') &&
        venueNotice.includes('maps.app.goo.gl'),
      venueNotice.slice(0, 120)
    );
    check(
      'Booking location is updated after venue change',
      String(bookingAfterVenue?.consultationLocation || '')
        .toLowerCase()
        .includes('bendichal'),
      bookingAfterVenue?.consultationLocation
    );

    // --- Booking closed (global pause) ------------------------------------
    await send(waNumber(ADMIN), 'close');
    const closedFrom = waNumber(TEST_NUMBERS[5]);
    const closedReply = (await send(closedFrom, 'Hi')).join('\n');
    check(
      'Booking is refused while closed',
      closedReply.toLowerCase().includes('paused') ||
        closedReply.toLowerCase().includes('closed'),
      closedReply.slice(0, 80)
    );
    await send(waNumber(ADMIN), 'open');

    // --- Not a consultation day ------------------------------------------
    await Schedule.updateMany({}, { active: false });
    const offDayFrom = waNumber(TEST_NUMBERS[5]);
    const offDayReply = (await send(offDayFrom, 'Hi')).join('\n');
    check(
      'Booking is refused when no consultation days are active',
      !offDayReply.includes('Full Name') &&
        (offDayReply.toLowerCase().includes('no consultation') ||
          offDayReply.includes('Tuesday') ||
          offDayReply.includes('Saturday') ||
          offDayReply.toLowerCase().includes('closed') ||
          offDayReply.toLowerCase().includes('paused')),
      offDayReply.slice(0, 80)
    );
    await Schedule.updateMany({ _id: { $ne: schedule._id } }, { active: false });
    await Schedule.updateOne({ _id: schedule._id }, { active: true, bookingOpen: true });

    // --- Admin commands ---------------------------------------------------
    const menu = (await send(waNumber(ADMIN), 'menu')).join('\n');
    check('Menu lists the numbered options', menu.includes('1️⃣') && menu.includes('9️⃣'));

    const status = (await send(waNumber(ADMIN), 'status')).join('\n');
    check(
      'Status reports every required field',
      ['All booking:', 'Active Consultation:', 'Location:', 'Booked Count:', 'Remaining Tokens:', 'Day leaves:'].every(
        (label) => status.includes(label)
      ),
      status.replace(/\n/g, ' | ').slice(0, 120)
    );

    const upcoming = (await send(waNumber(ADMIN), 'upcoming')).join('\n');
    check(
      'Upcoming lists consultation dates',
      upcoming.includes('Upcoming Consultations') && upcoming.includes(bookableDay),
      upcoming.slice(0, 80)
    );

    const todayList = (await send(waNumber(ADMIN), 'today')).join('\n');
    check(
      "Today's bookings include an issued token",
      todayList.includes(firstBookingAfterLeave.tokenNumber),
      todayList.slice(0, 60)
    );

    const findReply = (await send(waNumber(ADMIN), `find ${TEST_NUMBERS[0]}`)).join('\n');
    check(
      'Find returns the visitor details',
      findReply.includes('Muhammed Ali') && findReply.includes(firstBookingAfterLeave.tokenNumber)
    );

    const findMissing = (await send(waNumber(ADMIN), 'find 9999999999')).join('\n');
    check('Find reports when nothing matches', findMissing.includes('No booking found'));

    const badLimit = (await send(waNumber(ADMIN), 'limit abc')).join('\n');
    check('Non-numeric limit is rejected', badLimit.includes('Invalid limit'));

    const goodLimit = (await send(waNumber(ADMIN), 'limit 28')).join('\n');
    check('Token limit can be updated', goodLimit.includes('28'), goodLimit.slice(0, 60));
    const limitCheck = await Schedule.findById(schedule._id);
    check('Token limit is persisted', limitCheck?.tokenLimit === 28);

    const badDay = (await send(waNumber(ADMIN), 'schedule Funday "Somewhere" 10:00 13:00 14:00 16:00 30')).join('\n');
    check('Invalid weekday is rejected', badDay.includes('Invalid day'), badDay.slice(0, 60));

    const badTime = (await send(waNumber(ADMIN), 'schedule Tuesday "Somewhere" 13:00 10:00 14:00 16:00 30')).join('\n');
    check('Reversed times are rejected', badTime.includes('Invalid time'), badTime.slice(0, 60));

    const badFormat = (await send(waNumber(ADMIN), 'schedule Tuesday Adhur 10:00')).join('\n');
    check('Malformed schedule command is explained', badFormat.includes('Usage'));

    const timeMorning = (
      await send(waNumber(ADMIN), `change time ${bookableDay} 10am to 12pm`)
    ).join('\n');
    const scheduleAfterMorning = await Schedule.findById(schedule._id);
    check(
      'Change time morning-only updates morning hours',
      timeMorning.includes('Hours updated') &&
        timeMorning.includes('10:00 AM') &&
        timeMorning.includes('12:00 PM') &&
        timeMorning.toLowerCase().includes('morning only') &&
        scheduleAfterMorning?.morningStart === '10:00' &&
        scheduleAfterMorning?.morningEnd === '12:00' &&
        scheduleAfterMorning?.afternoonStart === '12:00' &&
        scheduleAfterMorning?.afternoonEnd === '12:00',
      timeMorning.slice(0, 160)
    );

    const timeBoth = (
      await send(waNumber(ADMIN), `change time ${bookableDay} 10am to 1pm 2pm to 4pm`)
    ).join('\n');
    const scheduleAfterBoth = await Schedule.findById(schedule._id);
    check(
      'Change time both sessions updates morning and afternoon',
      timeBoth.includes('Hours updated') &&
        timeBoth.includes('10:00 AM') &&
        timeBoth.includes('1:00 PM') &&
        timeBoth.includes('2:00 PM') &&
        timeBoth.includes('4:00 PM') &&
        scheduleAfterBoth?.morningEnd === '13:00' &&
        scheduleAfterBoth?.afternoonStart === '14:00' &&
        scheduleAfterBoth?.afternoonEnd === '16:00',
      timeBoth.slice(0, 160)
    );

    await Conversation.deleteMany({ phone: { $in: [waNumber(ADMIN), ADMIN] } });
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
    await DayLeave.deleteMany({});

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

    for (const snapshot of otherScheduleSnapshots) {
      // eslint-disable-next-line no-await-in-loop
      await Schedule.updateOne(
        { _id: snapshot._id },
        {
          active: snapshot.active,
          bookingOpen: snapshot.bookingOpen,
          tokenLimit: snapshot.tokenLimit,
          location: snapshot.location,
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
