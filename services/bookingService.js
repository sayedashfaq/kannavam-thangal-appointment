const Booking = require('../models/Booking');
const { BOOKING_STATUS } = require('../constants');
const { generateTokenNumber, normalizeToken } = require('../helpers/tokenHelper');
const {
  getBookingDate,
  getDateKey,
  getTodayDayName,
  calculateReportingTime,
  findNextConsultationDate,
  isWithinAdvanceBookingWindow,
  formatDisplayDate,
  addLocalDays,
} = require('../helpers/timeHelper');
const { toLocalNumber } = require('../helpers/phoneHelper');
const env = require('../config/env');
const settingsService = require('./settingsService');
const scheduleService = require('./scheduleService');
const counterService = require('./counterService');
const logger = require('../utils/logger');

const BookingError = {
  BOOKING_CLOSED: 'BOOKING_CLOSED',
  CONSULTANT_ON_LEAVE: 'CONSULTANT_ON_LEAVE',
  NOT_CONSULTATION_DAY: 'NOT_CONSULTATION_DAY',
  BOOKING_WINDOW_CLOSED: 'BOOKING_WINDOW_CLOSED',
  TOKEN_LIMIT_REACHED: 'TOKEN_LIMIT_REACHED',
  DUPLICATE_BOOKING: 'DUPLICATE_BOOKING',
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  ALREADY_CANCELLED: 'ALREADY_CANCELLED',
};

const tokenCounterKey = (date) => `token:${getDateKey(date)}`;

/**
 * Resolves which consultation day tokens are being issued for.
 * Booking opens from the day before that consultation day.
 */
const resolveActiveConsultation = async (now = new Date()) => {
  const next = await findNextConsultationDate(now, async (candidate) =>
    scheduleService.getTodaySchedule(candidate)
  );

  if (!next) {
    return {
      available: false,
      windowOpen: false,
      date: null,
      dayName: null,
      schedule: null,
      displayDate: null,
      opensOn: null,
    };
  }

  const windowOpen = isWithinAdvanceBookingWindow(now, next.date);
  const opensOn = formatDisplayDate(addLocalDays(next.date, -1));

  return {
    available: true,
    windowOpen,
    date: next.date,
    dayName: next.dayName,
    schedule: next.schedule,
    displayDate: formatDisplayDate(next.date),
    opensOn,
  };
};

const getBookingsForDate = async (date) =>
  Booking.find({
    bookingDate: getBookingDate(date),
    status: BOOKING_STATUS.BOOKED,
  }).sort({ tokenSequence: 1 });

const getTodayBookings = async (date = new Date()) => {
  const active = await resolveActiveConsultation(date);
  if (!active.windowOpen) return [];
  return getBookingsForDate(active.date);
};

const getAllTodayBookings = async (date = new Date()) => {
  const active = await resolveActiveConsultation(date);
  if (!active.available) return [];
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
  const localPhone = toLocalNumber(phone);
  const localWhatsapp = toLocalNumber(whatsappNumber);
  const candidates = [localPhone, localWhatsapp].filter(Boolean);

  return Booking.findOne({
    bookingDate: getBookingDate(date),
    status: BOOKING_STATUS.BOOKED,
    $or: [{ phone: { $in: candidates } }, { whatsappNumber: { $in: candidates } }],
  });
};

const findBookingByPhone = async (phone, date = new Date()) => {
  const localPhone = toLocalNumber(phone);
  if (!localPhone) return null;

  const query = {
    $or: [{ phone: localPhone }, { whatsappNumber: localPhone }],
  };

  const active = await resolveActiveConsultation(date);
  if (active.windowOpen) {
    const current = await Booking.findOne({
      ...query,
      bookingDate: getBookingDate(active.date),
    });
    if (current) return current;
  }

  return Booking.findOne(query).sort({ bookingDate: -1, createdAt: -1 });
};

const findBookingByToken = async (token, date = new Date()) => {
  const normalized = normalizeToken(token);
  if (!normalized) return null;

  const active = await resolveActiveConsultation(date);
  if (active.available) {
    const current = await Booking.findOne({
      tokenNumber: normalized,
      bookingDate: getBookingDate(active.date),
    });
    if (current) return current;
  }

  return Booking.findOne({ tokenNumber: normalized }).sort({ bookingDate: -1 });
};

const createBooking = async ({ visitorName, place, phone, whatsappNumber = '' }) => {
  const now = new Date();
  const active = await resolveActiveConsultation(now);

  if (!active.available || !active.schedule) {
    throw new Error(BookingError.NOT_CONSULTATION_DAY);
  }
  if (!active.windowOpen) {
    const error = new Error(BookingError.BOOKING_WINDOW_CLOSED);
    error.meta = {
      consultationDay: active.dayName,
      displayDate: active.displayDate,
      opensOn: active.opensOn,
    };
    throw error;
  }

  const settings = await settingsService.getSettings();
  if (settings.consultantOnLeave) {
    throw new Error(BookingError.CONSULTANT_ON_LEAVE);
  }
  if (!settings.bookingOpen || !active.schedule.bookingOpen) {
    throw new Error(BookingError.BOOKING_CLOSED);
  }

  const localPhone = toLocalNumber(phone);
  const localWhatsapp = toLocalNumber(whatsappNumber);

  const duplicate = await findDuplicateBooking(localPhone, localWhatsapp, active.date);
  if (duplicate) {
    throw new Error(BookingError.DUPLICATE_BOOKING);
  }

  const activeCount = await getActiveBookingCount(active.date);
  if (activeCount >= active.schedule.tokenLimit) {
    throw new Error(BookingError.TOKEN_LIMIT_REACHED);
  }

  const sequence = await counterService.getNextSequence(tokenCounterKey(active.date));
  const tokenNumber = generateTokenNumber(sequence);
  const reportingTime = calculateReportingTime(
    active.schedule,
    sequence,
    env.dynamicReportingTime
  );

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
    status: BOOKING_STATUS.BOOKED,
  });

  booking.displayDate = active.displayDate;

  logger.info('Booking created', {
    tokenNumber: booking.tokenNumber,
    visitorName: booking.visitorName,
    phone: booking.phone,
    consultationDay: booking.consultationDay,
    bookingDate: getDateKey(active.date),
  });

  return booking;
};

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
  const settings = await settingsService.getSettings();
  const active = await resolveActiveConsultation(date);
  const bookedCount = active.windowOpen ? await getActiveBookingCount(active.date) : 0;

  return {
    bookingOpen:
      settings.bookingOpen &&
      active.windowOpen &&
      Boolean(active.schedule?.bookingOpen),
    consultantOnLeave: settings.consultantOnLeave,
    leaveReason: settings.leaveReason,
    isConsultationDay: getTodayDayName(date) === active.dayName,
    dayName: getTodayDayName(date),
    consultationDay: active.available
      ? `${active.dayName} (${active.displayDate})`
      : 'None scheduled',
    location: active.schedule?.location || 'N/A',
    bookedCount,
    tokenLimit: active.schedule?.tokenLimit || 0,
    remainingTokens: active.schedule
      ? Math.max(0, active.schedule.tokenLimit - bookedCount)
      : 0,
    windowOpen: active.windowOpen,
    opensOn: active.opensOn,
    targetDate: active.date,
    schedule: active.schedule,
  };
};

module.exports = {
  BookingError,
  tokenCounterKey,
  resolveActiveConsultation,
  getTodayBookings,
  getAllTodayBookings,
  getBookingsForDate,
  getActiveBookingCount,
  findDuplicateBooking,
  findBookingByPhone,
  findBookingByToken,
  createBooking,
  cancelBooking,
  getTodayStatus,
};
