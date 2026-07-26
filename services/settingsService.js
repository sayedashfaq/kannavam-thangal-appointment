const Settings = require('../models/Settings');
const env = require('../config/env');

const CACHE_TTL_MS = 30000;

let cached = null;
let cacheExpiry = 0;

const invalidateCache = () => {
  cached = null;
  cacheExpiry = 0;
};

const getSettings = async () => {
  if (cached && Date.now() < cacheExpiry) {
    return cached;
  }

  let settings = await Settings.findOne();

  if (!settings) {
    settings = await Settings.create({ adminPhone: env.adminPhone || '' });
  }

  cached = settings;
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return settings;
};

const updateSettings = async (updates) => {
  const settings = await getSettings();
  Object.assign(settings, updates);
  await settings.save();
  invalidateCache();
  return settings;
};

// The environment is the source of truth, because the same value decides who
// is authorised as admin. A stored number is only used when none is set.
const getAdminPhone = async () => {
  if (env.adminPhone) return env.adminPhone;

  const settings = await getSettings();
  return settings.adminPhone || '';
};

module.exports = {
  getSettings,
  updateSettings,
  invalidateCache,
  getAdminPhone,
};
