const { CONVERSATION_STEPS } = require('../constants');
const messages = require('../constants/messages');
const { isGreeting, sanitizeName, sanitizePlace } = require('../helpers/validationHelper');
const { validatePhone } = require('../helpers/phoneHelper');
const { getDateKey } = require('../helpers/timeHelper');
const conversationService = require('./conversationService');
const bookingService = require('./bookingService');
const settingsService = require('./settingsService');
const adminService = require('./adminService');
const whatsappService = require('./whatsappService');
const logger = require('../utils/logger');

const { BookingError } = bookingService;

const ACTIVE_STEPS = [
  CONVERSATION_STEPS.WAIT_NAME,
  CONVERSATION_STEPS.WAIT_PLACE,
  CONVERSATION_STEPS.WAIT_PHONE,
];

const reply = async (to, text) => {
  try {
    await whatsappService.sendTextMessage(to, text);
  } catch (error) {
    logger.error('Could not deliver reply', { to, error: error.message });
  }
};

const handleIncomingMessage = async (from, text, messageId) => {
  logger.info('Incoming WhatsApp message', { from, text: String(text).slice(0, 120) });

  if (messageId) {
    whatsappService.markMessageAsRead(messageId);
  }

  const adminReply = await adminService.handleAdminCommand(from, text);
  if (adminReply) {
    await reply(from, adminReply);
    return;
  }

  if (adminService.isAdmin(from)) {
    const conversation = await conversationService.getConversation(from);
    const midBooking = ACTIVE_STEPS.includes(conversation.currentStep);

    // The admin can still book on someone's behalf, but stray text gets a
    // command hint rather than silently opening a booking flow.
    if (!midBooking && !isGreeting(text)) {
      await reply(from, messages.UNKNOWN_COMMAND);
      return;
    }
  }

  await handleVisitorMessage(from, text);
};

const handleVisitorMessage = async (from, text) => {
  const message = String(text).trim();
  const conversation = await conversationService.getConversation(from);
  const step = conversation.currentStep;

  // A clear greeting always restarts, even mid-flow, so visitors never get
  // stuck if they send Hi again after a pause or a confusing reply.
  if (isGreeting(message)) {
    await startBookingFlow(from);
    return;
  }

  switch (step) {
    case CONVERSATION_STEPS.WAIT_NAME:
      await handleNameInput(from, message);
      break;

    case CONVERSATION_STEPS.WAIT_PLACE:
      await handlePlaceInput(from, message);
      break;

    case CONVERSATION_STEPS.WAIT_PHONE:
      await handlePhoneInput(from, message, conversation);
      break;

    case CONVERSATION_STEPS.COMPLETED:
      await reply(from, messages.ALREADY_BOOKED_HINT);
      break;

    default:
      await startBookingFlow(from);
  }
};

const startBookingFlow = async (from) => {
  const snapshot = await bookingService.getAvailabilitySnapshot();

  // Tell visitors immediately whether they can book — with the exact day —
  // instead of collecting details and failing at the end.
  if (snapshot.state !== 'BOOKABLE') {
    await conversationService.resetConversation(from);
    await reply(from, messages.AVAILABILITY_UNAVAILABLE(snapshot));
    return;
  }

  const settings = snapshot.settings;
  await conversationService.setStep(from, CONVERSATION_STEPS.WAIT_NAME, {
    targetDateKey: snapshot.active.date ? getDateKey(snapshot.active.date) : null,
  });
  await reply(from, messages.WELCOME(settings.welcomeMessage, snapshot));
};

const handleNameInput = async (from, name) => {
  const sanitized = sanitizeName(name);

  if (sanitized.length < 2) {
    await reply(from, messages.INVALID_NAME);
    return;
  }

  await conversationService.mergeStep(from, CONVERSATION_STEPS.WAIT_PLACE, {
    visitorName: sanitized,
  });
  await reply(from, messages.ASK_PLACE);
};

const handlePlaceInput = async (from, place) => {
  const sanitized = sanitizePlace(place);

  if (sanitized.length < 2) {
    await reply(from, messages.INVALID_PLACE);
    return;
  }

  await conversationService.mergeStep(from, CONVERSATION_STEPS.WAIT_PHONE, {
    place: sanitized,
  });
  await reply(from, messages.ASK_PHONE);
};

const handlePhoneInput = async (from, phoneInput, conversation) => {
  const { valid, phone } = validatePhone(phoneInput);

  if (!valid) {
    await reply(from, messages.INVALID_PHONE);
    return;
  }

  const { visitorName, place } = conversation.tempData || {};

  // Guards against a conversation document that lost its earlier answers.
  if (!visitorName || !place) {
    await startBookingFlow(from);
    return;
  }

  try {
    const booking = await bookingService.createBooking({
      visitorName,
      place,
      phone,
      whatsappNumber: from,
    });

    await conversationService.setStep(from, CONVERSATION_STEPS.COMPLETED, {});
    await reply(from, messages.BOOKING_CONFIRMATION(booking));
    await notifyAdmin(booking);
  } catch (error) {
    await handleBookingFailure(from, phone, error);
  }
};

const notifyAdmin = async (booking) => {
  const adminPhone = await settingsService.getAdminPhone();
  if (!adminPhone) {
    logger.warn('No admin phone configured, skipping booking notification');
    return;
  }

  await reply(adminPhone, messages.ADMIN_NEW_BOOKING(booking));
};

const handleBookingFailure = async (from, phone, error) => {
  await conversationService.resetConversation(from);
  const meta = error.meta || {};

  switch (error.message) {
    case BookingError.BOOKING_CLOSED:
      await reply(from, messages.BOOKING_CLOSED(meta));
      return;

    case BookingError.CONSULTANT_ON_LEAVE: {
      const settings = await settingsService.getSettings();
      await reply(from, messages.CONSULTANT_ON_LEAVE(settings.leaveReason, meta));
      return;
    }

    case BookingError.DAY_ON_LEAVE:
      await reply(from, messages.DAY_ON_LEAVE(meta));
      return;

    case BookingError.NOT_CONSULTATION_DAY:
      await reply(from, messages.NOT_CONSULTATION_DAY(meta));
      return;

    case BookingError.BOOKING_WINDOW_CLOSED:
      await reply(
        from,
        messages.BOOKING_WINDOW_CLOSED(
          meta.label || meta.opensOn
            ? meta
            : {
                consultationDay: 'the next consultation day',
                displayDate: 'soon',
                opensOn: 'the day before',
              }
        )
      );
      return;

    case BookingError.TOKEN_LIMIT_REACHED:
      await reply(from, messages.TOKEN_LIMIT_REACHED(meta));
      return;

    case BookingError.DUPLICATE_BOOKING: {
      const existing =
        meta.booking || (await bookingService.findBookingByPhone(phone));
      await reply(
        from,
        existing ? messages.DUPLICATE_BOOKING(existing) : messages.GENERIC_ERROR
      );
      return;
    }

    default:
      logger.error('Booking failed unexpectedly', {
        from,
        error: error.message,
        stack: error.stack,
      });
      await reply(from, messages.GENERIC_ERROR);
  }
};

module.exports = {
  handleIncomingMessage,
  handleVisitorMessage,
};
