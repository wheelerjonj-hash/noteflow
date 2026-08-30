// Individual match signals, each expressed as a LIKELIHOOD RATIO.
//
// A signal returns `lr`: how many times more likely this evidence is if the
// candidate parcel IS the listing, versus if it is not. lr > 1 supports the
// match, lr < 1 argues against it, lr === 1 is uninformative. Ratios compose
// by multiplication (addition in log space), which is what resolve.js does.
//
// Expressing signals this way rather than as ad-hoc weights matters because it
// makes "50 identical condos in one building" come out correctly on its own:
// a signal every candidate shares carries lr ≈ 1 and moves nothing.

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Airbnb and VRBO publish a pin offset from the true location by up to a few
 * hundred metres. Within that radius the pin says almost nothing about WHICH
 * parcel it is — so the signal saturates rather than rewarding the parcel that
 * happens to sit closest to a deliberately randomised point.
 */
export function geoSignal(distanceM, radiusM = 250) {
  if (distanceM == null || !Number.isFinite(distanceM)) return { lr: 1, note: 'no geo' };
  const r = Math.max(radiusM, 50);
  if (distanceM <= r) return { lr: 1.6, note: `within ${Math.round(r)}m pin radius` };
  // Beyond the obfuscation radius, confidence decays fast.
  const excess = (distanceM - r) / r;
  const lr = 1.6 * Math.exp(-1.8 * excess);
  return { lr: Math.max(lr, 0.02), note: `${Math.round(distanceM)}m from pin` };
}

/**
 * Bedroom counts agree far more often than they collide by chance, but the AMI
 * distribution is concentrated on 2–4BR, so a match is worth less than it looks.
 */
export function bedroomSignal(listingBeds, parcelBeds) {
  if (listingBeds == null || parcelBeds == null) return { lr: 1, note: 'no bedroom data' };
  const diff = Math.abs(Number(listingBeds) - Number(parcelBeds));
  if (diff === 0) return { lr: 2.4, note: 'bedrooms match' };
  if (diff <= 1) return { lr: 0.8, note: 'bedrooms off by one' };
  return { lr: 0.15, note: `bedrooms differ by ${diff}` };
}

export function bathroomSignal(listingBaths, parcelBaths) {
  if (listingBaths == null || parcelBaths == null) return { lr: 1, note: 'no bathroom data' };
  const diff = Math.abs(Number(listingBaths) - Number(parcelBaths));
  if (diff < 0.6) return { lr: 1.7, note: 'bathrooms match' };
  if (diff <= 1) return { lr: 0.9, note: 'bathrooms close' };
  return { lr: 0.3, note: `bathrooms differ by ${diff}` };
}

/**
 * Pool presence is the single best cheap discriminator on the island: roughly
 * a third of AMI rentals have one, and the appraiser records it independently.
 */
export function poolSignal(listingPool, parcelPool) {
  if (listingPool == null || parcelPool == null) return { lr: 1, note: 'no pool data' };
  if (listingPool === parcelPool) {
    return { lr: listingPool ? 2.8 : 1.4, note: `pool: both ${listingPool}` };
  }
  // A listing advertising a private pool on a parcel with none is near-fatal.
  return { lr: listingPool ? 0.08 : 0.4, note: 'pool mismatch' };
}

export function propertyTypeSignal(listingType, parcelType) {
  if (!listingType || !parcelType) return { lr: 1, note: 'no type data' };
  if (listingType === parcelType) return { lr: 1.9, note: 'property type matches' };
  const compatible =
    (listingType === 'condo' && parcelType === 'multi_family') ||
    (listingType === 'single_family' && parcelType === 'duplex');
  return compatible
    ? { lr: 1, note: 'property type compatible' }
    : { lr: 0.2, note: `type mismatch (${listingType} vs ${parcelType})` };
}

/**
 * A DBPR vacation-rental licence recorded at this parcel, held by the same
 * company the listing is attributed to. This is the strongest signal available
 * and it is pure public record — no scraping, no inference from pictures.
 */
export function dbprSignal({ licenceAtParcel, licenseeMatchesListingPm }) {
  if (!licenceAtParcel) return { lr: 1, note: 'no DBPR licence at parcel' };
  if (licenseeMatchesListingPm) {
    return { lr: 12, note: 'DBPR licence at parcel held by listing PM company' };
  }
  return { lr: 2.2, note: 'DBPR vacation-rental licence at parcel' };
}

/**
 * A perceptual-hash collision between this listing's photos and a photo of
 * KNOWN address provenance — typically the PM company's own site, where the
 * unit name resolves to an address. This is the honest version of "visual
 * recognition": it matches picture-to-picture, not picture-to-house.
 */
export function photoSignal({ matchedPhotos = 0, minHammingDistance = null } = {}) {
  if (!matchedPhotos) return { lr: 1, note: 'no photo overlap' };
  // Near-identical hashes across several images are hard to produce by accident.
  const tight = minHammingDistance != null && minHammingDistance <= 4;
  if (matchedPhotos >= 3 && tight) return { lr: 25, note: `${matchedPhotos} near-identical photos` };
  if (matchedPhotos >= 1 && tight) return { lr: 8, note: `${matchedPhotos} near-identical photo(s)` };
  return { lr: 2, note: `${matchedPhotos} loosely similar photo(s)` };
}

/**
 * The listing title matches a unit name the PM company publishes against a
 * known address (e.g. "Dock of the Bay"). Vacation-rental unit names are
 * distinctive enough that an exact hit is strong.
 */
export function unitNameSignal({ exact = false, fuzzyScore = 0 } = {}) {
  if (exact) return { lr: 15, note: 'exact unit-name match' };
  if (fuzzyScore >= 0.85) return { lr: 4, note: 'close unit-name match' };
  if (fuzzyScore >= 0.7) return { lr: 1.6, note: 'partial unit-name match' };
  return { lr: 1, note: 'no unit-name match' };
}

/** Living area vs advertised sleeps — weak, included only to break near-ties. */
export function sizeSignal(sleeps, sqft) {
  if (!sleeps || !sqft) return { lr: 1, note: 'no size data' };
  const perGuest = sqft / sleeps;
  if (perGuest < 80) return { lr: 0.6, note: 'implausibly small for advertised sleeps' };
  if (perGuest > 700) return { lr: 0.8, note: 'unusually large for advertised sleeps' };
  return { lr: 1.15, note: 'size plausible for advertised sleeps' };
}
