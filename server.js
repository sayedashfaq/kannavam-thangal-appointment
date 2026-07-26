require('dotenv').config();

const express = require('express');
const env = require('./config/env');
const { connectDB, disconnectDB } = require('./config/database');
const webhookRoutes = require('./routes/webhookRoutes');
const errorHandler = require('./middlewares/errorHandler');
const logger = require('./utils/logger');

const app = express();

app.disable('x-powered-by');

// The raw body is retained so the Meta webhook signature can be verified.
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buffer) => {
      req.rawBody = buffer;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

app.use('/', webhookRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

app.use(errorHandler);

const startServer = async () => {
  const missing = env.getMissingVars();
  if (missing.length > 0) {
    logger.error('Missing required environment variables', { missing });
    process.exit(1);
  }

  await connectDB();

  const server = app.listen(env.port, () => {
    logger.info(`Server running on port ${env.port}`, {
      environment: env.nodeEnv,
      timezone: env.timezone,
    });
  });

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down`);
    server.close(async () => {
      try {
        await disconnectDB();
      } finally {
        process.exit(0);
      }
    });

    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  });

  return server;
};

if (require.main === module) {
  startServer().catch((error) => {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = { app, startServer };
