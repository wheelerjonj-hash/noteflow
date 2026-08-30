// Prospect exports.
//
// The gate lives here, in code, rather than in a policy document someone reads
// once. Two rules are enforced unconditionally:
//
//   1. Only CONFIRMED listing→parcel matches are exported. An unreviewed
//      candidate never reaches a mail merge, because a mailer sent to the wrong
//      house is worse than no mailer.
//   2. Phone numbers are omitted unless they have been DNC-scrubbed and are not
//      flagged. Direct mail to a public-record mailing address carries none of
//      the telemarketing exposure that a call does — see docs/COMPLIANCE.md.

import { query } from '../lib/db.js';
import { log } from '../lib/log.js';

const MAIL_COLUMNS = [
  'parcel_id', 'situs_address', 'situs_unit', 'situs_city', 'situs_zip',
  'bedrooms', 'bathrooms', 'living_area_sqft', 'year_built',
  'owner_name', 'owner_mail_line1', 'owner_mail_city', 'owner_mail_state', 'owner_mail_zip',
  'pm_company', 'prospect_score', 'mgmt_issue_rate_12mo', 'issue_rate_delta',
  'reviews_12mo', 'match_confidence', 'listing_url',
];

export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    columns.join(','),
    ...rows.map((r) => columns.map((c) => esc(r[c])).join(',')),
  ].join('\n') + '\n';
}

/**
 * Direct-mail prospect list, highest score first.
 * Uses only the appraiser's public-record owner mailing address.
 */
export async function exportMailList({ limit = 500, minScore = 0.25, pmCompany = null } = {}) {
  const params = [minScore, limit];
  let filter = '';
  if (pmCompany) { params.push(pmCompany); filter = `AND pm_company = $${params.length}`; }

  const { rows } = await query(
    `SELECT ${MAIL_COLUMNS.join(', ')}
       FROM v_prospect
      WHERE prospect_score >= $1
        AND owner_mail_line1 IS NOT NULL
        ${filter}
      ORDER BY prospect_score DESC
      LIMIT $2`,
    params,
  );

  log.info('exported mail prospect list', { rows: rows.length, minScore, pmCompany });
  return toCsv(rows, MAIL_COLUMNS);
}

/**
 * Phone list. Returns only numbers with a recorded DNC scrub that came back
 * clean and are not marked do-not-contact. Callers get a refusal, not a
 * silently short list, when nothing qualifies.
 */
export async function exportPhoneList({ limit = 200, minScore = 0.35 } = {}) {
  const { rows } = await query(
    `SELECT p.parcel_id, p.situs_address, p.owner_name, p.pm_company,
            p.prospect_score, oc.value AS phone, oc.provenance, oc.dnc_scrubbed_at
       FROM v_prospect p
       JOIN owner_contact oc ON oc.parcel_id = p.parcel_id
      WHERE oc.contact_type = 'phone'
        AND oc.dnc_scrubbed_at IS NOT NULL
        AND oc.dnc_listed IS NOT TRUE
        AND oc.do_not_contact IS NOT TRUE
        AND p.prospect_score >= $1
      ORDER BY p.prospect_score DESC
      LIMIT $2`,
    [minScore, limit],
  );

  if (!rows.length) {
    const { rows: [{ count }] } = await query(
      `SELECT count(*)::int AS count FROM owner_contact
        WHERE contact_type = 'phone' AND dnc_scrubbed_at IS NULL`,
    );
    throw new Error(
      `No exportable phone numbers. ${count} phone record(s) are present but unscrubbed. ` +
      'Run a DNC scrub and record the result in owner_contact.dnc_scrubbed_at first — ' +
      'see docs/COMPLIANCE.md for why this is not optional in Florida.',
    );
  }

  log.warn('exported phone list — confirm consent basis before dialling', { rows: rows.length });
  return toCsv(rows, [
    'parcel_id', 'situs_address', 'owner_name', 'pm_company',
    'prospect_score', 'phone', 'provenance', 'dnc_scrubbed_at',
  ]);
}

/** Competitive-intelligence export: one row per management company. */
export async function exportCompanyScorecard() {
  const { rows } = await query(
    `SELECT c.name AS pm_company, s.*
       FROM company_scorecard s
       JOIN pm_company c ON c.id = s.pm_company_id
      ORDER BY s.parcels_confirmed DESC NULLS LAST`,
  );
  const columns = [
    'pm_company', 'listings_active', 'parcels_confirmed', 'market_share_pct',
    'avg_rating', 'mgmt_issue_rate_12mo', 'mgmt_issue_rate_prior', 'issue_rate_delta',
    'response_rate', 'top_issue_categories', 'computed_at',
  ];
  return toCsv(rows, columns);
}

/** Matches awaiting human review, worst ambiguity first. */
export async function exportReviewQueue({ limit = 200 } = {}) {
  const { rows } = await query(
    `SELECT l.url AS listing_url, l.title, l.bedrooms, l.bathrooms,
            m.parcel_id, p.situs_address, p.situs_city,
            m.score, m.signals
       FROM listing_parcel_match m
       JOIN listing l ON l.id = m.listing_id
       JOIN parcel p  ON p.parcel_id = m.parcel_id
      WHERE m.status = 'candidate'
      ORDER BY m.score DESC
      LIMIT $1`,
    [limit],
  );
  return toCsv(rows, [
    'listing_url', 'title', 'bedrooms', 'bathrooms',
    'parcel_id', 'situs_address', 'situs_city', 'score', 'signals',
  ]);
}
