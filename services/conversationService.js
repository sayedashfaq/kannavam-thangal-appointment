const Conversation = require('../models/Conversation');
const { CONVERSATION_STEPS } = require('../constants');

// Upsert in a single round trip so two messages arriving together cannot
// race into a duplicate-key error on the unique phone index.
const getConversation = async (phone) =>
  Conversation.findOneAndUpdate(
    { phone },
    { $setOnInsert: { currentStep: CONVERSATION_STEPS.START, tempData: {} } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

const updateConversation = async (phone, updates) =>
  Conversation.findOneAndUpdate({ phone }, updates, { new: true, upsert: true });

const setStep = async (phone, step, tempData = {}) =>
  updateConversation(phone, { currentStep: step, tempData });

const mergeStep = async (phone, step, tempData = {}) => {
  const conversation = await getConversation(phone);
  return updateConversation(phone, {
    currentStep: step,
    tempData: { ...(conversation.tempData || {}), ...tempData },
  });
};

const resetConversation = async (phone) =>
  setStep(phone, CONVERSATION_STEPS.START, {});

module.exports = {
  getConversation,
  updateConversation,
  setStep,
  mergeStep,
  resetConversation,
};
