const CONSULTANT = 'Kannavam Thangal';

const nextHint = (meta = {}) => {
  const next = meta.nextOpening;
  if (!next?.label) return '';
  return `\n\nNext opening: *${next.label}*\nTokens open from *${next.opensOn}*${
    next.location ? `\n📍 ${next.location}` : ''
  }`;
};

module.exports = {
  WELCOME: (customMessage, availability) => {
    if (customMessage) return customMessage;

    const day = availability?.active;
    if (day?.label) {
      return `Assalamu Alaikum ورحمة الله وبركاته

Welcome to the Appointment Service of *${CONSULTANT}*.

You are booking for:
*${day.label}*
📍 ${day.schedule?.location || 'Consultation venue'}
🎫 ${day.remaining} of ${day.schedule?.tokenLimit || 0} tokens left

Kindly provide your Full Name.`;
    }

    return `Assalamu Alaikum ورحمة الله وبركاته

Welcome to the Appointment Service of *${CONSULTANT}*.

Kindly provide your Full Name.`;
  },

  ASK_PLACE: 'Please enter your place.',

  ASK_PHONE: 'Please enter your mobile number.',

  INVALID_NAME: 'Please enter a valid full name.',

  INVALID_PLACE: 'Please enter a valid place.',

  INVALID_PHONE:
    'That does not look like a valid mobile number.\n\nPlease enter a 10-digit mobile number (example: 9876543210).',

  CONSULTANT_ON_LEAVE: (reason, meta = {}) =>
    reason
      ? `*${CONSULTANT}* is currently unavailable.\n\nReason: ${reason}${
          meta.label ? `\n\nNext consultation was: *${meta.label}*` : ''
        }\n\nPlease send *Hi* again after bookings resume.`
      : `*${CONSULTANT}* is currently unavailable.${
          meta.label ? `\n\nNext consultation was: *${meta.label}*` : ''
        }\n\nPlease send *Hi* again after bookings resume.`,

  BOOKING_CLOSED: (meta = {}) =>
    `Booking is currently closed.${
      meta.label ? `\n\nActive consultation: *${meta.label}*` : ''
    }\n\nPlease send *Hi* again when booking reopens.`,

  NOT_CONSULTATION_DAY: (meta = {}) =>
    `No consultation days are scheduled in the next two weeks.${
      meta.nextOpening?.label
        ? `\n\nNext known day: *${meta.nextOpening.label}*`
        : '\n\nUsual days: Tuesday, Wednesday and Saturday.'
    }`,

  BOOKING_WINDOW_CLOSED: (meta = {}) => {
    const dayLabel = meta.label || `${meta.consultationDay} (${meta.displayDate})`;
    const next = meta.nextOpening;
    if (next?.label && next.label !== dayLabel) {
      return `Booking for *${dayLabel}* is not open yet.

Tokens for that day open from *${meta.opensOn}* (the day before).

You can book *${next.label}* once tokens open on *${next.opensOn}*.`;
    }

    return `Booking for *${dayLabel}* is not open yet.

Tokens open from *${meta.opensOn}* (the day before).

Please message again then — no need to wait on the consultation day itself.`;
  },

  TOKEN_LIMIT_REACHED: (meta = {}) =>
    `Appointments for *${meta.label || 'this consultation day'}* are full.${nextHint(meta)}`,

  AVAILABILITY_UNAVAILABLE: (snapshot) => {
    const { state, settings, active, nextOpening } = snapshot;
    const meta = {
      label: active?.label,
      consultationDay: active?.dayName,
      displayDate: active?.displayDate,
      opensOn: active?.opensOn || nextOpening?.opensOn,
      nextOpening: nextOpening
        ? {
            label: nextOpening.label,
            opensOn: nextOpening.opensOn,
            location: nextOpening.schedule?.location,
          }
        : null,
    };

    if (state === 'ON_LEAVE') {
      return module.exports.CONSULTANT_ON_LEAVE(settings.leaveReason, meta);
    }
    if (state === 'GLOBALLY_CLOSED' || state === 'DAY_CLOSED') {
      return module.exports.BOOKING_CLOSED(meta);
    }
    if (state === 'FULL') {
      return module.exports.TOKEN_LIMIT_REACHED(meta);
    }
    if (state === 'WINDOW_CLOSED') {
      return module.exports.BOOKING_WINDOW_CLOSED(meta);
    }
    return module.exports.NOT_CONSULTATION_DAY(meta);
  },

  DUPLICATE_BOOKING: (booking) =>
    `You already have an appointment for *${booking.consultationDay}*${
      booking.displayDate ? ` (${booking.displayDate})` : ''
    }.

*Token Number:* ${booking.tokenNumber}
*Reporting Time:* ${booking.reportingTime}
*Location:* ${booking.consultationLocation}`,

  ALREADY_BOOKED_HINT:
    'Your appointment is already confirmed. Send *Hi* if you would like to start again.',

  GENERIC_ERROR:
    'Sorry, something went wrong while processing your request. Please try again in a few minutes.',

  BOOKING_CONFIRMATION: (booking) =>
    `Assalamu Alaikum ورحمة الله وبركاته

Your appointment with *${CONSULTANT}* has been confirmed.

*Token Number:*
${booking.tokenNumber}

*Consultation:*
${booking.label || `${booking.consultationDay}${booking.displayDate ? `\n${booking.displayDate}` : ''}`}

*Location:*
${booking.consultationLocation}

*Reporting Time:*
${booking.reportingTime}

Please arrive before your reporting time.

JazakAllahu Khairan.`,

  ADMIN_NEW_BOOKING: (booking) =>
    `📌 *New Appointment*

*Token:* ${booking.tokenNumber}
*Visitor Name:* ${booking.visitorName}
*Place:* ${booking.place}
*Phone:* ${booking.phone}
*Consultation:* ${booking.label || `${booking.consultationDay}${booking.displayDate ? ` (${booking.displayDate})` : ''}`}
*Location:* ${booking.consultationLocation}
*Reporting Time:* ${booking.reportingTime}`,

  ADMIN_MENU: `📋 *${CONSULTANT} Appointment Manager*

1️⃣ Open Booking — \`open\`
2️⃣ Close Booking — \`close\`
3️⃣ Status — \`status\`
4️⃣ Bookings — \`today\` / \`list\`
5️⃣ Leave — \`leave\`
6️⃣ Resume — \`resume\`
7️⃣ Upcoming days — \`upcoming\`
8️⃣ Update Schedule — \`schedule\`
9️⃣ Token Limit — \`limit 25\`
🔟 Help — \`help\``,

  ADMIN_HELP: `*Available Commands*

\`menu\` — Show the menu
\`open\` — Open booking
\`close\` — Close booking
\`leave [reason]\` — Mark consultant unavailable and close booking
\`resume\` — Resume booking
\`status\` — Active consultation status
\`today\` / \`list\` — Bookings for the active consultation day
\`upcoming\` — Next consultation days with dates and token windows
\`schedules\` — Configured weekdays
\`find <phone>\` — Booking details for a visitor
\`cancel <token>\` — Cancel a booking (example: \`cancel T005\`)
\`limit <number>\` — Update token limit for the active consultation day
\`help\` — Show this help

*Update a schedule*
\`schedule Tuesday "Jalaliya Manzil Adhur" 10:00 13:00 14:00 16:00 30\``,

  BOOKING_OPENED: 'Booking is now open.',
  BOOKING_CLOSED_ADMIN: 'Booking closed.',
  LEAVE_SET: 'Consultant marked unavailable.\nBookings closed for visitors.',
  RESUME_SET: 'Bookings resumed.',
  UNKNOWN_COMMAND: 'Unknown command. Type `menu` to see the available commands.',
  BOOKING_NOT_FOUND: 'No booking found.',
  BOOKING_CANCELLED: (booking) =>
    `Booking ${booking.tokenNumber} (${booking.visitorName}) has been cancelled.`,
  BOOKING_ALREADY_CANCELLED: (token) => `Booking ${token} is already cancelled.`,
  INVALID_TOKEN: 'Invalid token. Use a format like `T001` or `cancel 5`.',
  INVALID_LIMIT: 'Invalid limit. Usage: `limit 25`',
  INVALID_PHONE_SEARCH: 'Invalid phone number. Usage: `find 9876543210`',
  INVALID_DAY: 'Invalid day. Use a weekday name such as `Tuesday`.',
  INVALID_TIME: 'Invalid time. Use 24-hour times such as `10:00` and `13:00`.',
  NO_SCHEDULE_TODAY:
    'No active consultation day is available to update right now.\n\nUse `schedule <day> ...` or `upcoming` to see the next days.',
  SCHEDULE_UPDATED: (schedule) =>
    `Schedule updated.\n\n*Day:* ${schedule.day}\n*Location:* ${schedule.location}\n*Morning:* ${schedule.morningStart}–${schedule.morningEnd}\n*Afternoon:* ${schedule.afternoonStart}–${schedule.afternoonEnd}\n*Token Limit:* ${schedule.tokenLimit}`,
  SCHEDULE_FORMAT_HELP:
    'Invalid format. Usage:\n`schedule Tuesday "Jalaliya Manzil Adhur" 10:00 13:00 14:00 16:00 30`',
  LIMIT_UPDATED: (schedule, label) =>
    `Token limit for *${label || schedule.day}* updated to ${schedule.tokenLimit}.`,
  NO_BOOKINGS_TODAY: 'No bookings for the active consultation day.',
};
