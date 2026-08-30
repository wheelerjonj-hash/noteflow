import { CapabilityError } from './index.js';

// Explicit no-op adapter. Lets the public-records half of the pipeline run
// standalone, which is the recommended way to start: the roster and owner
// data are useful before any OTA data exists.

export const name = 'none';

export async function* fetchListings() {
  // Yields nothing, deliberately and visibly.
}

export async function fetchReviews() {
  throw new CapabilityError(
    'none',
    'reviews',
    'Set OTA_ADAPTER to a real adapter (airdna, csv) to ingest guest reviews.',
  );
}

export default { name, fetchListings, fetchReviews };
