const mongoose = require('mongoose');
const { BOOKING_STATUS } = require('../constants');

const bookingSchema = new mongoose.Schema(
  {
    visitorName: {
      type: String,
      required: true,
      trim: true,
    },
    place: {
      type: String,
      required: true,
      trim: true,
    },
    // Contact number given by the visitor, stored as the bare 10-digit number.
    phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    // WhatsApp number the booking was made from, kept for future reminders.
    whatsappNumber: {
      type: String,
      trim: true,
      default: '',
    },
    tokenNumber: {
      type: String,
      required: true,
    },
    tokenSequence: {
      type: Number,
      required: true,
    },
    bookingDate: {
      type: Date,
      required: true,
    },
    consultationDay: {
      type: String,
      required: true,
    },
    consultationLocation: {
      type: String,
      required: true,
    },
    reportingTime: {
      type: String,
      required: true,
    },
    // Family size covered by this single token (including the visitor).
    memberCount: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    status: {
      type: String,
      enum: Object.values(BOOKING_STATUS),
      default: BOOKING_STATUS.BOOKED,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

// Token numbers must be unique among *active* bookings for a day.
// Cancelled leave bookings can keep their old T001… numbers in history so
// a day can restart from T001 after the consultant reopens it.
bookingSchema.index(
  { bookingDate: 1, tokenNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { status: BOOKING_STATUS.BOOKED },
  }
);
bookingSchema.index({ bookingDate: 1, phone: 1 });
bookingSchema.index({ bookingDate: 1, status: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
