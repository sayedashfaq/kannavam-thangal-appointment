const mongoose = require('mongoose');

// One document per consultation calendar date that is on leave.
const dayLeaveSchema = new mongoose.Schema(
  {
    leaveDate: {
      type: Date,
      required: true,
      unique: true,
    },
    dayName: {
      type: String,
      required: true,
    },
    reason: {
      type: String,
      default: '',
      trim: true,
    },
    notifiedCount: {
      type: Number,
      default: 0,
    },
    cancelledCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('DayLeave', dayLeaveSchema);
