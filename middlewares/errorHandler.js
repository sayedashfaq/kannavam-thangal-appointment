const env = require('../config/env');
const logger = require('../utils/logger');

const errorHandler = (err, req, res, _next) => {
  logger.error('Unhandled request error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const status = err.status || 500;

  res.status(status).json({
    success: false,
    message: env.nodeEnv === 'production' ? 'Internal server error' : err.message,
  });
};

module.exports = errorHandler;
