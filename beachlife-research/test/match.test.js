import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveListing, candidateFilter, scoreCandidate } from '../src/match/resolve.js';
import { haversine, poolSignal, geoSignal, bedroomSignal } from '../src/match/signals.js';

const HOLMES_BEACH = { lat: 27.5085, lon: -82.7115 };

function parcel(id, over = {}) {
  return {
    parcel_id: id,
    latitude: HOLMES_BEACH.lat,
    longitude: HOLMES_BEACH.lon,
    bedrooms: 3, bathrooms: 2, has_pool: true,
    property_type: 'single_family', living_area_sqft: 1600,
    homestead_exempt: false,
    ...over,
  };
}

const listing = {
  approx_latitude: HOLMES_BEACH.lat, approx_longitude: HOLMES_BEACH.lon,
  approx_radius_m: 250, bedrooms: 3, bathrooms: 2, sleeps: 6,
  has_pool: true, property_type: 'single_family',
};

test('haversine returns a sane distance', () => {
  const d = haversine(27.5085, -82.7115, 27.5185, -82.7115);
  assert.ok(d > 1050 && d < 1180, `expected ~1.1km, got ${d}`);
});

test('geo signal saturates inside the obfuscation radius', () => {
  // A parcel 10m from the pin is not better evidence than one 200m away,
  // because the pin itself is randomised.
  assert.equal(geoSignal(10, 250).lr, geoSignal(200, 250).lr);
  assert.ok(geoSignal(900, 250).lr < geoSignal(200, 250).lr);
});

test('pool mismatch is close to fatal', () => {
  assert.ok(poolSignal(true, false).lr < 0.1);
  assert.ok(poolSignal(true, true).lr > 2);
});

test('bedroom mismatch of two or more argues against a match', () => {
  assert.ok(bedroomSignal(3, 5).lr < 0.2);
});

test('a lone plausible candidate with a hard signal auto-confirms', () => {
  const result = resolveListing(listing, [parcel('A')], () => ({
    dbpr: { licenceAtParcel: true, licenseeMatchesListingPm: true },
    photo: { matchedPhotos: 4, minHammingDistance: 2 },
  }));
  assert.equal(result.decision, 'auto_confirm');
  assert.ok(result.candidates[0].hardSignals.includes('dbpr'));
});

test('geometry alone never auto-confirms, however well it fits', () => {
  // Perfect beds, baths, pool, type and a dead-centre pin — but nothing that
  // actually ties the listing to an address. This must go to a human.
  const result = resolveListing(listing, [parcel('A')], () => ({}));
  assert.notEqual(result.decision, 'auto_confirm');
  assert.match(result.reason, /no address-bearing signal/);
});

test('identical units in one building do not produce a confident match', () => {
  // Twelve indistinguishable condos: same building, same layout, same pin.
  const units = Array.from({ length: 12 }, (_, i) =>
    parcel(`UNIT-${i}`, { property_type: 'condo', has_pool: true }),
  );
  const condoListing = { ...listing, property_type: 'condo' };
  const result = resolveListing(condoListing, units, () => ({
    dbpr: { licenceAtParcel: true, licenseeMatchesListingPm: true },
  }));

  assert.notEqual(result.decision, 'auto_confirm');
  assert.match(result.reason, /indistinguishable|below auto-confirm/);
  // The margin between the top two is what makes it unresolvable.
  assert.ok(result.candidates[0].margin < 0.25);
});

test('the prior shrinks as the candidate set grows', () => {
  const ctx = { dbpr: { licenceAtParcel: true, licenseeMatchesListingPm: false } };
  const few = scoreCandidate(listing, parcel('A'), ctx, 1 / 3);
  const many = scoreCandidate(listing, parcel('A'), ctx, 1 / 200);
  assert.ok(many.score < few.score);
});

test('candidateFilter drops homesteaded and far-away parcels', () => {
  const parcels = [
    parcel('KEEP'),
    parcel('HOMESTEAD', { homestead_exempt: true }),
    parcel('FAR', { latitude: 27.6500 }),
    parcel('WRONG-SIZE', { bedrooms: 8 }),
  ];
  const kept = candidateFilter(listing, parcels).map((p) => p.parcel_id);
  assert.deepEqual(kept, ['KEEP']);
});

test('no candidates yields no_match rather than throwing', () => {
  const result = resolveListing(listing, []);
  assert.equal(result.decision, 'no_match');
});
