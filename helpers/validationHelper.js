const { GREETING_KEYWORDS, WEEKDAYS } = require('../constants');

const isGreeting = (message) => {
  const normalized = String(message || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

  if (!normalized) return false;
  return GREETING_KEYWORDS.includes(normalized);
};

const sanitizeText = (value, maxLength = 100) =>
  String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);

const sanitizeName = (name) => sanitizeText(name, 100);

const sanitizePlace = (place) => sanitizeText(place, 100);

const capitalizeDay = (day) => {
  const value = String(day || '').trim();
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
};

const isValidWeekday = (day) => WEEKDAYS.includes(capitalizeDay(day));

module.exports = {
  isGreeting,
  sanitizeText,
  sanitizeName,
  sanitizePlace,
  capitalizeDay,
  isValidWeekday,
};
