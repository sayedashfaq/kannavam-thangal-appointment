const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    bookingOpen: {
      type: Boolean,
      default: true,
    },
    consultantOnLeave: {
      type: Boolean,
      default: false,
    },
    leaveReason: {
      type: String,
      default: '',
    },
    adminPhone: {
      type: String,
      default: '',
    },
    welcomeMessage: {
      type: String,
      default: '',
    },
    lastWebhookVerify: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Settings', settingsSchema);
