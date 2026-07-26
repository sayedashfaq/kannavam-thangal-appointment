const mongoose = require('mongoose');

// Monotonic sequence per key (one key per consultation day) used to hand out
// token numbers atomically. Numbers are never reused, so cancelling a booking
// cannot cause a duplicate token later in the day.
const counterSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    seq: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Counter', counterSchema);
