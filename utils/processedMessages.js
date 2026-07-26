// Remembers recently handled WhatsApp message ids. Meta retries webhook
// deliveries, and replaying a message would create a second booking.
const MAX_ENTRIES = 1000;

const seen = new Map();

const prune = () => {
  while (seen.size > MAX_ENTRIES) {
    const oldestKey = seen.keys().next().value;
    seen.delete(oldestKey);
  }
};

const isDuplicate = (messageId) => {
  if (!messageId) return false;
  return seen.has(messageId);
};

const remember = (messageId) => {
  if (!messageId) return;
  seen.set(messageId, Date.now());
  prune();
};

const clear = () => seen.clear();

module.exports = { isDuplicate, remember, clear };
