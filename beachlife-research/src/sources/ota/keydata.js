// Key Data Dashboard adapter.
//
// IMPORTANT — what a Key Data subscription does and does not give you:
//
// Key Data's dataset comes from direct PMS integrations: participating property
// managers connect Streamline / Track / Escapia / Guesty / Hostaway and Key Data
// aggregates their ACTUAL booking data. That makes its market benchmarks better
// than scraped estimates — they are real reservations, not inferred occupancy.
//
// But the same architecture is why it cannot supply this project's roster:
// contributed data is aggregated and anonymised before it leaves the
// contributor's account. You see "3-bedroom Holmes Beach properties averaged
// $X ADR at Y% occupancy"; you do not see which competitor manages which
// address, and the data-sharing terms every contributor signs are what makes
// that true. Attempting to de-anonymise it would breach those terms.
//
// So Key Data is wired in here for exactly one job: the market benchmark that
// tells you whether a given property is underperforming its comp set. That is a
// genuinely strong prospecting signal — "your house earned 18% below comparable
// Holmes Beach 3BRs last season" opens a conversation — it just is not a roster.

import { CapabilityError } from './index.js';
import { log } from '../../lib/log.js';

export const name = 'keydata';

const BASE = process.env.KEYDATA_API_BASE ?? 'https://api.keydatadashboard.com';

export async function* fetchListings() {
  throw new CapabilityError(
    'keydata',
    'competitor property-level listings',
    'Key Data aggregates anonymised PMS booking data from participating managers; ' +
      'it exposes market benchmarks, not per-competitor listings or addresses. ' +
      'Use OTA_ADAPTER=airdna (or csv) for the roster and keep Key Data for benchmarks.',
  );
}

export async function fetchReviews() {
  throw new CapabilityError(
    'keydata',
    'guest reviews',
    'Key Data ingests reservation and revenue data, not OTA review text.',
  );
}

/**
 * Market benchmarks for the revenue-gap signal.
 * Segment by bedroom count and submarket so comparisons stay meaningful.
 */
export async function fetchBenchmarks({ market, bedrooms, from, to } = {}) {
  const key = process.env.KEYDATA_API_KEY;
  if (!key) throw new Error('KEYDATA_API_KEY is not set');

  const url = new URL('/v1/benchmarks', BASE);
  for (const [k, v] of Object.entries({ market, bedrooms, from, to })) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`Key Data benchmarks failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  log.info('fetched Key Data benchmarks', { market, bedrooms, rows: json?.data?.length ?? 0 });

  // Confirm this mapping against your account's API docs — Key Data's response
  // field names vary by plan, and this is the one place they are read.
  return (json.data ?? []).map((b) => ({
    market: b.market ?? market,
    bedrooms: b.bedrooms ?? bedrooms,
    period_start: b.period_start ?? from,
    period_end: b.period_end ?? to,
    adr: b.adr,
    occupancy: b.occupancy,
    revpar: b.revpar,
    sample_size: b.sample_size,
  }));
}

export default { name, fetchListings, fetchReviews, fetchBenchmarks };
