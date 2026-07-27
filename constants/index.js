const BOOKING_STATUS = {
  BOOKED: 'BOOKED',
  VISITED: 'VISITED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
};

const CONVERSATION_STEPS = {
  START: 'START',
  WAIT_NAME: 'WAIT_NAME',
  WAIT_PLACE: 'WAIT_PLACE',
  WAIT_PHONE: 'WAIT_PHONE',
  WAIT_MEMBERS: 'WAIT_MEMBERS',
  COMPLETED: 'COMPLETED',
};

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// Days seeded by default. A day counts as a consultation day only while an
// active Schedule document exists for it, so this list is a starting point
// rather than a hard restriction.
const CONSULTATION_DAYS = ['Tuesday', 'Wednesday', 'Saturday'];

const GREETING_KEYWORDS = [
  'hi',
  'hai',
  'hey',
  'hello',
  'salam',
  'salaam',
  'assalamualaikum',
  'assalamualaikkum',
  'asalamualaikum',
  'assalamalaikum',
  'salamualaikum',
  'start',
  'book',
  'booking',
  'appointment',
  'token',
];

module.exports = {
  BOOKING_STATUS,
  CONVERSATION_STEPS,
  WEEKDAYS,
  CONSULTATION_DAYS,
  GREETING_KEYWORDS,
};
