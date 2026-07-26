const CONSULTANT = 'Kannavam Thangal';

module.exports = {
  WELCOME: (customMessage) =>
    customMessage ||
    `Assalamu Alaikum ورحمة الله وبركاته\n\nWelcome to the Appointment Service of *${CONSULTANT}*.\n\nKindly provide your Full Name.`,

  ASK_PLACE: 'Please enter your place.',

  ASK_PHONE: 'Please enter your mobile number.',

  INVALID_NAME: 'Please enter a valid full name.',

  INVALID_PLACE: 'Please enter a valid place.',

  INVALID_PHONE:
    'That does not look like a valid mobile number.\n\nPlease enter a 10-digit mobile number (example: 9876543210).',

  BOOKING_CLOSED:
    'Booking is currently closed.\n\nPlease contact us for the next consultation day.',

  CONSULTANT_ON_LEAVE: (reason) =>
    reason
      ? `${CONSULTANT} is unavailable today.\n\nReason: ${reason}\n\nPlease contact us for the next consultation day.`
      : `${CONSULTANT} is unavailable today.\n\nPlease contact us for the next consultation day.`,

  NOT_CONSULTATION_DAY:
    'Appointments are issued only on Tuesday, Wednesday and Saturday.\n\nPlease contact us on the next consultation day.',

  TOKEN_LIMIT_REACHED:
    "Today's appointments are full.\n\nPlease contact us for the next consultation day.",

  DUPLICATE_BOOKING: (booking) =>
    `You already have an appointment for today.\n\n*Token Number:* ${booking.tokenNumber}\n*Reporting Time:* ${booking.reportingTime}\n*Location:* ${booking.consultationLocation}`,

  ALREADY_BOOKED_HINT:
    'Your appointment is already confirmed. Send *Hi* if you would like to start again.',

  GENERIC_ERROR:
    'Sorry, something went wrong while processing your request. Please try again in a few minutes.',

  BOOKING_CONFIRMATION: (booking) =>
    `Assalamu Alaikum ورحمة الله وبركاته\n\nYour appointment with *${CONSULTANT}* has been confirmed.\n\n*Token Number:*\n${booking.tokenNumber}\n\n*Consultation Day:*\n${booking.consultationDay}\n\n*Location:*\n${booking.consultationLocation}\n\n*Reporting Time:*\n${booking.reportingTime}\n\nPlease arrive before your reporting time.\n\nJazakAllahu Khairan.`,

  ADMIN_NEW_BOOKING: (booking) =>
    `📌 *New Appointment*\n\n*Token:* ${booking.tokenNumber}\n*Visitor Name:* ${booking.visitorName}\n*Place:* ${booking.place}\n*Phone:* ${booking.phone}\n*Consultation Day:* ${booking.consultationDay}\n*Location:* ${booking.consultationLocation}\n*Reporting Time:* ${booking.reportingTime}`,

  ADMIN_MENU: `📋 *${CONSULTANT} Appointment Manager*

1️⃣ Open Booking — \`open\`
2️⃣ Close Booking — \`close\`
3️⃣ Today's Status — \`status\`
4️⃣ Today's Bookings — \`today\`
5️⃣ Leave Today — \`leave\`
6️⃣ Resume Booking — \`resume\`
7️⃣ Update Schedule — \`schedule\`
8️⃣ Update Token Limit — \`limit 25\`
9️⃣ Help — \`help\``,

  ADMIN_HELP: `*Available Commands*

\`menu\` — Show the menu
\`open\` — Open booking
\`close\` — Close booking
\`leave [reason]\` — Mark consultant unavailable and close booking
\`resume\` — Resume booking
\`status\` — Today's status
\`today\` — Today's bookings summary
\`list\` — All booked visitors with tokens
\`find <phone>\` — Booking details for a visitor
\`cancel <token>\` — Cancel a booking (example: \`cancel T005\`)
\`limit <number>\` — Update today's token limit (example: \`limit 25\`)
\`schedules\` — Show all configured days

*Update a schedule*
\`schedule Tuesday "Jalaliya Manzil Adhur" 10:00 13:00 14:00 16:00 30\``,

  BOOKING_OPENED: 'Booking is now open.',
  BOOKING_CLOSED_ADMIN: 'Booking closed.',
  LEAVE_SET: 'Consultant marked unavailable.\nBookings closed.',
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
    'Today is not a consultation day, so there is no token limit to update.\n\nUse `schedule <day> ...` to change a specific day.',
  SCHEDULE_UPDATED: (schedule) =>
    `Schedule updated.\n\n*Day:* ${schedule.day}\n*Location:* ${schedule.location}\n*Morning:* ${schedule.morningStart}–${schedule.morningEnd}\n*Afternoon:* ${schedule.afternoonStart}–${schedule.afternoonEnd}\n*Token Limit:* ${schedule.tokenLimit}`,
  SCHEDULE_FORMAT_HELP:
    'Invalid format. Usage:\n`schedule Tuesday "Jalaliya Manzil Adhur" 10:00 13:00 14:00 16:00 30`',
  LIMIT_UPDATED: (schedule) =>
    `Today's token limit updated to ${schedule.tokenLimit}.`,
  NO_BOOKINGS_TODAY: 'No bookings for today.',
};
