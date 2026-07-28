const normalizePhone = (phone) => String(phone || '').replace(/[^\d]/g, '');

// Reduces any accepted format to the bare 10-digit subscriber number so that
// the same visitor is recognised whether they type 9876543210, 09876543210,
// +91 98765 43210 or 919876543210.
const toLocalNumber = (phone) => {
  const cleaned = normalizePhone(phone);

  if (cleaned.length === 10) return cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('0')) return cleaned.slice(1);
  if (cleaned.length === 12 && cleaned.startsWith('91')) return cleaned.slice(2);
  if (cleaned.length === 13 && cleaned.startsWith('091')) return cleaned.slice(3);

  return cleaned;
};

const validatePhone = (phone) => {
  const local = toLocalNumber(phone);
  const valid = /^[6-9]\d{9}$/.test(local);
  return { valid, phone: local };
};

const formatPhoneForWhatsApp = (phone) => {
  const cleaned = normalizePhone(phone);
  if (cleaned.length === 10) return `91${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith('0')) return `91${cleaned.slice(1)}`;
  return cleaned;
};

const phonesMatch = (phone1, phone2) => {
  const a = toLocalNumber(phone1);
  const b = toLocalNumber(phone2);
  return Boolean(a) && a === b;
};

/**
 * Builds every common storage/search form for a phone so bookings saved as
 * 9876543210, 919876543210 or 09876543210 are all found from WhatsApp `from`.
 */
const phoneLookupCandidates = (...phones) => {
  const candidates = new Set();

  for (const phone of phones) {
    const cleaned = normalizePhone(phone);
    const local = toLocalNumber(phone);
    if (cleaned) candidates.add(cleaned);
    if (local) {
      candidates.add(local);
      if (local.length === 10) {
        candidates.add(`91${local}`);
        candidates.add(`0${local}`);
      }
    }
  }

  return [...candidates];
};

module.exports = {
  normalizePhone,
  toLocalNumber,
  validatePhone,
  formatPhoneForWhatsApp,
  phonesMatch,
  phoneLookupCandidates,
};
