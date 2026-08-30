// AirDNA adapter — licensed Airbnb/VRBO listing and review data.
//
// AirDNA licenses OTA listing data commercially and exposes it via API, which
// is why this is the recommended supplier: it puts the listing corpus on a
// contractual footing instead of a scraper that violates Airbnb's and VRBO's
// terms of service and breaks whenever their anti-bot measures change.
//
// The endpoint paths and field names below follow AirDNA's documented v2
// shape. Verify them against the docs for YOUR plan when you provision a key —
// entitlements differ by tier, and mapAirDnaListing/mapAirDnaReview are the
// only two places any field name is read, precisely so this is a small fix.

import { log } from '../../lib/log.js';

export const name = 'airdna';

const BASE = process.env.AIRDNA_API_BASE ?? 'https://api.airdna.co/api/v2';

async function apiGet(path, params = {}) {
  const key = process.env.AIRDNA_API_KEY;
  if (!key) throw new Error('AIRDNA_API_KEY is not set');

  const url = new URL(path.replace(/^\//, ''), `${BASE}/`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(45000),
    });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt;
      log.warn('AirDNA transient error; backing off', { status: res.status, wait });
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`AirDNA ${path} failed: ${res.status} ${res.statusText}`);
  }
  throw new Error(`AirDNA ${path} failed after retries`);
}

/** AirDNA record → NormalizedListing. The single place field names are read. */
export function mapAirDnaListing(r) {
  const platform = String(r.platform ?? r.source ?? '').toLowerCase().includes('vrbo')
    ? 'vrbo'
    : 'airbnb';
  const amenities = r.amenities ?? [];
  return {
    platform,
    platform_listing_id: String(r.property_id ?? r.id),
    url: r.listing_url ?? r.url ?? null,
    title: r.title ?? r.listing_title ?? null,
    headline_location: r.location_name ?? null,
    approx_latitude: r.latitude ?? null,
    approx_longitude: r.longitude ?? null,
    // AirDNA passes through the platform's obfuscated coordinate. Treat it as
    // a ~250m circle, not a point — see src/match/signals.js.
    approx_radius_m: 250,
    bedrooms: r.bedrooms ?? null,
    bathrooms: r.bathrooms ?? null,
    sleeps: r.accommodates ?? r.max_guests ?? null,
    property_type: normalizeType(r.property_type ?? r.listing_type),
    has_pool: amenities.some((a) => /pool/i.test(a)) || r.has_pool || null,
    amenities,
    host_name: r.host_name ?? null,
    review_count: r.reviews_count ?? r.review_count ?? null,
    rating: r.rating ?? r.overall_rating ?? null,
    first_seen: r.first_seen ?? r.created_date ?? null,
    last_seen: r.last_seen ?? r.last_scraped_date ?? null,
    photo_urls: r.images ?? r.photos ?? [],
  };
}

export function mapAirDnaReview(r) {
  return {
    platform_review_id: String(r.review_id ?? r.id),
    reviewed_at: r.date ?? r.created_at ?? null,
    rating: r.rating ?? null,
    body: r.text ?? r.comments ?? '',
    reviewer_name: r.reviewer_name ?? r.author ?? null,
    has_host_response: Boolean(r.host_response ?? r.response),
    host_response_at: r.host_response_date ?? null,
  };
}

function normalizeType(t) {
  if (!t) return null;
  const s = String(t).toLowerCase();
  if (s.includes('condo') || s.includes('apartment')) return 'condo';
  if (s.includes('town')) return 'townhouse';
  if (s.includes('duplex')) return 'duplex';
  if (s.includes('house') || s.includes('home') || s.includes('villa')) return 'single_family';
  return s.replace(/\s+/g, '_');
}

/** Page through every active listing in the configured market. */
export async function* fetchListings({ pageSize = 100 } = {}) {
  const marketId = process.env.AIRDNA_MARKET_ID;
  if (!marketId) throw new Error('AIRDNA_MARKET_ID is not set');

  let page = 1;
  for (;;) {
    const json = await apiGet('/market/listings', {
      market_id: marketId,
      page,
      page_size: pageSize,
    });
    const rows = json.listings ?? json.data ?? [];
    if (!rows.length) return;
    for (const r of rows) yield mapAirDnaListing(r);
    if (rows.length < pageSize) return;
    page += 1;
  }
}

export async function fetchReviews(platformListingId, { pageSize = 100 } = {}) {
  const out = [];
  let page = 1;
  for (;;) {
    const json = await apiGet(`/listing/${platformListingId}/reviews`, {
      page,
      page_size: pageSize,
    });
    const rows = json.reviews ?? json.data ?? [];
    out.push(...rows.map(mapAirDnaReview));
    if (rows.length < pageSize) break;
    page += 1;
  }
  return out.filter((r) => r.body.trim().length > 0);
}

export default { name, fetchListings, fetchReviews, mapAirDnaListing, mapAirDnaReview };
