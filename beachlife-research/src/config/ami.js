// Anna Maria Island geography and jurisdiction rules.
//
// AMI is a 7-mile barrier island in Manatee County split across three
// municipalities plus a sliver of unincorporated county. Each has its own
// short-term rental ordinance and minimum-stay rules, which is why
// jurisdiction is carried on every parcel rather than inferred from ZIP.

export const ISLAND_BBOX = {
  // Generous bounding box covering Anna Maria Island end to end.
  minLat: 27.4560,
  maxLat: 27.5460,
  minLon: -82.7430,
  maxLon: -82.6790,
};

export const JURISDICTIONS = {
  anna_maria: {
    label: 'City of Anna Maria',
    // Northern third of the island.
    latRange: [27.5200, 27.5460],
    minStayNights: 7,
    registrationRequired: true,
    notes: 'Annual vacation-rental registration and inspection required.',
  },
  holmes_beach: {
    label: 'City of Holmes Beach',
    latRange: [27.4930, 27.5200],
    minStayNights: 7, // varies by zoning district; some require 30
    registrationRequired: true,
    notes: 'Vacation rental certificate valid 2 years; minimum stay varies by zoning district.',
  },
  bradenton_beach: {
    label: 'City of Bradenton Beach',
    latRange: [27.4560, 27.4930],
    minStayNights: 1,
    registrationRequired: true,
    notes: 'Nightly rentals permitted; DBPR license plus city ID label required.',
  },
};

export const ISLAND_ZIPS = ['34216', '34217'];

export const ISLAND_CITY_NAMES = [
  'anna maria',
  'holmes beach',
  'bradenton beach',
];

/** Classify a coordinate into an island jurisdiction, or null if off-island. */
export function jurisdictionFor(lat, lon) {
  if (lat == null || lon == null) return null;
  const { minLat, maxLat, minLon, maxLon } = ISLAND_BBOX;
  if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) return null;
  for (const [key, j] of Object.entries(JURISDICTIONS)) {
    const [lo, hi] = j.latRange;
    if (lat >= lo && lat < hi) return key;
  }
  return 'unincorporated';
}

/** True if a mailing address is outside Manatee County (absentee owner). */
export function isAbsentee({ city, state, zip }) {
  if (!state) return null;
  if (state.trim().toUpperCase() !== 'FL') return true;
  const localZips = new Set([
    ...ISLAND_ZIPS,
    '34201','34202','34203','34205','34207','34208','34209','34210','34211',
    '34212','34215','34219','34221','34222','34228','34243','34250','34251',
  ]);
  if (zip && localZips.has(String(zip).slice(0, 5))) return false;
  if (city && /bradenton|palmetto|parrish|ellenton|myakka|anna maria|holmes beach/i.test(city)) {
    return false;
  }
  return true;
}

// DOR use codes that can plausibly be a short-term rental.
export const RENTABLE_USE_CODES = new Set([
  '0100', // single family
  '0200', // mobile home
  '0400', // condominium
  '0800', // multi-family < 10 units
  '0801', // duplex
  '0802', // triplex
  '0803', // quadplex
]);

export const USE_CODE_TO_TYPE = {
  '0100': 'single_family',
  '0200': 'mobile_home',
  '0400': 'condo',
  '0800': 'multi_family',
  '0801': 'duplex',
  '0802': 'triplex',
  '0803': 'quadplex',
};
