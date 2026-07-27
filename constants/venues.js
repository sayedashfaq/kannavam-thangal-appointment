// The consultant uses only these two venues. Admin short commands map here.
const VENUES = {
  adhur: {
    key: 'adhur',
    aliases: ['adhur', 'athur', 'adur'],
    name: 'Jalaliya Manzil Adhur',
    mapsUrl: 'https://maps.app.goo.gl/U4HBFKQiYLked5xn9',
  },
  bandichal: {
    key: 'bandichal',
    aliases: ['bandichal', 'bendichal'],
    name: 'Jalaliya Manzil Bandichal',
    // Replace when you have the exact pin for Bandichal.
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Jalaliya+Manzil+Bandichal',
  },
};

const normalizeVenueKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');

const resolveVenue = (value) => {
  const key = normalizeVenueKey(value);
  if (!key) return null;

  return (
    Object.values(VENUES).find(
      (venue) => venue.key === key || venue.aliases.includes(key)
    ) || null
  );
};

const getVenueByLocationName = (locationName) => {
  const normalized = String(locationName || '').toLowerCase();
  if (normalized.includes('bandichal') || normalized.includes('bendichal')) {
    return VENUES.bandichal;
  }
  if (normalized.includes('adhur') || normalized.includes('athur')) {
    return VENUES.adhur;
  }
  return null;
};

const listVenuesHelp = () =>
  Object.values(VENUES)
    .map((venue) => `• \`${venue.key}\` — ${venue.name}`)
    .join('\n');

module.exports = {
  VENUES,
  resolveVenue,
  getVenueByLocationName,
  listVenuesHelp,
};
