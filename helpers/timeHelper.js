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

const getBookingDate = (date = new Date()) => {
  const { year, month, day } = getZonedParts(date);
  return new Date(Date.UTC(year, month - 1, day));
};

const getDateKey = (date = new Date()) => {
  const { year, month, day } = getZonedParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const addLocalDays = (date, days) => {
  const { year, month, day } = getZonedParts(date);
  return new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
};

const formatDisplayDate = (date = new Date()) => {
  const { weekday, day, month, year } = getZonedParts(date);
  const monthName = new Date(Date.UTC(year, month - 1, day)).toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  return `${weekday}, ${day} ${monthName} ${year}`;
};

/** "today" | "tomorrow" | null — relative to consultation timezone. */
const getRelativeDayLabel = (targetDate, now = new Date()) => {
  const todayKey = getDateKey(now);
  const targetKey = getDateKey(targetDate);
  if (targetKey === todayKey) return 'today';
  if (targetKey === getDateKey(addLocalDays(now, 1))) return 'tomorrow';
  return null;
};

/** e.g. "Tuesday, 28 Jul 2026 (tomorrow)" */
const formatConsultationLabel = (date = new Date(), now = new Date()) => {
  const display = formatDisplayDate(date);
  const relative = getRelativeDayLabel(date, now);
  return relative ? `${display} (${relative})` : display;
};

const findNextConsultationDate = async (fromDate, getScheduleForDate) => {
  for (let offset = 0; offset < 14; offset += 1) {
    const candidate = addLocalDays(fromDate, offset);
    // eslint-disable-next-line no-await-in-loop
    const schedule = await getScheduleForDate(candidate);
    if (schedule) {
      return {
        date: candidate,
        dayName: getTodayDayName(candidate),
        schedule,
      };
    }
  }
  return null;
};

/**
 * Walks the next two weeks and returns every active consultation day with
 * window / remaining-token metadata for clear visitor and admin messaging.
 */
const findUpcomingConsultations = async (fromDate, getScheduleForDate, getBookedCount) => {
  const upcoming = [];

  for (let offset = 0; offset < 14; offset += 1) {
    const candidate = addLocalDays(fromDate, offset);
    // eslint-disable-next-line no-await-in-loop
    const schedule = await getScheduleForDate(candidate);
    if (!schedule) continue;

    const windowOpen = isWithinAdvanceBookingWindow(fromDate, candidate);
    // eslint-disable-next-line no-await-in-loop
    const bookedCount = getBookedCount ? await getBookedCount(candidate) : 0;
    const remaining = Math.max(0, (schedule.tokenLimit || 0) - bookedCount);

    upcoming.push({
      date: candidate,
      dayName: getTodayDayName(candidate),
      schedule,
      displayDate: formatDisplayDate(candidate),
      label: formatConsultationLabel(candidate, fromDate),
      opensOn: formatDisplayDate(addLocalDays(candidate, -1)),
      windowOpen,
      bookedCount,
      remaining,
      dayOpen: Boolean(schedule.bookingOpen),
      isFull: remaining <= 0,
    });
  }

  return upcoming;
};

// Booking for a consultation day is only open on the local calendar day before
// that consultation. Same-day booking is intentionally blocked.
const isWithinAdvanceBookingWindow = (now, consultationDate) => {
  const bookingDay = getBookingDate(now).getTime();
  const priorDay = getBookingDate(addLocalDays(consultationDate, -1)).getTime();
  return bookingDay === priorDay;
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

/**
 * Accepts admin-friendly clocks: 10am, 10 am, 10:00, 12pm, 1:30 PM.
 * Returns 24-hour `HH:mm`, or null when invalid.
 */
const parseFlexibleTime = (value) => {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ');

  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3] || '';

  if (minutes < 0 || minutes > 59) return null;

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'am') {
      hours = hours === 12 ? 0 : hours;
    } else {
      hours = hours === 12 ? 12 : hours + 12;
    }
  } else if (hours > 23) {
    return null;
  }

  if (hours < 0 || hours > 23) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

/**
 * Pulls one or two "start to end" ranges from text such as:
 *   10am to 12pm
 *   10 am to 12pm 1pm to 4pm
 */
const parseTimeRanges = (text) => {
  const source = String(text || '').trim();
  if (!source) return [];

  const rangePattern =
    /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|-|–|—)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/gi;
  const ranges = [];
  let match = rangePattern.exec(source);

  while (match) {
    const start = parseFlexibleTime(match[1]);
    const end = parseFlexibleTime(match[2]);
    if (!start || !end) return null;
    ranges.push({ start, end });
    match = rangePattern.exec(source);
  }

  return ranges;
};

const formatMinutesToTime = (totalMinutes) => {
  const clamped = Math.max(0, Math.min(totalMinutes, 24 * 60 - 1));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
};

/** Convert stored `HH:mm` to a 12-hour label such as `10:00 AM`. */
const formatClock12Hour = (timeStr) => {
  if (!isValidTimeString(timeStr)) return String(timeStr || '');
  return formatMinutesToTime(parseTimeToMinutes(timeStr));
};

/** False when afternoon was cleared (start == end) for a morning-only day. */
const hasAfternoonSession = (schedule) => {
  if (!schedule?.afternoonStart || !schedule?.afternoonEnd) return false;
  return (
    parseTimeToMinutes(schedule.afternoonEnd) >
    parseTimeToMinutes(schedule.afternoonStart)
  );
};

const calculateReportingTime = (schedule, tokenIndex) => {
  // Fixed 10-minute slots so each token has a clear reporting time.
  const SLOT_MINUTES = 10;
  const morningStart = parseTimeToMinutes(schedule.morningStart);
  const morningEnd = parseTimeToMinutes(schedule.morningEnd);
  const afternoonStart = parseTimeToMinutes(schedule.afternoonStart);
  const afternoonEnd = parseTimeToMinutes(schedule.afternoonEnd);

  const morningDuration = Math.max(0, morningEnd - morningStart);
  const tokenOffset = Math.max(0, tokenIndex - 1) * SLOT_MINUTES;

  if (tokenOffset < morningDuration) {
    return formatMinutesToTime(morningStart + tokenOffset);
  }

  // Morning-only days (no afternoon session) keep every overflow token
  // at the last morning reporting slot.
  if (!hasAfternoonSession(schedule)) {
    const lastMorning = Math.max(morningStart, morningEnd - SLOT_MINUTES);
    return formatMinutesToTime(lastMorning);
  }

  const afternoonOffset = tokenOffset - morningDuration;
  const latestSlot = Math.max(afternoonStart, afternoonEnd - SLOT_MINUTES);
  return formatMinutesToTime(Math.min(afternoonStart + afternoonOffset, latestSlot));
};

module.exports = {
  getZonedParts,
  getTodayDayName,
  getBookingDate,
  getDateKey,
  addLocalDays,
  formatDisplayDate,
  getRelativeDayLabel,
  formatConsultationLabel,
  findNextConsultationDate,
  findUpcomingConsultations,
  isWithinAdvanceBookingWindow,
  parseTimeToMinutes,
  isValidTimeString,
  parseFlexibleTime,
  parseTimeRanges,
  formatMinutesToTime,
  formatClock12Hour,
  hasAfternoonSession,
  calculateReportingTime,
};
