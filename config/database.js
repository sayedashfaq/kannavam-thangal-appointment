const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

const connectDB = async () => {
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
  });

  await mongoose.connect(env.mongodbUri, {
    serverSelectionTimeoutMS: 15000,
  });

  logger.info('MongoDB connected successfully');
  await ensureBookingTokenIndex();
  return mongoose.connection;
};

/**
 * Drop the old day+token unique index (which blocked reuse after leave cancel)
 * and sync the partial unique index for BOOKED rows only.
 */
const ensureBookingTokenIndex = async () => {
  try {
    const Booking = require('../models/Booking');
    const collection = Booking.collection;
    const indexes = await collection.indexes();
    const legacy = indexes.find(
      (idx) =>
        idx.name === 'bookingDate_1_tokenNumber_1' &&
        !idx.partialFilterExpression
    );

    if (legacy) {
      await collection.dropIndex('bookingDate_1_tokenNumber_1');
      logger.info('Dropped legacy bookingDate+tokenNumber unique index');
    }

    await Booking.syncIndexes();
  } catch (error) {
    logger.warn('Could not refresh booking indexes', { error: error.message });
  }
};

const disconnectDB = async () => {
  await mongoose.disconnect();
  logger.info('MongoDB connection closed');
};

module.exports = connectDB;
module.exports.connectDB = connectDB;
module.exports.disconnectDB = disconnectDB;
module.exports.ensureBookingTokenIndex = ensureBookingTokenIndex;
