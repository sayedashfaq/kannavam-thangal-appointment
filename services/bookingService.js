const Booking = require('../models/Booking');
const { BOOKING_STATUS } = require('../constants');
const { generateTokenNumber, normalizeToken } = require('../helpers/tokenHelper');
const {
  getBookingDate,
  getDateKey,
  getTodayDayName,
  getZonedParts,
  calculateReportingTime,
  findUpcomingConsultations,
  formatDisplayDate,
  formatConsultationLabel,
  addLocalDays,
} = require('../helpers/timeHelper');
const { toLocalNumber, phoneLookupCandidates } = require('../helpers/phoneHelper');
const settingsService = require('./settingsService');
const scheduleService = require('./scheduleService');
const counterService = require('./counterService');
const leaveService = require('./leaveService');
const whatsappService = require('./whatsappService');
const messages = require('../constants/messages');
const logger = require('../utils/logger');

const BookingError = {
  BOOKING_CLOSED: 'BOOKING_CLOSED',
  CONSULTANT_ON_LEAVE: 'CONSULTANT_ON_LEAVE',
  DAY_ON_LEAVE: 'DAY_ON_LEAVE',
  NOT_CONSULTATION_DAY: 'NOT_CONSULTATION_DAY',
  BOOKING_WINDOW_CLOSED: 'BOOKING_WINDOW_CLOSED',
  TOKEN_LIMIT_REACHED: 'TOKEN_LIMIT_REACHED',
  DUPLICATE_BOOKING: 'DUPLICATE_BOOKING',
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  ALREADY_CANCELLED: 'ALREADY_CANCELLED',
  INVALID_MEMBERS: 'INVALID_MEMBERS',
};

const tokenCounterKey = (date) => `token:${getDateKey(date)}`;

const loadUpcoming = async (now = new Date()) => {
  const upcoming = await findUpcomingConsultations(
    now,
    async (candidate) => scheduleService.getTodaySchedule(candidate),
    async (candidate) => getActiveBookingCount(candidate)
  );

  for (const day of upcoming) {
    // eslint-disable-next-line no-await-in-loop
    const leave = await leaveService.getLeaveForDate(day.date);
    day.onLeave = Boolean(leave);
    day.leaveReason = leave?.reason || '';
    if (day.onLeave) {
      day.dayOpen = false;
    }
  }

  return upcoming;
};

/**
 * If Tuesday is on leave, Wednesday (or the next open day) becomes bookable
 * during the same window Tuesday would have used — visitors are not stuck.
 * That window is: day-before all day, plus consultation morning until 9:00 AM.
 */
const isEarlyOpenAfterLeave = (day, upcoming, now = new Date()) => {
  const today = getBookingDate(now).getTime();
  const dayKey = getBookingDate(day.date).getTime();
  const { hour, minute } = getZonedParts(now);
  const nowMinutes = hour * 60 + minute;

  return upcoming.some((prior) => {
    if (prior.date.getTime() >= day.date.getTime()) return false;
    if (!prior.onLeave) return false;

    const windowStart = getBookingDate(addLocalDays(prior.date, -1)).getTime();
    if (today < windowStart) return false;
    if (today < dayKey) return true;
    if (today === dayKey) return nowMinutes < 9 * 60;
    return false;
  });
};

/**
 * Picks the best consultation day that can accept a booking right now.
 * Skips leave / closed / full days, and early-opens the next day when a
 * prior consultation day is on leave.
 */
const pickBookableDay = (upcoming, now = new Date()) => {
  for (const day of upcoming) {
    if (day.onLeave || !day.dayOpen || day.isFull) continue;
    if (day.windowOpen || isEarlyOpenAfterLeave(day, upcoming, now)) {
      return day;
    }
  }
  return null;
};

const pickNextOpening = (upcoming) =>
  upcoming.find((day) => !day.windowOpen && day.dayOpen && !day.onLeave) || null;

const toActiveMeta = (day, now = new Date(), upcoming = []) => {
  if (!day) {
    return {
      available: false,
      windowOpen: false,
      bookable: false,
      date: null,
      dayName: null,
      schedule: null,
      displayDate: null,
      label: null,
      opensOn: null,
      remaining: 0,
      bookedCount: 0,
    };
  }

  const earlyOpen = isEarlyOpenAfterLeave(day, upcoming, now);
  const accepting = (day.windowOpen || earlyOpen) && day.dayOpen && !day.isFull && !day.onLeave;

  return {
    available: true,
    windowOpen: Boolean(day.windowOpen || earlyOpen),
    bookable: accepting,
    date: day.date,
    dayName: day.dayName,
    schedule: day.schedule,
    displayDate: day.displayDate,
    label: day.label || formatConsultationLabel(day.date, now),
    opensOn: day.opensOn,
    remaining: day.remaining,
    bookedCount: day.bookedCount,
    earlyOpenAfterLeave: earlyOpen && !day.windowOpen,
  };
};

/**
 * Resolves which consultation day tokens are being issued for.
 * Prefers an open, non-full window; otherwise reports the next day and when
 * its tokens open.
 */
const resolveActiveConsultation = async (now = new Date()) => {
  const upcoming = await loadUpcoming(now);
  const bookable = pickBookableDay(upcoming, now);

  if (bookable) {
    return {
      ...toActiveMeta(bookable, now, upcoming),
      upcoming,
      nextOpening: pickNextOpening(upcoming.filter((d) => d !== bookable)),
    };
  }

  // Prefer a day whose window is already open but full/closed for messaging,
  // else the soonest consultation day.
  const openButBlocked = upcoming.find((day) => day.windowOpen) || null;
  const nearest = openButBlocked || upcoming[0] || null;
  const nextOpening =
    pickNextOpening(upcoming) ||
    upcoming.find((day) => !day.onLeave && day.dayOpen) ||
    null;

  return {
    ...toActiveMeta(nearest, now, upcoming),
    bookable: false,
    upcoming,
    nextOpening,
    blockedReason: !nearest
      ? 'NONE'
      : openButBlocked?.onLeave && !nextOpening
        ? 'DAY_ON_LEAVE'
        : openButBlocked?.onLeave && nextOpening
          ? 'WINDOW_CLOSED'
          : openButBlocked?.isFull
            ? 'FULL'
            : openButBlocked && !openButBlocked.dayOpen
              ? 'DAY_CLOSED'
              : 'WINDOW_CLOSED',
    leaveReason: openButBlocked?.leaveReason || nearest?.leaveReason || '',
  };
};

/**
 * Full availability snapshot for welcome / admin — always includes clear
 * dates and the next opening when booking is not possible yet.
 */
const getAvailabilitySnapshot = async (now = new Date()) => {
  const settings = await settingsService.getSettings();
  const active = await resolveActiveConsultation(now);
  const nextOpening = active.nextOpening || null;

  let state = 'BOOKABLE';
  // Global pause only — day leave is handled by skipping to the next day.
  if (!settings.bookingOpen) state = 'GLOBALLY_CLOSED';
  else if (!active.available) state = 'NO_SCHEDULE';
  else if (active.bookable) state = 'BOOKABLE';
  else if (active.blockedReason === 'DAY_ON_LEAVE') state = 'DAY_ON_LEAVE';
  else if (active.blockedReason === 'FULL') state = 'FULL';
  else if (active.blockedReason === 'DAY_CLOSED') state = 'DAY_CLOSED';
  else state = 'WINDOW_CLOSED';

  return {
    state,
    settings,
    active,
    nextOpening,
    upcoming: active.upcoming || [],
  };
};

const getBookingsForDate = async (date) =>
  Booking.find({
    bookingDate: getBookingDate(date),
    status: BOOKING_STATUS.BOOKED,
  }).sort({ tokenSequence: 1 });

const getTodayBookings = async (date = new Date()) => {
  const active = await resolveActiveConsultation(date);
  if (!active.windowOpen || !active.date) return [];
  return getBookingsForDate(active.date);
};

const getAllTodayBookings = async (date = new Date()) => {
  const active = await resolveActiveConsultation(date);
  if (!active.available || !active.date) return [];
  return Booking.find({ bookingDate: getBookingDate(active.date) }).sort({
    tokenSequence: 1,
  });
};

const getActiveBookingCount = async (date) =>
  Booking.countDocuments({
    bookingDate: getBookingDate(date),
    status: BOOKING_STATUS.BOOKED,
  });

const findDuplicateBooking = async (phone, whatsappNumber = '', date) => {
  const candidates = phoneLookupCandidates(phone, whatsappNumber);
  if (candidates.length === 0) return null;

  return Booking.findOne({
    bookingDate: getBookingDate(date),
    status: BOOKING_STATUS.BOOKED,
    $or: [{ phone: { $in: candidates } }, { whatsappNumber: { $in: candidates } }],
  });
};

/**
 * Any still-active booking on today or a future consultation day.
 * Used so a visitor who booked Wednesday (while Tuesday was on leave)
 * cannot book Tuesday again after leave is cleared.
 */
const findActiveUpcomingBooking = async (
  phone,
  whatsappNumber = '',
  now = new Date()
) => {
  const candidates = phoneLookupCandidates(phone, whatsappNumber);
  if (candidates.length === 0) return null;

  const booking = await Booking.findOne({
    status: BOOKING_STATUS.BOOKED,
    bookingDate: { $gte: getBookingDate(now) },
    $or: [{ phone: { $in: candidates } }, { whatsappNumber: { $in: candidates } }],
  }).sort({ bookingDate: 1, createdAt: 1 });

  if (!booking) return null;

  booking.displayDate = formatDisplayDate(booking.bookingDate);
  booking.label = formatConsultationLabel(booking.bookingDate, now);
  return booking;
};

const findBookingByPhone = async (phone, date = new Date()) => {
  const localPhone = toLocalNumber(phone);
  if (!localPhone) return null;

  const query = {
    $or: [{ phone: localPhone }, { whatsappNumber: localPhone }],
  };

  const active = await resolveActiveConsultation(date);
  if (active.windowOpen && active.date) {
    const current = await Booking.findOne({
      ...query,
      bookingDate: getBookingDate(active.date),
      status: BOOKING_STATUS.BOOKED,
    });
    if (current) {
      current.displayDate = formatDisplayDate(active.date);
      return current;
    }
  }

  const booked = await Booking.findOne({
    ...query,
    status: BOOKING_STATUS.BOOKED,
  }).sort({ bookingDate: -1, createdAt: -1 });
  if (booked) return booked;

  return Booking.findOne(query).sort({ bookingDate: -1, createdAt: -1 });
};

const findBookingByToken = async (token, date = new Date()) => {
  const normalized = normalizeToken(token);
  if (!normalized) return null;

  const active = await resolveActiveConsultation(date);
  if (active.available && active.date) {
    const current = await Booking.findOne({
      tokenNumber: normalized,
      bookingDate: getBookingDate(active.date),
    });
    if (current) return current;
  }

  return Booking.findOne({ tokenNumber: normalized }).sort({ bookingDate: -1 });
};

const createBooking = async ({
  visitorName,
  place,
  phone,
  whatsappNumber = '',
  memberCount = 1,
}) => {
  const now = new Date();
  const snapshot = await getAvailabilitySnapshot(now);
  const { settings, active, nextOpening } = snapshot;

  const maxMembers = Math.max(1, settings.maxMembersPerToken || 10);
  const members = Number.parseInt(memberCount, 10);
  if (!Number.isInteger(members) || members < 1 || members > maxMembers) {
    const error = new Error(BookingError.INVALID_MEMBERS);
    error.meta = { maxMembers };
    throw error;
  }

  if (!settings.bookingOpen) {
    const error = new Error(BookingError.BOOKING_CLOSED);
    error.meta = availabilityMeta(active, nextOpening);
    throw error;
  }
  if (!active.available || !active.schedule) {
    const error = new Error(BookingError.NOT_CONSULTATION_DAY);
    error.meta = availabilityMeta(active, nextOpening);
    throw error;
  }
  if (await leaveService.isDateOnLeave(active.date)) {
    const leave = await leaveService.getLeaveForDate(active.date);
    const error = new Error(BookingError.DAY_ON_LEAVE);
    error.meta = {
      ...availabilityMeta(active, nextOpening),
      reason: leave?.reason || '',
    };
    throw error;
  }
  if (!active.bookable) {
    if (active.blockedReason === 'DAY_ON_LEAVE') {
      const error = new Error(BookingError.DAY_ON_LEAVE);
      error.meta = {
        ...availabilityMeta(active, nextOpening),
        reason: active.leaveReason || '',
      };
      throw error;
    }
    if (active.blockedReason === 'FULL') {
      const error = new Error(BookingError.TOKEN_LIMIT_REACHED);
      error.meta = availabilityMeta(active, nextOpening);
      throw error;
    }
    if (active.blockedReason === 'DAY_CLOSED') {
      const error = new Error(BookingError.BOOKING_CLOSED);
      error.meta = availabilityMeta(active, nextOpening);
      throw error;
    }
    const error = new Error(BookingError.BOOKING_WINDOW_CLOSED);
    error.meta = availabilityMeta(active, nextOpening);
    throw error;
  }

  const localPhone = toLocalNumber(phone);
  const localWhatsapp = toLocalNumber(whatsappNumber);

  // One active appointment at a time across upcoming consultation days.
  const existingUpcoming = await findActiveUpcomingBooking(
    localPhone,
    localWhatsapp,
    now
  );
  if (existingUpcoming) {
    const error = new Error(BookingError.DUPLICATE_BOOKING);
    error.meta = { booking: existingUpcoming };
    throw error;
  }

  // Re-check capacity under race conditions.
  const activeCount = await getActiveBookingCount(active.date);
  if (activeCount >= active.schedule.tokenLimit) {
    const error = new Error(BookingError.TOKEN_LIMIT_REACHED);
    error.meta = availabilityMeta(active, nextOpening);
    throw error;
  }

  const sequence = await counterService.getNextSequence(tokenCounterKey(active.date));
  const tokenNumber = generateTokenNumber(sequence);
  const reportingTime = calculateReportingTime(active.schedule, sequence);

  const booking = await Booking.create({
    visitorName,
    place,
    phone: localPhone,
    whatsappNumber: localWhatsapp,
    tokenNumber,
    tokenSequence: sequence,
    bookingDate: getBookingDate(active.date),
    consultationDay: active.dayName,
    consultationLocation: active.schedule.location,
    reportingTime,
    memberCount: members,
    status: BOOKING_STATUS.BOOKED,
  });

  booking.displayDate = active.displayDate;
  booking.label = active.label;

  logger.info('Booking created', {
    tokenNumber: booking.tokenNumber,
    visitorName: booking.visitorName,
    phone: booking.phone,
    memberCount: booking.memberCount,
    consultationDay: booking.consultationDay,
    bookingDate: getDateKey(active.date),
  });

  return booking;
};

const availabilityMeta = (active, nextOpening) => ({
  consultationDay: active?.dayName || null,
  displayDate: active?.displayDate || null,
  label: active?.label || null,
  opensOn: active?.opensOn || nextOpening?.opensOn || null,
  location: active?.schedule?.location || nextOpening?.schedule?.location || null,
  remaining: active?.remaining ?? 0,
  nextOpening: nextOpening
    ? {
        consultationDay: nextOpening.dayName,
        displayDate: nextOpening.displayDate,
        label: nextOpening.label,
        opensOn: nextOpening.opensOn,
        location: nextOpening.schedule?.location || null,
      }
    : null,
});

const cancelBooking = async (token, date = new Date()) => {
  const booking = await findBookingByToken(token, date);

  if (!booking) {
    throw new Error(BookingError.BOOKING_NOT_FOUND);
  }
  if (booking.status === BOOKING_STATUS.CANCELLED) {
    throw new Error(BookingError.ALREADY_CANCELLED);
  }

  booking.status = BOOKING_STATUS.CANCELLED;
  await booking.save();

  logger.info('Booking cancelled', { tokenNumber: booking.tokenNumber });
  return booking;
};

const getTodayStatus = async (date = new Date()) => {
  const snapshot = await getAvailabilitySnapshot(date);
  const { active, nextOpening } = snapshot;
  const bookedCount =
    active.windowOpen && active.date ? await getActiveBookingCount(active.date) : 0;
  const activeLeaves = await leaveService.getActiveLeaves(date);

  return {
    bookingOpen: snapshot.state === 'BOOKABLE',
    consultantOnLeave: false,
    leaveReason: '',
    activeLeaves,
    isConsultationDay: active.dayName === getTodayDayName(date),
    dayName: getTodayDayName(date),
    todayLabel: formatConsultationLabel(date, date),
    consultationDay: active.available ? active.label : 'None scheduled',
    consultationDayName: active.dayName,
    location: active.schedule?.location || 'N/A',
    bookedCount,
    tokenLimit: active.schedule?.tokenLimit || 0,
    remainingTokens: active.schedule
      ? Math.max(0, active.schedule.tokenLimit - bookedCount)
      : 0,
    windowOpen: snapshot.state === 'BOOKABLE',
    tokenWindowOpen: Boolean(active.windowOpen),
    opensOn: active.opensOn || nextOpening?.opensOn || null,
    targetDate: active.date,
    schedule: active.schedule,
    state: snapshot.state,
    nextOpening,
    upcoming: snapshot.upcoming,
  };
};

const getBookingsForDayName = async (dayName, fromDate = new Date()) => {
  const target = await leaveService.findNextConsultationDateForDay(dayName, fromDate);
  if (!target) return { ok: false, error: 'NO_CONSULTATION_DAY' };

  const bookings = await getBookingsForDate(target.date);
  const leave = await leaveService.getLeaveForDate(target.date);

  return {
    ok: true,
    target,
    leave,
    bookings,
  };
};

/**
 * After admin changes a day's venue: update every upcoming BOOKED visit for
 * that weekday and WhatsApp each visitor with their token + new map pin.
 */
const updateVenueAndNotifyBookings = async (dayName, venue, now = new Date()) => {
  const day = String(dayName || '').trim();
  const locationName = venue?.name || '';
  if (!day || !locationName) {
    return { updatedCount: 0, notifiedCount: 0 };
  }

  const bookings = await Booking.find({
    status: BOOKING_STATUS.BOOKED,
    consultationDay: day,
    bookingDate: { $gte: getBookingDate(now) },
  }).sort({ bookingDate: 1, tokenSequence: 1 });

  let updatedCount = 0;
  let notifiedCount = 0;

  for (const booking of bookings) {
    booking.consultationLocation = locationName;
    // eslint-disable-next-line no-await-in-loop
    await booking.save();
    updatedCount += 1;

    const to = booking.whatsappNumber || booking.phone || '';
    if (!to) continue;

    booking.displayDate = formatDisplayDate(booking.bookingDate);
    booking.label = formatConsultationLabel(booking.bookingDate, now);

    try {
      // eslint-disable-next-line no-await-in-loop
      await whatsappService.sendTextMessage(
        to,
        messages.VENUE_CHANGE_NOTICE_TO_VISITOR({ booking, venue }),
        { previewUrl: true }
      );
      notifiedCount += 1;
    } catch (error) {
      logger.error('Failed to notify visitor about venue change', {
        tokenNumber: booking.tokenNumber,
        to,
        error: error.message,
      });
    }
  }

  return { updatedCount, notifiedCount };
};

module.exports = {
  BookingError,
  tokenCounterKey,
  resolveActiveConsultation,
  getAvailabilitySnapshot,
  getTodayBookings,
  getAllTodayBookings,
  getBookingsForDate,
  getActiveBookingCount,
  findDuplicateBooking,
  findActiveUpcomingBooking,
  findBookingByPhone,
  findBookingByToken,
  createBooking,
  cancelBooking,
  getTodayStatus,
  getBookingsForDayName,
  updateVenueAndNotifyBookings,
};
