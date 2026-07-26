const mongoose = require('mongoose');
const { WEEKDAYS } = require('../constants');

const scheduleSchema = new mongoose.Schema(
  {
    day: {
      type: String,
      required: true,
      enum: WEEKDAYS,
      unique: true,
    },
    location: {
      type: String,
      required: true,
      trim: true,
    },
    morningStart: {
      type: String,
      required: true,
      default: '10:00',
    },
    morningEnd: {
      type: String,
      required: true,
      default: '13:00',
    },
    afternoonStart: {
      type: String,
      required: true,
      default: '14:00',
    },
    afternoonEnd: {
      type: String,
      required: true,
      default: '16:00',
    },
    tokenLimit: {
      type: Number,
      required: true,
      default: 30,
      min: 1,
    },
    bookingOpen: {
      type: Boolean,
      default: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Schedule', scheduleSchema);
