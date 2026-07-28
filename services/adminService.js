const messages = require('../constants/messages');
const env = require('../config/env');
const { phonesMatch, toLocalNumber } = require('../helpers/phoneHelper');
const { capitalizeDay, isValidWeekday } = require('../helpers/validationHelper');
const {
  isValidTimeString,
  parseTimeToMinutes,
  formatDisplayDate,
  parseTimeRanges,
} = require('../helpers/timeHelper');
const { isValidTokenFormat, normalizeToken } = require('../helpers/tokenHelper');
const settingsService = require('./settingsService');
const scheduleService = require('./scheduleService');
const bookingService = require('./bookingService');
const leaveService = require('./leaveService');
const { resolveVenue, listVenuesHelp } = require('../constants/venues');
const logger = require('../utils/logger');

const { BookingError } = bookingService;

const isAdmin = (phone) => Boolean(env.adminPhone) && phonesMatch(phone, env.adminPhone);

const SIMPLE_COMMANDS = [
  'menu',
  'help',
  'close',
  'status',
  'today',
  'schedules',
  'upcoming',
];

const PREFIX_COMMANDS = [
  'find',
  'cancel',
  'limit',
  'schedule',
  'leave',
  'resume',
  'list',
  'open',
  'members',
  'change',
  'location',
];

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
      // `open` = resume everything; `open tuesday` = clear that day's leave.
      if (argument) return clearLeaveReply(argument);
      await settingsService.updateSettings({
        bookingOpen: true,
        consultantOnLeave: false,
        leaveReason: '',
      });
      return messages.BOOKING_OPENED;

    case 'close':
      await settingsService.updateSettings({ bookingOpen: false });
      return messages.BOOKING_CLOSED_ADMIN;

    case 'leave':
      return setLeaveReply(argument);

    case 'resume':
      // Same as `open tuesday` — kept for people who already learned resume.
      return clearLeaveReply(argument);

    case 'status':
      return formatStatus();

    case 'today':
      return formatTodayBookings();

    case 'list':
      return argument ? formatDayBookings(argument) : formatTodayBookings();

    case 'schedules':
      return formatSchedules();

    case 'upcoming':
      return formatUpcoming();

    case 'find':
      return findBookingReply(argument);

    case 'cancel':
      return cancelBookingReply(argument);

    case 'limit':
      return updateLimitReply(argument);

    case 'members':
      return updateMembersReply(argument);

    case 'change':
    case 'location':
      // `change time ...` updates hours; `change adhur` updates venue.
      if (/^time\b/i.test(argument)) {
        return changeTimeReply(argument.replace(/^time\b/i, '').trim());
      }
      return changeLocationReply(argument);

    case 'schedule':
      return updateScheduleReply(raw);

    default:
      return messages.UNKNOWN_COMMAND;
  }
};

const setLeaveReply = async (argument) => {
  const parsed = leaveService.parseLeaveArgument(argument);
  if (!parsed.ok) return messages.LEAVE_USAGE;

  const result = await leaveService.setDayLeave(parsed.dayName, parsed.reason);
  if (!result.ok) {
    if (result.error === 'ALREADY_ON_LEAVE') {
      return messages.LEAVE_ALREADY_SET(result.target.label);
    }
    return messages.LEAVE_NO_DAY;
  }

  return messages.LEAVE_SET_DAY({
    label: result.target.label,
    reason: parsed.reason,
    notifiedCount: result.notifiedCount,
    cancelledCount: result.cancelledCount,
  });
};

const clearLeaveReply = async (argument) => {
  if (!argument) return messages.RESUME_USAGE;

  const parsed = leaveService.parseLeaveArgument(argument);
  if (!parsed.ok) return messages.RESUME_USAGE;

  const result = await leaveService.clearDayLeave(parsed.dayName);
  if (!result.ok) {
    if (result.error === 'NOT_ON_LEAVE') {
      return messages.LEAVE_NOT_SET(result.target.label);
    }
    return messages.LEAVE_NO_DAY;
  }

  return messages.LEAVE_CLEARED(result.target.label);
};

const formatStatus = async () => {
  const status = await bookingService.getTodayStatus();
  const settings = await settingsService.getSettings();

  const leaveLines =
    status.activeLeaves?.length > 0
      ? status.activeLeaves
          .map(
            (leave) =>
              `• ${leave.dayName}, ${formatDisplayDate(leave.leaveDate)}${
                leave.reason ? ` (${leave.reason})` : ''
              }`
          )
          .join('\n')
      : 'None';

  const windowLine = status.bookingOpen
    ? 'Open — visitors can book now ✅'
    : !settings.bookingOpen
      ? 'All booking paused (`open` to resume)'
      : status.nextOpening?.opensOn
        ? `Opens ${status.nextOpening.opensOn} for ${status.nextOpening.label}`
        : status.opensOn
          ? `Opens ${status.opensOn}`
          : 'Closed';

  return `*Booking Status*

*Today:* ${status.todayLabel || status.dayName}
*All booking:* ${settings.bookingOpen ? 'Open ✅' : 'Paused ❌'}
*Visitors can book now:* ${status.bookingOpen ? 'Yes ✅' : 'No ❌'}
*Token Window:* ${windowLine}
*Active Consultation:* ${status.consultationDay}
*Location:* ${status.location}
*Booked Count:* ${status.bookedCount}
*Remaining Tokens:* ${status.remainingTokens} of ${status.tokenLimit}

*Day leaves:*
${leaveLines}

Tip: \`leave tuesday\` · \`list saturday\` · \`upcoming\``;
};

const formatBookingList = (label, location, bookings) => {
  if (bookings.length === 0) {
    return `No bookings yet for *${label}*.`;
  }

  const lines = bookings.map(
    (booking) =>
      `${booking.tokenNumber} · ${booking.reportingTime} · ${booking.memberCount || 1} members\n${booking.visitorName} — ${booking.place}\n${booking.phone}`
  );

  return `*Bookings for ${label} (${bookings.length})*\n${location || ''}\n\n${lines.join('\n\n')}`;
};

const formatTodayBookings = async () => {
  const status = await bookingService.getTodayStatus();
  const bookings = await bookingService.getTodayBookings();

  if (!status.tokenWindowOpen && !status.bookingOpen) {
    return status.nextOpening?.label
      ? `No active booking window right now.\n\nNext tokens open on *${status.nextOpening.opensOn}* for *${status.nextOpening.label}*.`
      : status.opensOn
        ? `No active booking window right now.\n\nNext tokens open on *${status.opensOn}* for *${status.consultationDay}*.`
        : messages.NO_BOOKINGS_TODAY;
  }

  return formatBookingList(
    status.consultationDay,
    bookings[0]?.consultationLocation || status.location,
    bookings
  );
};

const formatDayBookings = async (argument) => {
  const dayName = leaveService.parseDayName(argument.split(/\s+/)[0]);
  if (!dayName) return messages.INVALID_DAY;

  const result = await bookingService.getBookingsForDayName(dayName);
  if (!result.ok) return messages.LEAVE_NO_DAY;

  const leaveNote = result.leave
    ? `\n🚫 On leave${result.leave.reason ? `: ${result.leave.reason}` : ''}`
    : '';

  return `${formatBookingList(
    result.target.label,
    result.target.schedule.location,
    result.bookings
  )}${leaveNote}`;
};

const formatSchedules = async () => {
  const schedules = await scheduleService.getAllSchedules();

  if (schedules.length === 0) return 'No schedules configured.';

  const lines = schedules.map(
    (schedule) =>
      `*${schedule.day}* — ${schedule.location}\n${schedule.morningStart}–${schedule.morningEnd} · ${schedule.afternoonStart}–${schedule.afternoonEnd} · limit ${schedule.tokenLimit}${schedule.bookingOpen ? '' : ' · closed'}`
  );

  return `*Consultation Days*\n\n${lines.join('\n\n')}\n\nSend \`upcoming\` for exact dates this week.`;
};

const formatUpcoming = async () => {
  const status = await bookingService.getTodayStatus();
  const upcoming = status.upcoming || [];

  if (upcoming.length === 0) {
    return 'No consultation days found in the next two weeks.';
  }

  const lines = upcoming.slice(0, 6).map((day) => {
    let windowText = 'Window closed';
    if (day.onLeave) {
      windowText = `On leave${day.leaveReason ? `: ${day.leaveReason}` : ''}`;
    } else if (day.windowOpen && day.dayOpen && !day.isFull) {
      windowText = `Open now · ${day.remaining} left`;
    } else if (day.windowOpen && day.isFull) {
      windowText = 'Full';
    } else if (day.windowOpen && !day.dayOpen) {
      windowText = 'Day closed';
    } else {
      windowText = `Opens ${day.opensOn}`;
    }

    return `*${day.label}*\n📍 ${day.schedule.location}\n🎫 ${day.bookedCount}/${day.schedule.tokenLimit} · ${windowText}`;
  });

  return `*Upcoming Consultations*\n\n${lines.join('\n\n')}`;
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

  const status = await bookingService.getTodayStatus();
  if (!status.schedule) return messages.NO_SCHEDULE_TODAY;

  const schedule = await scheduleService.updateTokenLimitForDay(
    status.schedule.day,
    limit
  );
  if (!schedule) return messages.NO_SCHEDULE_TODAY;

  return messages.LIMIT_UPDATED(schedule, status.consultationDay);
};

const updateMembersReply = async (argument) => {
  if (!argument) {
    const settings = await settingsService.getSettings();
    return messages.MEMBERS_STATUS(settings.maxMembersPerToken || 10);
  }

  const max = Number.parseInt(argument, 10);
  if (!Number.isInteger(max) || max < 1 || max > 50) {
    return messages.INVALID_MEMBERS_LIMIT;
  }

  await settingsService.updateSettings({ maxMembersPerToken: max });
  return messages.MEMBERS_UPDATED(max);
};

/**
 * Parses:
 *   change adhur
 *   change bandichal
 *   change adhur tuesday
 *   change bandichal saturday
 *   location bendichal wednesday
 */
const changeLocationReply = async (argument) => {
  const tokens = String(argument || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return messages.LOCATION_USAGE(listVenuesHelp());
  }

  const venue = resolveVenue(tokens[0]);
  if (!venue) {
    return messages.LOCATION_USAGE(listVenuesHelp());
  }

  // Optional weekday — otherwise update the active consultation day.
  if (tokens[1]) {
    if (!isValidWeekday(tokens[1])) return messages.INVALID_DAY;
    const day = capitalizeDay(tokens[1]);
    const schedule = await scheduleService.updateLocationForDay(day, venue.name);
    const notify = await bookingService.updateVenueAndNotifyBookings(day, venue);
    return messages.LOCATION_UPDATED({ day: schedule.day, venue, ...notify });
  }

  const status = await bookingService.getTodayStatus();
  if (!status.schedule?.day) return messages.NO_SCHEDULE_TODAY;

  const schedule = await scheduleService.updateLocationForDay(
    status.schedule.day,
    venue.name
  );
  const notify = await bookingService.updateVenueAndNotifyBookings(
    schedule.day,
    venue
  );
  return messages.LOCATION_UPDATED({ day: schedule.day, venue, ...notify });
};

/**
 * Parses:
 *   change time wednesday 10am to 12pm
 *   change time wednesday 10 am to 12pm 1pm to 4pm
 *   change time 10am to 1pm 2pm to 4pm
 *
 * One range updates morning only (afternoon kept).
 * Two ranges update morning + afternoon.
 * Default consultation hours are 10:00–13:00 and 14:00–16:00.
 */
const changeTimeReply = async (argument) => {
  const text = String(argument || '').trim();
  if (!text) return messages.TIME_USAGE;

  const tokens = text.split(/\s+/).filter(Boolean);
  let dayName = null;
  let rangesText = text;

  if (tokens[0] && isValidWeekday(tokens[0])) {
    dayName = capitalizeDay(tokens[0]);
    rangesText = tokens.slice(1).join(' ');
  }

  const ranges = parseTimeRanges(rangesText);
  if (!ranges || ranges.length === 0 || ranges.length > 2) {
    return messages.TIME_USAGE;
  }

  for (const range of ranges) {
    if (parseTimeToMinutes(range.start) >= parseTimeToMinutes(range.end)) {
      return messages.INVALID_TIME;
    }
  }

  if (!dayName) {
    const status = await bookingService.getTodayStatus();
    if (!status.schedule?.day) return messages.NO_SCHEDULE_TODAY;
    dayName = status.schedule.day;
  }

  const existing = await scheduleService.getScheduleByDay(dayName);
  if (!existing) return messages.LEAVE_NO_DAY;

  const updates = {
    morningStart: ranges[0].start,
    morningEnd: ranges[0].end,
  };

  if (ranges[1]) {
    updates.afternoonStart = ranges[1].start;
    updates.afternoonEnd = ranges[1].end;
  }

  if (
    parseTimeToMinutes(updates.morningEnd) >
    parseTimeToMinutes(updates.afternoonStart || existing.afternoonStart)
  ) {
    return messages.INVALID_TIME;
  }

  const schedule = await scheduleService.updateSchedule(dayName, updates);
  return messages.TIME_UPDATED(schedule);
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
