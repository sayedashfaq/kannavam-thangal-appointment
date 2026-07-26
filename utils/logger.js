const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const fileOptions = {
  maxsize: 5 * 1024 * 1024,
  maxFiles: 5,
  tailable: true,
};

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'appointment-system' },
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      ...fileOptions,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      ...fileOptions,
    }),
  ],
  exitOnError: false,
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const details = Object.keys(meta).filter((key) => key !== 'service');
          const suffix = details.length
            ? ` ${JSON.stringify(Object.fromEntries(details.map((k) => [k, meta[k]])))}`
            : '';
          return `${timestamp} ${level}: ${message}${suffix}`;
        })
      ),
    })
  );
}

module.exports = logger;
