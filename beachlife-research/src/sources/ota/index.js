// OTA data adapters.
//
// Everything downstream of this module speaks one shape, so swapping the data
// supplier is a config change rather than a rewrite. That matters because the
// supplier question is genuinely open: see docs/DATA_SOURCES.md for what each
// vendor can and cannot give you.
//
// The adapter contract:
//   fetchListings({ since }) -> AsyncIterable<NormalizedListing>
//   fetchReviews(listingRef) -> Promise<NormalizedReview[]>
//   fetchBenchmarks(opts)    -> Promise<Benchmark[]>   (optional)
//
// An adapter that cannot serve one of these throws a CapabilityError naming
// what it can do instead. Silence would be worse — a pipeline that quietly
// returns zero rows looks identical to a market with no listings.

export class CapabilityError extends Error {
  constructor(adapter, capability, explanation) {
    super(`${adapter} cannot provide ${capability}. ${explanation}`);
    this.name = 'CapabilityError';
    this.adapter = adapter;
    this.capability = capability;
  }
}

/**
 * @typedef {object} NormalizedListing
 * @property {'airbnb'|'vrbo'|'pm_site'} platform
 * @property {string} platform_listing_id
 * @property {string} [url]
 * @property {string} [title]
 * @property {number} [approx_latitude]
 * @property {number} [approx_longitude]
 * @property {number} [approx_radius_m]  metres of deliberate pin obfuscation
 * @property {number} [bedrooms]
 * @property {number} [bathrooms]
 * @property {number} [sleeps]
 * @property {string} [property_type]
 * @property {boolean} [has_pool]
 * @property {string[]} [amenities]
 * @property {string} [host_name]
 * @property {number} [review_count]
 * @property {number} [rating]
 * @property {string} [first_seen]
 * @property {string} [last_seen]
 */

const ADAPTERS = {
  none: () => import('./none.js'),
  csv: () => import('./csv.js'),
  airdna: () => import('./airdna.js'),
  keydata: () => import('./keydata.js'),
};

export async function getAdapter(name = process.env.OTA_ADAPTER ?? 'none') {
  const loader = ADAPTERS[name];
  if (!loader) {
    throw new Error(
      `Unknown OTA_ADAPTER "${name}". Available: ${Object.keys(ADAPTERS).join(', ')}`,
    );
  }
  const mod = await loader();
  return mod.default ?? mod;
}
