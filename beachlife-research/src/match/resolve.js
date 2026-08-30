// Listing → parcel resolution.
//
// Produces a RANKED CANDIDATE LIST with an evidence trail, never a bare
// assertion that a listing is at an address. Three properties matter:
//
//   1. The prior is 1/N over the candidate set, so a signal shared by every
//      candidate in a 60-unit condo tower cannot manufacture confidence.
//   2. A top candidate is only as good as its lead over the runner-up. Two
//      indistinguishable units both score low after the margin penalty.
//   3. Auto-confirmation additionally requires a HARD signal — a DBPR licence,
//      a photo hash collision, or a unit-name hit. Bedroom counts and a map pin
//      alone never promote a match, no matter how they stack up.

import {
  haversine, geoSignal, bedroomSignal, bathroomSignal, poolSignal,
  propertyTypeSignal, dbprSignal, photoSignal, unitNameSignal, sizeSignal,
} from './signals.js';

/** Signals that constitute independent, address-bearing evidence. */
const HARD_SIGNALS = new Set(['dbpr', 'photo', 'unitName']);

export const THRESHOLDS = {
  autoConfirm: 0.92,   // combined posterior required to skip human review
  minMargin: 0.25,     // required lead over the runner-up
  reviewFloor: 0.35,   // below this a candidate is not worth a human's time
  maxCandidates: 8,
};

const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/**
 * Score one listing against one candidate parcel.
 * `context` supplies the evidence the caller has already looked up.
 */
export function scoreCandidate(listing, parcel, context = {}, priorOdds = 1 / 50) {
  const distance =
    listing.approx_latitude != null && parcel.latitude != null
      ? haversine(listing.approx_latitude, listing.approx_longitude, parcel.latitude, parcel.longitude)
      : null;

  const signals = {
    geo: geoSignal(distance, listing.approx_radius_m ?? 250),
    bedrooms: bedroomSignal(listing.bedrooms, parcel.bedrooms),
    bathrooms: bathroomSignal(listing.bathrooms, parcel.bathrooms),
    pool: poolSignal(listing.has_pool, parcel.has_pool),
    propertyType: propertyTypeSignal(listing.property_type, parcel.property_type),
    size: sizeSignal(listing.sleeps, parcel.living_area_sqft),
    dbpr: dbprSignal(context.dbpr ?? {}),
    photo: photoSignal(context.photo ?? {}),
    unitName: unitNameSignal(context.unitName ?? {}),
  };

  let logOdds = Math.log(priorOdds);
  for (const s of Object.values(signals)) logOdds += Math.log(s.lr);

  const hardSignals = Object.entries(signals)
    .filter(([name, s]) => HARD_SIGNALS.has(name) && s.lr > 1)
    .map(([name]) => name);

  return {
    parcel_id: parcel.parcel_id,
    score: sigmoid(logOdds),
    distance_m: distance == null ? null : Math.round(distance),
    hardSignals,
    signals,
  };
}

/**
 * Rank every candidate parcel for a listing and decide what happens next.
 *
 * Returns { candidates, decision } where decision is one of:
 *   'auto_confirm' — one candidate clears every bar; safe to write as confirmed
 *   'review'       — plausible candidates exist; queue for a human
 *   'no_match'     — nothing worth showing anyone
 */
export function resolveListing(listing, candidateParcels, contextFor = () => ({})) {
  if (!candidateParcels.length) {
    return { candidates: [], decision: 'no_match', reason: 'no candidate parcels in search area' };
  }

  // The prior is genuinely 1/N: before any evidence, the listing is equally
  // likely to be any parcel in the candidate set.
  const priorOdds = 1 / Math.max(candidateParcels.length, 2);

  const candidates = candidateParcels
    .map((p) => scoreCandidate(listing, p, contextFor(p), priorOdds))
    .sort((a, b) => b.score - a.score)
    .slice(0, THRESHOLDS.maxCandidates);

  const top = candidates[0];
  const runnerUp = candidates[1];
  const margin = runnerUp ? top.score - runnerUp.score : top.score;

  // Ambiguity between near-identical units is reported, not averaged away.
  const adjusted = runnerUp && margin < THRESHOLDS.minMargin
    ? top.score * (0.4 + 0.6 * (margin / THRESHOLDS.minMargin))
    : top.score;

  top.adjusted_score = adjusted;
  top.margin = margin;

  if (
    adjusted >= THRESHOLDS.autoConfirm &&
    margin >= THRESHOLDS.minMargin &&
    top.hardSignals.length > 0
  ) {
    return {
      candidates,
      decision: 'auto_confirm',
      reason: `posterior ${adjusted.toFixed(3)}, margin ${margin.toFixed(3)}, ` +
              `corroborated by ${top.hardSignals.join('+')}`,
    };
  }

  if (adjusted >= THRESHOLDS.reviewFloor) {
    const why = top.hardSignals.length === 0
      ? 'no address-bearing signal (geo/beds/pool alone cannot confirm)'
      : margin < THRESHOLDS.minMargin
        ? `top two candidates within ${margin.toFixed(3)} — likely indistinguishable units`
        : `posterior ${adjusted.toFixed(3)} below auto-confirm bar`;
    return { candidates, decision: 'review', reason: why };
  }

  return { candidates, decision: 'no_match', reason: 'no candidate above review floor' };
}

/** Parcels worth scoring for a listing: on-island, right ballpark, plausible use. */
export function candidateFilter(listing, parcels, searchRadiusM = 1200) {
  return parcels.filter((p) => {
    if (p.homestead_exempt) return false; // owner-occupied; not a rental
    if (listing.approx_latitude != null && p.latitude != null) {
      const d = haversine(
        listing.approx_latitude, listing.approx_longitude, p.latitude, p.longitude,
      );
      if (d > searchRadiusM) return false;
    }
    if (listing.bedrooms != null && p.bedrooms != null) {
      if (Math.abs(Number(listing.bedrooms) - Number(p.bedrooms)) > 2) return false;
    }
    return true;
  });
}
