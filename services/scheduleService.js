const Schedule = require('../models/Schedule');
const { getTodayDayName } = require('../helpers/timeHelper');
const { capitalizeDay } = require('../helpers/validationHelper');

const getScheduleByDay = async (day) =>
  Schedule.findOne({ day: capitalizeDay(day), active: true });

const getTodaySchedule = async (date = new Date()) =>
  getScheduleByDay(getTodayDayName(date));

// A day is a consultation day only while an active schedule exists for it.
// This keeps the rule in one place and lets new days be added without a
// code change.
const isConsultationDay = async (date = new Date()) =>
  Boolean(await getTodaySchedule(date));

const getAllSchedules = async () => Schedule.find({ active: true });

const updateSchedule = async (day, updates) =>
  Schedule.findOneAndUpdate({ day: capitalizeDay(day) }, updates, {
    new: true,
    upsert: true,
    runValidators: true,
    setDefaultsOnInsert: true,
  });

const updateTokenLimitForDay = async (dayName, limit) =>
  Schedule.findOneAndUpdate(
    { day: capitalizeDay(dayName), active: true },
    { tokenLimit: limit },
    { new: true, runValidators: true }
  );

const updateTodayTokenLimit = async (limit, date = new Date()) =>
  updateTokenLimitForDay(getTodayDayName(date), limit);

module.exports = {
  getScheduleByDay,
  getTodaySchedule,
  isConsultationDay,
  getAllSchedules,
  updateSchedule,
  updateTodayTokenLimit,
  updateTokenLimitForDay,
};
