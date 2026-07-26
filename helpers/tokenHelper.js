const generateTokenNumber = (sequenceNumber) =>
  `T${String(sequenceNumber).padStart(3, '0')}`;

const parseTokenNumber = (token) => {
  const match = String(token || '').trim().match(/^T(\d+)$/i);
  return match ? parseInt(match[1], 10) : null;
};

const isValidTokenFormat = (token) => /^T\d{1,6}$/i.test(String(token || '').trim());

// Accepts "5", "T5" or "t005" and returns the canonical "T005".
const normalizeToken = (token) => {
  const raw = String(token || '').trim();
  const numeric = /^\d+$/.test(raw) ? Number(raw) : parseTokenNumber(raw);
  return numeric === null ? null : generateTokenNumber(numeric);
};

module.exports = {
  generateTokenNumber,
  parseTokenNumber,
  isValidTokenFormat,
  normalizeToken,
};
