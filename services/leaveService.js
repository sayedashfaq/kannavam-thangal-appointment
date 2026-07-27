const DayLeave = require('../models/DayLeave');
const Booking = require('../models/Booking');
const { BOOKING_STATUS } = require('../constants');
const {
  getBookingDate,
  getDateKey,
  getTodayDayName,
  addLocalDays,
  formatDisplayDate,
  formatConsultationLabel,
} = require('../helpers/timeHelper');
const { capitalizeDay, isValidWeekday } = require('../helpers/validationHelper');
const scheduleService = require('./scheduleService');
const whatsappService = require('./whatsappService');
const messages = require('../constants/messages');
const logger = require('../utils/logger');

const DAY_ALIASES = {
  sun: 'Sunday',
  sunday: 'Sunday',
  mon: 'Monday',
  monday: 'Monday',
  tue: 'Tuesday',
  tues: 'Tuesday',
  tuesday: 'Tuesday',
  wed: 'Wednesday',
  weds: 'Wednesday',
  wednesday: 'Wednesday',
  thu: 'Thursday',
  thur: 'Thursday',
  thurs: 'Thursday',
  thursday: 'Thursday',
  fri: 'Friday',
  friday: 'Friday',
  sat: 'Saturday',
  saturday: 'Saturday',
};

const parseDayName = (value) => {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (DAY_ALIASES[key]) return DAY_ALIASES[key];
  if (isValidWeekday(value)) return capitalizeDay(value);
  return null;
};

/**
 * Parses `tuesday`, `next saturday Travelling`, `tue emergency`.
 */
const parseLeaveArgument = (argument) => {
  const tokens = String(argument || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return { ok: false, error: 'MISSING_DAY' };
  }

  let index = 0;
  if (tokens[0].toLowerCase() === 'next') index += 1;

  const dayName = parseDayName(tokens[index]);
  if (!dayName) {
    return { ok: false, error: 'INVALID_DAY' };
  }

  const reason = tokens.slice(index + 1).join(' ').trim();
  return { ok: true, dayName, reason };
};

const findNextConsultationDateForDay = async (dayName, fromDate = new Date()) => {
  const target = capitalizeDay(dayName);

  for (let offset = 0; offset < 21; offset += 1) {
    const candidate = addLocalDays(fromDate, offset);
    if (getTodayDayName(candidate) !== target) continue;

    // eslint-disable-next-line no-await-in-loop
    const schedule = await scheduleService.getTodaySchedule(candidate);
    if (schedule) {
      return {
        date: candidate,
        dayName: target,
        schedule,
        displayDate: formatDisplayDate(candidate),
        label: formatConsultationLabel(candidate, fromDate),
      };
    }
  }

  return null;
};

const getLeaveForDate = async (date) =>
  DayLeave.findOne({ leaveDate: getBookingDate(date) });

const isDateOnLeave = async (date) => Boolean(await getLeaveForDate(date));

const getActiveLeaves = async (fromDate = new Date()) => {
  const start = getBookingDate(fromDate);
  return DayLeave.find({ leaveDate: { $gte: start } }).sort({ leaveDate: 1 });
};

const visitorNotifyNumber = (booking) =>
  booking.whatsappNumber || booking.phone || '';

const cancelAndNotifyBookingsForDate = async (target, reason) => {
  const bookings = await Booking.find({
    bookingDate: getBookingDate(target.date),
    status: BOOKING_STATUS.BOOKED,
  }).sort({ tokenSequence: 1 });

  let notifiedCount = 0;
  let cancelledCount = 0;

  for (const booking of bookings) {
    booking.status = BOOKING_STATUS.CANCELLED;
    // eslint-disable-next-line no-await-in-loop
    await booking.save();
    cancelledCount += 1;

    const to = visitorNotifyNumber(booking);
    if (!to) continue;

    const text = messages.LEAVE_NOTICE_TO_VISITOR({
      visitorName: booking.visitorName,
      tokenNumber: booking.tokenNumber,
      label: target.label,
      displayDate: target.displayDate,
      reason,
    });

    try {
      // eslint-disable-next-line no-await-in-loop
      await whatsappService.sendTextMessage(to, text);
      notifiedCount += 1;
    } catch (error) {
      logger.error('Failed to notify visitor about leave', {
        tokenNumber: booking.tokenNumber,
        to,
        error: error.message,
      });
    }
  }

  return { notifiedCount, cancelledCount, bookings };
};

const setDayLeave = async (dayName, reason = '', fromDate = new Date()) => {
  const target = await findNextConsultationDateForDay(dayName, fromDate);
  if (!target) {
    return { ok: false, error: 'NO_CONSULTATION_DAY' };
  }

  const existing = await getLeaveForDate(target.date);
  if (existing) {
    return {
      ok: false,
      error: 'ALREADY_ON_LEAVE',
      target,
      leave: existing,
    };
  }

  const { notifiedCount, cancelledCount } = await cancelAndNotifyBookingsForDate(
    target,
    reason
  );

  const leave = await DayLeave.create({
    leaveDate: getBookingDate(target.date),
    dayName: target.dayName,
    reason,
    notifiedCount,
    cancelledCount,
  });

  logger.info('Day leave set', {
    dayName: target.dayName,
    date: getDateKey(target.date),
    reason,
    notifiedCount,
    cancelledCount,
  });

  return {
    ok: true,
    target,
    leave,
    notifiedCount,
    cancelledCount,
  };
};

const clearDayLeave = async (dayName, fromDate = new Date()) => {
  const target = await findNextConsultationDateForDay(dayName, fromDate);
  if (!target) {
    return { ok: false, error: 'NO_CONSULTATION_DAY' };
  }

  const leave = await getLeaveForDate(target.date);
  if (!leave) {
    return { ok: false, error: 'NOT_ON_LEAVE', target };
  }

  await DayLeave.deleteOne({ _id: leave._id });

  logger.info('Day leave cleared', {
    dayName: target.dayName,
    date: getDateKey(target.date),
  });

  return { ok: true, target, leave };
};

module.exports = {
  parseDayName,
  parseLeaveArgument,
  findNextConsultationDateForDay,
  getLeaveForDate,
  isDateOnLeave,
  getActiveLeaves,
  setDayLeave,
  clearDayLeave,
};
