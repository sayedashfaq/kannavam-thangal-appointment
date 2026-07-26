const env = require('../config/env');

// All day/date reasoning is done in the consultation timezone so the system
// behaves correctly when the server runs in UTC.
const getZonedParts = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: env.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
};

const getTodayDayName = (date = new Date()) => getZonedParts(date).weekday;

// Stable key for "which consultation day does this booking belong to".
// Stored as UTC midnight of the local calendar date so queries are exact.
const getBookingDate = (date = new Date()) => {
  const { year, month, day } = getZonedParts(date);
  return new Date(Date.UTC(year, month - 1, day));
};

const getDateKey = (date = new Date()) => {
  const { year, month, day } = getZonedParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const parseTimeToMinutes = (timeStr) => {
  const [hours, minutes] = String(timeStr).split(':').map(Number);
  return hours * 60 + minutes;
};

const isValidTimeString = (timeStr) => {
  if (!/^\d{1,2}:\d{2}$/.test(String(timeStr))) return false;
  const [hours, minutes] = String(timeStr).split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

const formatMinutesToTime = (totalMinutes) => {
  const clamped = Math.max(0, Math.min(totalMinutes, 24 * 60 - 1));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
};

const calculateReportingTime = (schedule, tokenIndex, dynamicEnabled = true) => {
  const morningStart = parseTimeToMinutes(schedule.morningStart);

  if (!dynamicEnabled) {
    return `${formatMinutesToTime(morningStart)} (Morning Session)`;
  }

  const morningEnd = parseTimeToMinutes(schedule.morningEnd);
  const afternoonStart = parseTimeToMinutes(schedule.afternoonStart);
  const afternoonEnd = parseTimeToMinutes(schedule.afternoonEnd);

  const morningDuration = Math.max(0, morningEnd - morningStart);
  const afternoonDuration = Math.max(0, afternoonEnd - afternoonStart);
  const totalDuration = morningDuration + afternoonDuration;
  const tokenLimit = Math.max(1, schedule.tokenLimit || 1);

  const slotMinutes = Math.max(5, Math.floor(totalDuration / tokenLimit));
  const tokenOffset = Math.max(0, tokenIndex - 1) * slotMinutes;

  if (tokenOffset < morningDuration) {
    return formatMinutesToTime(morningStart + tokenOffset);
  }

  const afternoonOffset = tokenOffset - morningDuration;
  const latestSlot = Math.max(afternoonStart, afternoonEnd - 5);
  return formatMinutesToTime(Math.min(afternoonStart + afternoonOffset, latestSlot));
};

module.exports = {
  getZonedParts,
  getTodayDayName,
  getBookingDate,
  getDateKey,
  parseTimeToMinutes,
  isValidTimeString,
  formatMinutesToTime,
  calculateReportingTime,
};
