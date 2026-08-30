// CSV adapter — manual import.
//
// The escape hatch for two situations: evaluating the pipeline before buying a
// data subscription, and importing an export a vendor gives you as files rather
// than an API. Column contract is in docs/DATA_SOURCES.md.

import { readFile } from 'node:fs/promises';
import { log } from '../../lib/log.js';

export const name = 'csv';

/** RFC 4180 parser — handles quoted fields, embedded commas, and doubled quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const num = (v) => (v === '' || v == null ? null : Number(v));
const bool = (v) => (v === '' || v == null ? null : /^(1|true|yes|y)$/i.test(v));

export async function* fetchListings({ path = process.env.CSV_LISTINGS_PATH } = {}) {
  if (!path) throw new Error('CSV_LISTINGS_PATH is not set');
  const rows = parseCsv(await readFile(path, 'utf8'));
  log.info('loaded listings CSV', { path, rows: rows.length });

  for (const r of rows) {
    yield {
      platform: (r.platform || 'airbnb').toLowerCase(),
      platform_listing_id: r.platform_listing_id || r.listing_id,
      url: r.url || null,
      title: r.title || null,
      headline_location: r.headline_location || null,
      approx_latitude: num(r.latitude),
      approx_longitude: num(r.longitude),
      approx_radius_m: num(r.approx_radius_m) ?? 250,
      bedrooms: num(r.bedrooms),
      bathrooms: num(r.bathrooms),
      sleeps: num(r.sleeps),
      property_type: r.property_type || null,
      has_pool: bool(r.has_pool),
      amenities: r.amenities ? r.amenities.split('|').map((a) => a.trim()) : [],
      host_name: r.host_name || null,
      review_count: num(r.review_count),
      rating: num(r.rating),
      first_seen: r.first_seen || null,
      last_seen: r.last_seen || null,
      photo_urls: r.photo_urls ? r.photo_urls.split('|') : [],
    };
  }
}

export async function fetchReviews(platformListingId, { path = process.env.CSV_REVIEWS_PATH } = {}) {
  if (!path) throw new Error('CSV_REVIEWS_PATH is not set');
  const rows = parseCsv(await readFile(path, 'utf8'));
  return rows
    .filter((r) => (r.platform_listing_id || r.listing_id) === String(platformListingId))
    .map((r) => ({
      platform_review_id: r.platform_review_id || r.review_id,
      reviewed_at: r.reviewed_at || null,
      rating: num(r.rating),
      body: r.body || '',
      reviewer_name: r.reviewer_name || null,
      has_host_response: bool(r.has_host_response),
      host_response_at: r.host_response_at || null,
    }))
    .filter((r) => r.body.trim().length > 0);
}

export default { name, fetchListings, fetchReviews, parseCsv };
