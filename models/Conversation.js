const mongoose = require('mongoose');
const { CONVERSATION_STEPS } = require('../constants');

const conversationSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
    },
    currentStep: {
      type: String,
      enum: Object.values(CONVERSATION_STEPS),
      default: CONVERSATION_STEPS.START,
    },
    tempData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

module.exports = mongoose.model('Conversation', conversationSchema);
