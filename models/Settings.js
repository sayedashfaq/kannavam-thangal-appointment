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
    // Max people allowed under one token (family visit).
    maxMembersPerToken: {
      type: Number,
      default: 10,
      min: 1,
      max: 50,
    },
    lastWebhookVerify: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    lastWebhookPost: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Settings', settingsSchema);
