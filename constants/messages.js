const CONSULTANT = 'Kannavam Thangal';

// Greeting used on messages sent from the office/system to visitors.
const SALAM = `السَّلاَمُ عَلَيْكُمْ وَرَحْمَةُ اللهِ وَبَرَكَاتُهُ`;

const nextHint = (meta = {}) => {
  const next = meta.nextOpening;
  if (!next?.label) return '';
  return `\n\nNext opening: *${next.label}*\nTokens open from *${next.opensOn}*${
    next.location ? `\n📍 ${next.location}` : ''
  }`;
};

module.exports = {
  SALAM,

  WELCOME: (customMessage, availability) => {
    if (customMessage) return customMessage;

    const day = availability?.active;
    if (day?.label) {
      return `${SALAM}

Welcome to the Appointment Service of *${CONSULTANT}*.

You are booking for:
*${day.label}*
📍 ${day.schedule?.location || 'Consultation venue'}${
        day.earlyOpenAfterLeave
          ? '\n\n_(An earlier consultation day is on leave, so this next day is open for booking now.)_'
          : ''
      }

Kindly provide your Full Name.`;
    }

    return `${SALAM}

Welcome to the Appointment Service of *${CONSULTANT}*.

Kindly provide your Full Name.`;
  },

  ASK_PLACE: 'Please enter your place.',

  ASK_PHONE: 'Please enter your mobile number.',

  ASK_MEMBERS: (maxMembers = 5) =>
    `How many family members will come with this token (including you)?\n\nReply with a number from *1* to *${maxMembers}*.`,

  INVALID_NAME: 'Please enter a valid full name.',

  INVALID_PLACE: 'Please enter a valid place.',

  INVALID_PHONE:
    'That does not look like a valid mobile number.\n\nPlease enter a 10-digit mobile number (example: 9876543210).',

  INVALID_MEMBERS: (maxMembers = 10) =>
    `Please enter a valid number of members from *1* to *${maxMembers}*.`,

  CONSULTANT_ON_LEAVE: (reason, meta = {}) =>
    reason
      ? `*${CONSULTANT}* is currently unavailable.\n\nReason: ${reason}${
          meta.label ? `\n\nNext consultation was: *${meta.label}*` : ''
        }\n\nPlease send *Hi* again after bookings resume.`
      : `*${CONSULTANT}* is currently unavailable.${
          meta.label ? `\n\nNext consultation was: *${meta.label}*` : ''
        }\n\nPlease send *Hi* again after bookings resume.`,

  DAY_ON_LEAVE: (meta = {}) =>
    `*${CONSULTANT}* is on leave for *${meta.label || 'that consultation day'}*.${
      meta.reason ? `\n\nReason: ${meta.reason}` : ''
    }${nextHint(meta)}\n\nSend *Hi* to book the next available day.`,

  BOOKING_CLOSED: (meta = {}) =>
    `Booking is temporarily paused by the office.${
      meta.label ? `\n\nLast active consultation: *${meta.label}*` : ''
    }\n\nPlease send *Hi* again when booking reopens.`,

  LEAVE_NOTICE_TO_VISITOR: ({ visitorName, tokenNumber, label, reason }) =>
    `${SALAM}

Dear ${visitorName || 'Visitor'},

*${CONSULTANT}* has taken leave for *${label}*.
${reason ? `\nReason: ${reason}\n` : ''}
Your appointment *${tokenNumber}* for that day has been cancelled.

Please send *Hi* to book the next available consultation day.

JazakAllahu Khairan.`,

  VENUE_CHANGE_NOTICE_TO_VISITOR: ({ booking, venue }) =>
    `${SALAM}

Dear ${booking.visitorName || 'Visitor'},

Your consultation venue has been updated.

*Token Number:* ${booking.tokenNumber}
*Consultation:* ${booking.label || booking.consultationDay}${
      booking.displayDate ? ` (${booking.displayDate})` : ''
    }
*Reporting Time:* ${booking.reportingTime}
*Members:* ${booking.memberCount || 1}
*New Location:* ${venue.name || booking.consultationLocation}

Please arrive *30 minutes before* your reporting time.

Open map:
${venue.mapsUrl || 'Ask the office for directions.'}

JazakAllahu Khairan.`,

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
    if (state === 'DAY_ON_LEAVE') {
      return module.exports.DAY_ON_LEAVE({
        ...meta,
        reason: active?.leaveReason || '',
      });
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
    `You already have an appointment.

*Token Number:* ${booking.tokenNumber}
*Consultation:* ${booking.label || `${booking.consultationDay}${booking.displayDate ? ` (${booking.displayDate})` : ''}`}
*Reporting Time:* ${booking.reportingTime}
*Members:* ${booking.memberCount || 1}
*Location:* ${booking.consultationLocation}

Please arrive *30 minutes before* your reporting time.
Send *Hi* anytime to see these details again.`,

  ALREADY_BOOKED_HINT:
    'Your appointment is already confirmed. Send *Hi* to see your token details.',

  GENERIC_ERROR:
    'Sorry, something went wrong while processing your request. Please try again in a few minutes.',

  BOOKING_CONFIRMATION: (booking) =>
    `${SALAM}

Your appointment with *${CONSULTANT}* has been confirmed.

*Token Number:*
${booking.tokenNumber}

*Consultation:*
${booking.label || `${booking.consultationDay}${booking.displayDate ? `\n${booking.displayDate}` : ''}`}

*Members:*
${booking.memberCount || 1}

*Location:*
${booking.consultationLocation}

*Reporting Time:*
${booking.reportingTime}

Please arrive *30 minutes before* your reporting time.

JazakAllahu Khairan.`,

  LOCATION_PIN: (booking, venue) =>
    `📍 *Location for your visit*

*${booking.consultationLocation}*
Consultation: ${booking.label || booking.consultationDay}
Reporting time: ${booking.reportingTime}

Please arrive *30 minutes before* your reporting time.

Open map:
${venue?.mapsUrl || 'Ask the office for directions.'}`,

  ADMIN_NEW_BOOKING: (booking) =>
    `📌 *New Appointment*

*Token:* ${booking.tokenNumber}
*Visitor Name:* ${booking.visitorName}
*Place:* ${booking.place}
*Phone:* ${booking.phone}
*Members:* ${booking.memberCount || 1}
*Consultation:* ${booking.label || `${booking.consultationDay}${booking.displayDate ? ` (${booking.displayDate})` : ''}`}
*Location:* ${booking.consultationLocation}
*Reporting Time:* ${booking.reportingTime}`,

  ADMIN_MENU: `📋 *${CONSULTANT} Appointment Manager*

1️⃣ Pause all booking — \`close\`
2️⃣ Open all booking — \`open\`
3️⃣ Status — \`status\`
4️⃣ Bookings — \`today\` / \`list\` / \`list tuesday\`
5️⃣ Day leave — \`leave tuesday\`
6️⃣ Open a day again — \`open tuesday\`
7️⃣ Venue — \`change adhur\` / \`change bendichal\`
8️⃣ Hours — \`change time wednesday 10am to 1pm 2pm to 4pm\`
9️⃣ Family size — \`members 5\`
🔟 Token limit — \`limit 25\`
ℹ️ Help — \`help\``,

  ADMIN_HELP: `*Available Commands*

*Pause everything temporarily*
\`close\` — Stop all new bookings now
\`open\` — Allow all bookings again

*Day-specific leave* (next day stays bookable automatically)
\`leave tuesday\` — Next Tuesday on leave + notify visitors
\`leave saturday emergency\` — Next Saturday on leave with reason
\`open tuesday\` — Change of mind: open that Tuesday again
\`open saturday\` — Open that Saturday again
\`resume tuesday\` — Same as \`open tuesday\`

*Lists & status*
\`status\` — Who can book right now
\`upcoming\` — Next days with dates / leave / tokens
\`today\` — Bookings for the active open day
\`list\` — Same as today
\`list tuesday\` — Bookings for next Tuesday
\`schedules\` — Weekly schedule setup
\`find <phone>\` — Find a visitor booking
\`cancel <token>\` — Cancel one booking
\`limit 25\` — Token limit for the active day
\`members\` — Show max family members per token
\`members 5\` — Set max family members allowed on one token
\`change adhur\` — Set active day's venue to Jalaliya Manzil Adhur
\`change bendichal\` — Set active day's venue to Jalaliya Manzil Bendichal
\`change adhur tuesday\` — Set Tuesday venue to Adhur
\`change bendichal saturday\` — Set Saturday venue to Bendichal
\`change time wednesday 10am to 12pm\` — Morning only (no afternoon)
\`change time wednesday 10am to 12pm 1pm to 4pm\` — Morning + afternoon
\`change time 10am to 1pm 2pm to 4pm\` — Hours for the active day
\`location\` — Same as \`change\`
\`help\` — This help

*Update a full schedule*
\`schedule Tuesday "Jalaliya Manzil Adhur" 10:00 13:00 14:00 16:00 30\`

Default hours: *10:00 AM–1:00 PM* and *2:00 PM–4:00 PM*.`,

  BOOKING_OPENED: 'All booking is open again.',
  BOOKING_CLOSED_ADMIN: 'All booking is paused temporarily.\nVisitors cannot take new tokens until you send `open`.',
  LOCATION_USAGE: (venuesHelp) =>
    `Change consultation venue.\n\nExamples:\n\`change adhur\`\n\`change bendichal\`\n\`change adhur tuesday\`\n\`change bendichal saturday\`\n\nVenues:\n${venuesHelp}`,
  LOCATION_UPDATED: ({ day, venue, updatedCount = 0, notifiedCount = 0 }) =>
    `Venue updated.\n\n*Day:* ${day}\n*Location:* ${venue.name}\n*Map:* ${venue.mapsUrl}\n\nBookings updated: ${updatedCount}\nVisitors notified: ${notifiedCount}`,
  LOCATION_UPDATED_MULTI: ({ days, venue, updatedCount = 0, notifiedCount = 0 }) =>
    `Venue updated for *${days.join(', ')}*.\n\n*Location:* ${venue.name}\n*Map:* ${venue.mapsUrl}\n\nBookings updated: ${updatedCount}\nVisitors notified: ${notifiedCount}`,
  TIME_USAGE:
    'Change consultation hours.\n\nExamples:\n`change time wednesday 10am to 12pm` — morning only, no afternoon\n`change time wednesday 10am to 12pm 1pm to 4pm` — morning + afternoon\n`change time 10am to 1pm 2pm to 4pm` — active day\n\nDefault hours: 10:00 AM–1:00 PM and 2:00 PM–4:00 PM.',
  TIME_UPDATED: (schedule) => {
    const {
      formatClock12Hour,
      hasAfternoonSession,
    } = require('../helpers/timeHelper');
    const morning = `${formatClock12Hour(schedule.morningStart)} – ${formatClock12Hour(schedule.morningEnd)}`;
    if (!hasAfternoonSession(schedule)) {
      return `Hours updated.\n\n*Day:* ${schedule.day}\n*Morning:* ${morning}\n*Afternoon:* none (morning only)`;
    }
    const afternoon = `${formatClock12Hour(schedule.afternoonStart)} – ${formatClock12Hour(schedule.afternoonEnd)}`;
    return `Hours updated.\n\n*Day:* ${schedule.day}\n*Morning:* ${morning}\n*Afternoon:* ${afternoon}`;
  },
  LEAVE_USAGE:
    'Specify the consultation day.\n\nExamples:\n`leave tuesday`\n`leave saturday emergency`\n`leave next wednesday Travelling`\n\nOther days stay open for booking.\nUse `close` if you need to pause *everything*.',
  RESUME_USAGE:
    'Specify the day to open again.\n\nExamples:\n`open tuesday`\n`open saturday`\n`resume wednesday`\n\nUse plain `open` if all booking was paused with `close`.',
  LEAVE_SET_DAY: ({ label, reason, notifiedCount, cancelledCount }) =>
    `Leave set for *${label}*.${
      reason ? `\nReason: ${reason}` : ''
    }\n\nNew bookings for that day are blocked.\nVisitors can book the *next* consultation day automatically.\n\nCancelled bookings: ${cancelledCount}\nVisitors notified: ${notifiedCount}\n\nChanged your mind later? Send \`open ${label.split(',')[0].toLowerCase().split(' ')[0]}\`.`,
  LEAVE_ALREADY_SET: (label) => `*${label}* is already marked on leave.\nSend \`open\` with that day name to clear it.`,
  LEAVE_CLEARED: (label) =>
    `*${label}* is open again.\nVisitors can book that day now.\nTokens restart from *T001* with morning reporting times.`,
  LEAVE_NOT_SET: (label) => `*${label}* is not on leave.`,
  LEAVE_NO_DAY:
    'No matching consultation day found in the next 3 weeks.\nUsual days: Tuesday, Wednesday, Saturday.',
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
  SCHEDULE_UPDATED: (schedule) => {
    const {
      formatClock12Hour,
      hasAfternoonSession,
    } = require('../helpers/timeHelper');
    const morning = `${formatClock12Hour(schedule.morningStart)} – ${formatClock12Hour(schedule.morningEnd)}`;
    const afternoon = hasAfternoonSession(schedule)
      ? `${formatClock12Hour(schedule.afternoonStart)} – ${formatClock12Hour(schedule.afternoonEnd)}`
      : 'none (morning only)';
    return `Schedule updated.\n\n*Day:* ${schedule.day}\n*Location:* ${schedule.location}\n*Morning:* ${morning}\n*Afternoon:* ${afternoon}\n*Token Limit:* ${schedule.tokenLimit}`;
  },
  SCHEDULE_FORMAT_HELP:
    'Invalid format. Usage:\n`schedule Tuesday "Jalaliya Manzil Adhur" 10:00 13:00 14:00 16:00 30`',
  LIMIT_UPDATED: (schedule, label) =>
    `Token limit for *${label || schedule.day}* updated to ${schedule.tokenLimit}.`,
  MEMBERS_STATUS: (max) =>
    `Max family members per token: *${max}*\n\nVisitors are asked this while booking.\nChange with \`members 5\`.`,
  MEMBERS_UPDATED: (max) =>
    `Max family members per token set to *${max}*.`,
  INVALID_MEMBERS_LIMIT: 'Invalid members limit. Usage: `members 5` (1–50)',
  NO_BOOKINGS_TODAY: 'No bookings for the active consultation day.',
};
