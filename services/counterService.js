const Counter = require('../models/Counter');

const getNextSequence = async (key) => {
  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return counter.seq;
};

const peekSequence = async (key) => {
  const counter = await Counter.findOne({ key });
  return counter ? counter.seq : 0;
};

const setSequence = async (key, seq) => {
  await Counter.findOneAndUpdate({ key }, { seq }, { upsert: true });
};

module.exports = {
  getNextSequence,
  peekSequence,
  setSequence,
};
