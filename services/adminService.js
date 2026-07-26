const messages = require('../constants/messages');
const env = require('../config/env');
const { phonesMatch, toLocalNumber } = require('../helpers/phoneHelper');
const { capitalizeDay, isValidWeekday } = require('../helpers/validationHelper');
const { isValidTimeString, parseTimeToMinutes } = require('../helpers/timeHelper');
const { isValidTokenFormat, normalizeToken } = require('../helpers/tokenHelper');
const settingsService = require('./settingsService');
const scheduleService = require('./scheduleService');
const bookingService = require('./bookingService');
const logger = require('../utils/logger');

const { BookingError } = bookingService;

const isAdmin = (phone) => Boolean(env.adminPhone) && phonesMatch(phone, env.adminPhone);

const SIMPLE_COMMANDS = [
  'menu',
  'help',
  'open',
  'close',
  'leave',
  'resume',
  'status',
  'today',
  'list',
  'schedules',
];

const PREFIX_COMMANDS = ['find', 'cancel', 'limit', 'schedule', 'leave'];

// True when the admin clearly meant to issue a command, so a typo gets a
// helpful reply instead of silently starting a visitor booking flow.
const looksLikeCommand = (text) => {
  const command = text.trim().toLowerCase();
  const firstWord = command.split(/\s+/)[0];
  return SIMPLE_COMMANDS.includes(command) || PREFIX_COMMANDS.includes(firstWord);
};

const handleAdminCommand = async (phone, text) => {
  if (!isAdmin(phone)) return null;

  const raw = text.trim();
  const command = raw.toLowerCase();
  const [firstWord, ...rest] = raw.split(/\s+/);
  const keyword = firstWord.toLowerCase();
  const argument = rest.join(' ').trim();

  if (!looksLikeCommand(raw)) return null;

  logger.info('Admin command received', { phone, command: command.slice(0, 80) });

  switch (keyword) {
    case 'menu':
      return messages.ADMIN_MENU;

    case 'help':
      return messages.ADMIN_HELP;

    case 'open':
      await settingsService.updateSettings({ bookingOpen: true });
      return messages.BOOKING_OPENED;

    case 'close':
      await settingsService.updateSettings({ bookingOpen: false });
      return messages.BOOKING_CLOSED_ADMIN;

    case 'leave':
      await settingsService.updateSettings({
        consultantOnLeave: true,
        bookingOpen: false,
        leaveReason: argument,
      });
      return messages.LEAVE_SET;

    case 'resume':
      await settingsService.updateSettings({
        consultantOnLeave: false,
        bookingOpen: true,
        leaveReason: '',
      });
      return messages.RESUME_SET;

    case 'status':
      return formatStatus();

    case 'today':
    case 'list':
      return formatTodayBookings();

    case 'schedules':
      return formatSchedules();

    case 'find':
      return findBookingReply(argument);

    case 'cancel':
      return cancelBookingReply(argument);

    case 'limit':
      return updateLimitReply(argument);

    case 'schedule':
      return updateScheduleReply(raw);

    default:
      return messages.UNKNOWN_COMMAND;
  }
};

const formatStatus = async () => {
  const status = await bookingService.getTodayStatus();
  const leaveLine = status.consultantOnLeave
    ? `On Leave 🚫${status.leaveReason ? ` (${status.leaveReason})` : ''}`
    : 'Available ✅';

  return `*Today's Status*

*Booking:* ${status.bookingOpen ? 'Open ✅' : 'Closed ❌'}
*Leave Status:* ${leaveLine}
*Consultation Day:* ${status.consultationDay}
*Location:* ${status.location}
*Booked Count:* ${status.bookedCount}
*Remaining Tokens:* ${status.remainingTokens} of ${status.tokenLimit}`;
};

const formatTodayBookings = async () => {
  const bookings = await bookingService.getTodayBookings();

  if (bookings.length === 0) return messages.NO_BOOKINGS_TODAY;

  const lines = bookings.map(
    (booking) =>
      `${booking.tokenNumber} · ${booking.reportingTime}\n${booking.visitorName} — ${booking.place}\n${booking.phone}`
  );

  const header = `*Today's Bookings (${bookings.length})*\n${bookings[0].consultationLocation}`;
  return `${header}\n\n${lines.join('\n\n')}`;
};

const formatSchedules = async () => {
  const schedules = await scheduleService.getAllSchedules();

  if (schedules.length === 0) return 'No schedules configured.';

  const lines = schedules.map(
    (schedule) =>
      `*${schedule.day}* — ${schedule.location}\n${schedule.morningStart}–${schedule.morningEnd} · ${schedule.afternoonStart}–${schedule.afternoonEnd} · limit ${schedule.tokenLimit}${schedule.bookingOpen ? '' : ' · closed'}`
  );

  return `*Consultation Days*\n\n${lines.join('\n\n')}`;
};

const findBookingReply = async (argument) => {
  const localPhone = toLocalNumber(argument);

  if (localPhone.length < 10) return messages.INVALID_PHONE_SEARCH;

  const booking = await bookingService.findBookingByPhone(localPhone);
  if (!booking) return messages.BOOKING_NOT_FOUND;

  return `*Booking Details*

*Token:* ${booking.tokenNumber}
*Name:* ${booking.visitorName}
*Place:* ${booking.place}
*Phone:* ${booking.phone}
*Consultation Day:* ${booking.consultationDay}
*Location:* ${booking.consultationLocation}
*Reporting Time:* ${booking.reportingTime}
*Status:* ${booking.status}`;
};

const cancelBookingReply = async (argument) => {
  const token = normalizeToken(argument);

  if (!token || !isValidTokenFormat(token)) return messages.INVALID_TOKEN;

  try {
    const booking = await bookingService.cancelBooking(token);
    return messages.BOOKING_CANCELLED(booking);
  } catch (error) {
    if (error.message === BookingError.BOOKING_NOT_FOUND) {
      return messages.BOOKING_NOT_FOUND;
    }
    if (error.message === BookingError.ALREADY_CANCELLED) {
      return messages.BOOKING_ALREADY_CANCELLED(token);
    }
    throw error;
  }
};

const updateLimitReply = async (argument) => {
  const limit = Number.parseInt(argument, 10);

  if (!Number.isInteger(limit) || limit < 1) return messages.INVALID_LIMIT;

  const schedule = await scheduleService.updateTodayTokenLimit(limit);
  if (!schedule) return messages.NO_SCHEDULE_TODAY;

  return messages.LIMIT_UPDATED(schedule);
};

const updateScheduleReply = async (raw) => {
  const pattern =
    /^schedule\s+([A-Za-z]+)\s+"([^"]+)"\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+(\d{1,3})$/i;
  const match = raw.match(pattern);

  if (!match) return messages.SCHEDULE_FORMAT_HELP;

  const [
    ,
    day,
    location,
    morningStart,
    morningEnd,
    afternoonStart,
    afternoonEnd,
    tokenLimit,
  ] = match;

  if (!isValidWeekday(day)) return messages.INVALID_DAY;

  const times = [morningStart, morningEnd, afternoonStart, afternoonEnd];
  if (!times.every(isValidTimeString)) return messages.INVALID_TIME;

  const [ms, me, as, ae] = times.map(parseTimeToMinutes);
  if (ms >= me || as >= ae) return messages.INVALID_TIME;

  const limit = Number.parseInt(tokenLimit, 10);
  if (limit < 1) return messages.INVALID_LIMIT;

  const schedule = await scheduleService.updateSchedule(capitalizeDay(day), {
    location: location.trim(),
    morningStart,
    morningEnd,
    afternoonStart,
    afternoonEnd,
    tokenLimit: limit,
    active: true,
  });

  return messages.SCHEDULE_UPDATED(schedule);
};

module.exports = {
  isAdmin,
  looksLikeCommand,
  handleAdminCommand,
};
