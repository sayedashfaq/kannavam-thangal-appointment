require('dotenv').config();

const PLACEHOLDER_PATTERN = /^(your_|YOUR_|<)/;

const env = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  timezone: process.env.TIMEZONE || 'Asia/Kolkata',
  mongodbUri: process.env.MONGODB_URI,
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    apiUrl: 'https://graph.facebook.com',
  },
  adminPhone: process.env.ADMIN_PHONE,
  dynamicReportingTime: process.env.DYNAMIC_REPORTING_TIME !== 'false',
};

const REQUIRED_VARS = [
  'MONGODB_URI',
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'ADMIN_PHONE',
];

const getMissingVars = () =>
  REQUIRED_VARS.filter((key) => {
    const value = process.env[key];
    return !value || PLACEHOLDER_PATTERN.test(value);
  });

module.exports = { ...env, getMissingVars };
