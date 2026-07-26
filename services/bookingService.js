const Booking = require('../models/Booking');
const { BOOKING_STATUS } = require('../constants');
const { generateTokenNumber, normalizeToken } = require('../helpers/tokenHelper');
const {
  getBookingDate,
  getDateKey,
  getTodayDayName,
  calculateReportingTime,
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
  TOKEN_LIMIT_REACHED: 'TOKEN_LIMIT_REACHED',
  DUPLICATE_BOOKING: 'DUPLICATE_BOOKING',
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  ALREADY_CANCELLED: 'ALREADY_CANCELLED',
};

const tokenCounterKey = (date) => `token:${getDateKey(date)}`;

const getTodayBookings = async (date = new Date()) =>
  Booking.find({
    bookingDate: getBookingDate(date),
    status: BOOKING_STATUS.BOOKED,
  }).sort({ tokenSequence: 1 });

const getAllTodayBookings = async (date = new Date()) =>
  Booking.find({ bookingDate: getBookingDate(date) }).sort({ tokenSequence: 1 });

// Only active bookings count towards the limit, so a cancellation frees a slot.
const getActiveBookingCount = async (date = new Date()) =>
  Booking.countDocuments({
    bookingDate: getBookingDate(date),
    status: BOOKING_STATUS.BOOKED,
  });

const findDuplicateBooking = async (phone, whatsappNumber = '', date = new Date()) => {
  const localPhone = toLocalNumber(phone);
  const localWhatsapp = toLocalNumber(whatsappNumber);
  const candidates = [localPhone, localWhatsapp].filter(Boolean);

  return Booking.findOne({
    bookingDate: getBookingDate(date),
    status: BOOKING_STATUS.BOOKED,
    $or: [{ phone: { $in: candidates } }, { whatsappNumber: { $in: candidates } }],
  });
};

// Looks at today first, then falls back to the most recent booking so the
// admin can still look up a visitor on a non-consultation day.
const findBookingByPhone = async (phone, date = new Date()) => {
  const localPhone = toLocalNumber(phone);
  if (!localPhone) return null;

  const query = {
    $or: [{ phone: localPhone }, { whatsappNumber: localPhone }],
  };

  const todayBooking = await Booking.findOne({
    ...query,
    bookingDate: getBookingDate(date),
  });

  return todayBooking || Booking.findOne(query).sort({ bookingDate: -1, createdAt: -1 });
};

const findBookingByToken = async (token, date = new Date()) => {
  const normalized = normalizeToken(token);
  if (!normalized) return null;

  return Booking.findOne({
    tokenNumber: normalized,
    bookingDate: getBookingDate(date),
  });
};

const createBooking = async ({ visitorName, place, phone, whatsappNumber = '' }) => {
  const now = new Date();

  const schedule = await scheduleService.getTodaySchedule(now);
  if (!schedule) {
    throw new Error(BookingError.NOT_CONSULTATION_DAY);
  }

  const settings = await settingsService.getSettings();
  if (settings.consultantOnLeave) {
    throw new Error(BookingError.CONSULTANT_ON_LEAVE);
  }
  if (!settings.bookingOpen || !schedule.bookingOpen) {
    throw new Error(BookingError.BOOKING_CLOSED);
  }

  const localPhone = toLocalNumber(phone);
  const localWhatsapp = toLocalNumber(whatsappNumber);

  const duplicate = await findDuplicateBooking(localPhone, localWhatsapp, now);
  if (duplicate) {
    throw new Error(BookingError.DUPLICATE_BOOKING);
  }

  const activeCount = await getActiveBookingCount(now);
  if (activeCount >= schedule.tokenLimit) {
    throw new Error(BookingError.TOKEN_LIMIT_REACHED);
  }

  const sequence = await counterService.getNextSequence(tokenCounterKey(now));
  const tokenNumber = generateTokenNumber(sequence);
  const reportingTime = calculateReportingTime(
    schedule,
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
    bookingDate: getBookingDate(now),
    consultationDay: getTodayDayName(now),
    consultationLocation: schedule.location,
    reportingTime,
    status: BOOKING_STATUS.BOOKED,
  });

  logger.info('Booking created', {
    tokenNumber: booking.tokenNumber,
    visitorName: booking.visitorName,
    phone: booking.phone,
    consultationDay: booking.consultationDay,
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
  const schedule = await scheduleService.getTodaySchedule(date);
  const bookedCount = await getActiveBookingCount(date);

  return {
    bookingOpen: settings.bookingOpen && Boolean(schedule?.bookingOpen),
    consultantOnLeave: settings.consultantOnLeave,
    leaveReason: settings.leaveReason,
    isConsultationDay: Boolean(schedule),
    dayName: getTodayDayName(date),
    consultationDay: schedule ? getTodayDayName(date) : 'None (not a consultation day)',
    location: schedule?.location || 'N/A',
    bookedCount,
    tokenLimit: schedule?.tokenLimit || 0,
    remainingTokens: schedule ? Math.max(0, schedule.tokenLimit - bookedCount) : 0,
  };
};

module.exports = {
  BookingError,
  tokenCounterKey,
  getTodayBookings,
  getAllTodayBookings,
  getActiveBookingCount,
  findDuplicateBooking,
  findBookingByPhone,
  findBookingByToken,
  createBooking,
  cancelBooking,
  getTodayStatus,
};
