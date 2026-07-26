const Schedule = require('../models/Schedule');
const Settings = require('../models/Settings');
const env = require('./env');
const logger = require('../utils/logger');

const defaultSchedules = [
  {
    day: 'Tuesday',
    location: 'Jalaliya Manzil Adhur',
    morningStart: '10:00',
    morningEnd: '13:00',
    afternoonStart: '14:00',
    afternoonEnd: '16:00',
    tokenLimit: 30,
    bookingOpen: true,
    active: true,
  },
  {
    day: 'Wednesday',
    location: 'Jalaliya Manzil Adhur',
    morningStart: '10:00',
    morningEnd: '13:00',
    afternoonStart: '14:00',
    afternoonEnd: '16:00',
    tokenLimit: 25,
    bookingOpen: true,
    active: true,
  },
  {
    day: 'Saturday',
    location: 'Jalaliya Manzil Bandichal',
    morningStart: '10:00',
    morningEnd: '13:00',
    afternoonStart: '14:00',
    afternoonEnd: '16:00',
    tokenLimit: 35,
    bookingOpen: true,
    active: true,
  },
];

// Only fills in what is missing, so re-running never overwrites limits or
// locations the admin has already changed over WhatsApp.
const seed = async () => {
  for (const schedule of defaultSchedules) {
    const existing = await Schedule.findOne({ day: schedule.day });

    if (existing) {
      logger.info('Schedule already present, left unchanged', { day: schedule.day });
      continue;
    }

    await Schedule.create(schedule);
    logger.info('Schedule created', { day: schedule.day, location: schedule.location });
  }

  const settings = await Settings.findOne();

  if (settings) {
    // Kept in step with the environment so the notified number is always the
    // number that is authorised as admin.
    if (env.adminPhone && settings.adminPhone !== env.adminPhone) {
      settings.adminPhone = env.adminPhone;
      await settings.save();
      logger.info('Admin phone synced from environment', { adminPhone: env.adminPhone });
    }
  } else {
    await Settings.create({
      bookingOpen: true,
      consultantOnLeave: false,
      leaveReason: '',
      adminPhone: env.adminPhone || '',
      welcomeMessage: '',
    });
    logger.info('Settings document created');
  }
};

const runSeed = async () => {
  const { connectDB, disconnectDB } = require('./database');

  try {
    await connectDB();
    await seed();
    logger.info('Database seeded successfully');
    await disconnectDB();
    process.exit(0);
  } catch (error) {
    logger.error('Database seed failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
};

if (require.main === module) {
  runSeed();
}

module.exports = { defaultSchedules, seed };
