#!/usr/bin/env node
// Beach Life market research CLI.
//
// The pipeline is deliberately a set of independent steps rather than one
// command. Public records land first and are useful on their own; OTA data and
// matching layer on top. Run `blr <command> --help` for options.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { close, query, startRun, withTx } from './lib/db.js';
import { SEED_COMPANIES } from './config/companies.js';
import { loadParcels } from './sources/manatee-pao.js';
import { loadLicenses, portfolioByCompany } from './sources/dbpr.js';
import { crawlCompany } from './sources/pm-sites.js';
import { getAdapter } from './sources/ota/index.js';
import { classifyReviews, managementFindings } from './analyze/review-classifier.js';
import { resolveListing, candidateFilter } from './match/resolve.js';
import { prospectScore } from './analyze/scorecard.js';
import {
  exportMailList, exportPhoneList, exportCompanyScorecard, exportReviewQueue,
} from './export/prospects.js';
import { log } from './lib/log.js';

const OUT_DIR = process.env.OUT_DIR ?? './data/out';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

async function writeOut(filename, contents) {
  await mkdir(OUT_DIR, { recursive: true });
  const full = path.join(OUT_DIR, filename);
  await writeFile(full, contents);
  console.log(`wrote ${full}`);
  return full;
}

// ── seed ────────────────────────────────────────────────────────────────────
async function cmdSeedCompanies() {
  let written = 0;
  for (const c of SEED_COMPANIES) {
    await query(
      `INSERT INTO pm_company (name, aliases, website, office_address)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE
         SET aliases = EXCLUDED.aliases, website = COALESCE(EXCLUDED.website, pm_company.website)`,
      [c.name, c.aliases ?? [], c.website ?? null, c.office_address ?? null],
    );
    written++;
  }
  await query(
    `INSERT INTO pm_company (name, is_self_managed) VALUES ('(Owner managed)', true)
     ON CONFLICT (name) DO NOTHING`,
  );
  console.log(`seeded ${written} management companies`);
}

// ── ingest: parcels ─────────────────────────────────────────────────────────
async function cmdIngestParcels() {
  const run = await startRun('manatee_pao');
  let seen = 0, written = 0;
  try {
    for await (const p of loadParcels()) {
      seen++;
      await query(
        `INSERT INTO parcel (
           parcel_id, situs_address, situs_unit, situs_city, situs_zip, jurisdiction,
           latitude, longitude, use_code, property_type, bedrooms, bathrooms,
           living_area_sqft, year_built, has_pool, owner_name, owner_name_2,
           owner_mail_line1, owner_mail_line2, owner_mail_city, owner_mail_state,
           owner_mail_zip, owner_is_absentee, homestead_exempt, last_sale_date,
           last_sale_price, just_value, retrieved_at, ingest_run_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                 $20,$21,$22,$23,$24,$25,$26,$27, now(), $28)
         ON CONFLICT (parcel_id) DO UPDATE SET
           owner_name = EXCLUDED.owner_name,
           owner_mail_line1 = EXCLUDED.owner_mail_line1,
           owner_mail_city = EXCLUDED.owner_mail_city,
           owner_mail_state = EXCLUDED.owner_mail_state,
           owner_mail_zip = EXCLUDED.owner_mail_zip,
           owner_is_absentee = EXCLUDED.owner_is_absentee,
           homestead_exempt = EXCLUDED.homestead_exempt,
           last_sale_date = EXCLUDED.last_sale_date,
           just_value = EXCLUDED.just_value,
           retrieved_at = now(),
           ingest_run_id = EXCLUDED.ingest_run_id`,
        [p.parcel_id, p.situs_address, p.situs_unit, p.situs_city, p.situs_zip,
         p.jurisdiction, p.latitude, p.longitude, p.use_code, p.property_type,
         p.bedrooms, p.bathrooms, p.living_area_sqft, p.year_built, p.has_pool,
         p.owner_name, p.owner_name_2, p.owner_mail_line1, p.owner_mail_line2,
         p.owner_mail_city, p.owner_mail_state, p.owner_mail_zip, p.owner_is_absentee,
         p.homestead_exempt, p.last_sale_date, p.last_sale_price, p.just_value, run.id],
      );
      written++;
    }
    await run.finish('ok', { rowsIn: seen, rowsWritten: written });
    console.log(`ingested ${written} island parcels`);
  } catch (err) {
    await run.finish('failed', { rowsIn: seen, rowsWritten: written, note: err.message });
    throw err;
  }
}

// ── ingest: DBPR licences ───────────────────────────────────────────────────
async function cmdIngestDbpr() {
  const run = await startRun('dbpr');
  const licenses = await loadLicenses();
  let written = 0;
  for (const l of licenses) {
    await query(
      `INSERT INTO dbpr_license (license_number, licensee_name, dba_name, license_type,
                                 units, status, address_line1, city, zip,
                                 retrieved_at, ingest_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), $10)
       ON CONFLICT (license_number) DO UPDATE SET
         licensee_name = EXCLUDED.licensee_name, status = EXCLUDED.status,
         units = EXCLUDED.units, retrieved_at = now()`,
      [l.license_number, l.licensee_name, l.dba_name, l.license_type, l.units,
       l.status, l.address_line1, l.city, l.zip, run.id],
    );
    written++;
  }
  await run.finish('ok', { rowsIn: licenses.length, rowsWritten: written });

  const portfolios = portfolioByCompany(licenses);
  await writeOut('dbpr-portfolios.json', JSON.stringify(portfolios, null, 2));
  console.log(`\nLicensed vacation rentals by company (top 15):`);
  for (const p of portfolios.slice(0, 15)) {
    console.log(`  ${String(p.units).padStart(4)}  ${p.company}${p.attributed ? '' : '  (unmatched licensee)'}`);
  }
}

// ── crawl PM company inventories ────────────────────────────────────────────
async function cmdCrawlPmSites() {
  const run = await startRun('pm_site');
  const { rows: companies } = await query(
    'SELECT id, name, website, inventory_url FROM pm_company WHERE is_self_managed = false',
  );
  let total = 0;
  for (const c of companies) {
    const result = await crawlCompany(c);
    if (result.inventory_url && result.inventory_url !== c.inventory_url) {
      await query('UPDATE pm_company SET inventory_url = $2 WHERE id = $1',
        [c.id, result.inventory_url]);
    }
    for (const l of result.listings) {
      await withTx(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO listing (platform, platform_listing_id, url, title, bedrooms,
                                bathrooms, sleeps, has_pool, pm_company_id, pm_attribution,
                                last_seen, retrieved_at, ingest_run_id)
           VALUES ('pm_site',$1,$2,$3,$4,$5,$6,$7,$8,'pm_site', current_date, now(), $9)
           ON CONFLICT (platform, platform_listing_id) DO UPDATE SET
             title = EXCLUDED.title, bedrooms = EXCLUDED.bedrooms,
             bathrooms = EXCLUDED.bathrooms, last_seen = current_date,
             is_active = true, retrieved_at = now()
           RETURNING id`,
          [l.platform_listing_id, l.url, l.title, l.bedrooms, l.bathrooms,
           l.sleeps, l.has_pool, c.id, run.id],
        );
        const listingId = rows[0].id;
        for (const [i, url] of (l.photo_urls ?? []).slice(0, 20).entries()) {
          await client.query(
            `INSERT INTO listing_photo (listing_id, position, url) VALUES ($1,$2,$3)
             ON CONFLICT DO NOTHING`,
            [listingId, i, url],
          );
        }
      });
      total++;
    }
  }
  await run.finish('ok', { rowsWritten: total });
  console.log(`crawled ${companies.length} companies, ${total} listings`);
}

// ── ingest OTA listings + reviews ───────────────────────────────────────────
async function cmdIngestOta() {
  const adapter = await getAdapter();
  const run = await startRun(`ota:${adapter.name}`);
  let listings = 0, reviews = 0;

  for await (const l of adapter.fetchListings()) {
    const { rows } = await query(
      `INSERT INTO listing (platform, platform_listing_id, url, title, headline_location,
         approx_latitude, approx_longitude, approx_radius_m, bedrooms, bathrooms, sleeps,
         property_type, has_pool, amenities, host_name, review_count, rating,
         first_seen, last_seen, retrieved_at, ingest_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now(), $20)
       ON CONFLICT (platform, platform_listing_id) DO UPDATE SET
         rating = EXCLUDED.rating, review_count = EXCLUDED.review_count,
         last_seen = EXCLUDED.last_seen, is_active = true, retrieved_at = now()
       RETURNING id`,
      [l.platform, l.platform_listing_id, l.url, l.title, l.headline_location,
       l.approx_latitude, l.approx_longitude, l.approx_radius_m, l.bedrooms, l.bathrooms,
       l.sleeps, l.property_type, l.has_pool, l.amenities ?? [], l.host_name,
       l.review_count, l.rating, l.first_seen, l.last_seen, run.id],
    );
    const listingId = rows[0].id;
    listings++;

    for (const r of await adapter.fetchReviews(l.platform_listing_id)) {
      await query(
        `INSERT INTO review (listing_id, platform_review_id, reviewed_at, rating, body,
                             reviewer_name, has_host_response, host_response_at,
                             retrieved_at, ingest_run_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9)
         ON CONFLICT (listing_id, platform_review_id) DO NOTHING`,
        [listingId, r.platform_review_id, r.reviewed_at, r.rating, r.body,
         r.reviewer_name, r.has_host_response, r.host_response_at, run.id],
      );
      reviews++;
    }
  }
  await run.finish('ok', { rowsWritten: listings });
  console.log(`ingested ${listings} listings and ${reviews} reviews via ${adapter.name}`);
}

// ── classify reviews ────────────────────────────────────────────────────────
async function cmdClassify() {
  const limit = Number(arg('limit', 500));
  const { rows } = await query(
    `SELECT r.id, r.body, r.rating, r.reviewed_at
       FROM review r
      WHERE NOT EXISTS (SELECT 1 FROM review_finding f WHERE f.review_id = r.id)
      ORDER BY r.reviewed_at DESC NULLS LAST
      LIMIT $1`,
    [limit],
  );
  if (!rows.length) return console.log('no unclassified reviews');

  const results = await classifyReviews(rows);
  let findings = 0;
  for (const res of results) {
    for (const f of res.findings) {
      await query(
        `INSERT INTO review_finding (review_id, category, attribution, severity,
                                     confidence, evidence_quote, model)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (review_id, category) DO NOTHING`,
        [res.review_id, f.category, f.attribution, f.severity, f.confidence,
         f.evidence_quote, res.model],
      );
      findings++;
    }
  }
  const mgmt = results.flatMap((r) => managementFindings(r.findings)).length;
  console.log(`classified ${rows.length} reviews: ${findings} findings, ${mgmt} management-attributed`);
}

// ── match listings to parcels ───────────────────────────────────────────────
async function cmdMatch() {
  const { rows: parcels } = await query('SELECT * FROM parcel');
  const { rows: listings } = await query(
    `SELECT * FROM listing WHERE is_active
        AND NOT EXISTS (SELECT 1 FROM listing_parcel_match m
                         WHERE m.listing_id = listing.id AND m.status = 'confirmed')`,
  );
  const { rows: licenses } = await query(
    'SELECT parcel_id, licensee_name FROM dbpr_license WHERE parcel_id IS NOT NULL',
  );
  const licenceByParcel = new Map(licenses.map((l) => [l.parcel_id, l]));

  let auto = 0, queued = 0, none = 0;
  for (const listing of listings) {
    const candidates = candidateFilter(listing, parcels);
    const result = resolveListing(listing, candidates, (parcel) => ({
      dbpr: {
        licenceAtParcel: licenceByParcel.has(parcel.parcel_id),
        licenseeMatchesListingPm: false, // set once PM attribution is joined
      },
    }));

    for (const c of result.candidates) {
      const isTop = c.parcel_id === result.candidates[0].parcel_id;
      const status = result.decision === 'auto_confirm' && isTop ? 'confirmed' : 'candidate';
      await query(
        `INSERT INTO listing_parcel_match (listing_id, parcel_id, score, signals, status,
                                           decided_by, decided_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (listing_id, parcel_id) DO UPDATE SET
           score = EXCLUDED.score, signals = EXCLUDED.signals`,
        [listing.id, c.parcel_id, c.adjusted_score ?? c.score, JSON.stringify(c.signals),
         status, status === 'confirmed' ? 'auto' : null,
         status === 'confirmed' ? new Date() : null],
      );
    }
    if (result.decision === 'auto_confirm') auto++;
    else if (result.decision === 'review') queued++;
    else none++;
  }
  console.log(
    `matched ${listings.length} listings: ${auto} auto-confirmed, ` +
    `${queued} queued for review, ${none} no match.\n` +
    `Run "blr export review-queue" to work the queue — auto-confirmation requires ` +
    `an address-bearing signal, so most listings land here by design.`,
  );
}

// ── score ───────────────────────────────────────────────────────────────────
async function cmdScore() {
  const { rows } = await query(`
    WITH confirmed AS (
      SELECT m.parcel_id, l.id AS listing_id, l.pm_company_id
        FROM listing_parcel_match m
        JOIN listing l ON l.id = m.listing_id
       WHERE m.status = 'confirmed'
    ),
    windows AS (
      SELECT c.parcel_id, c.pm_company_id,
        count(*) FILTER (WHERE r.reviewed_at >= current_date - 365) AS reviews_12mo,
        count(*) FILTER (WHERE r.reviewed_at <  current_date - 365
                           AND r.reviewed_at >= current_date - 730) AS reviews_prior,
        count(*) FILTER (WHERE r.reviewed_at >= current_date - 365
                           AND r.has_host_response IS NOT TRUE) AS unanswered_12mo,
        avg(r.rating) FILTER (WHERE r.reviewed_at >= current_date - 365) AS rating_now,
        avg(r.rating) FILTER (WHERE r.reviewed_at <  current_date - 365
                                AND r.reviewed_at >= current_date - 730) AS rating_prior,
        count(f.id) FILTER (WHERE r.reviewed_at >= current_date - 365
                              AND f.attribution = 'management'
                              AND f.confidence >= 0.6 AND f.severity >= 2) AS issues_12mo,
        count(f.id) FILTER (WHERE r.reviewed_at <  current_date - 365
                              AND r.reviewed_at >= current_date - 730
                              AND f.attribution = 'management'
                              AND f.confidence >= 0.6 AND f.severity >= 2) AS issues_prior,
        avg(f.severity) FILTER (WHERE f.attribution = 'management') AS avg_severity
      FROM confirmed c
      JOIN review r ON r.listing_id = c.listing_id
      LEFT JOIN review_finding f ON f.review_id = r.id
      GROUP BY c.parcel_id, c.pm_company_id
    )
    SELECT w.*, p.owner_is_absentee FROM windows w JOIN parcel p USING (parcel_id)
  `);

  for (const r of rows) {
    const s = prospectScore({
      reviews12mo: Number(r.reviews_12mo), mgmtIssues12mo: Number(r.issues_12mo),
      reviewsPrior: Number(r.reviews_prior), mgmtIssuesPrior: Number(r.issues_prior),
      unanswered12mo: Number(r.unanswered_12mo), avgSeverity: Number(r.avg_severity ?? 0),
      ratingNow: Number(r.rating_now ?? 0), ratingPrior: Number(r.rating_prior ?? 0),
      absenteeOwner: r.owner_is_absentee === true,
    });
    await query(
      `INSERT INTO prospect_score (parcel_id, pm_company_id, score, components,
         mgmt_issue_rate_12mo, mgmt_issue_rate_prior, issue_rate_delta,
         unanswered_rate, rating_trend, reviews_12mo, computed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (parcel_id) DO UPDATE SET
         score = EXCLUDED.score, components = EXCLUDED.components,
         mgmt_issue_rate_12mo = EXCLUDED.mgmt_issue_rate_12mo,
         mgmt_issue_rate_prior = EXCLUDED.mgmt_issue_rate_prior,
         issue_rate_delta = EXCLUDED.issue_rate_delta,
         unanswered_rate = EXCLUDED.unanswered_rate, rating_trend = EXCLUDED.rating_trend,
         reviews_12mo = EXCLUDED.reviews_12mo, computed_at = now()`,
      [r.parcel_id, r.pm_company_id, s.score, JSON.stringify(s.components),
       s.mgmt_issue_rate_12mo, s.mgmt_issue_rate_prior, s.issue_rate_delta,
       s.unanswered_rate, s.rating_trend, s.reviews_12mo],
    );
  }
  console.log(`scored ${rows.length} properties`);
}

// ── export ──────────────────────────────────────────────────────────────────
async function cmdExport(what) {
  switch (what) {
    case 'mail':
      return writeOut('prospects-mail.csv', await exportMailList({
        limit: Number(arg('limit', 500)),
        minScore: Number(arg('min-score', 0.25)),
        pmCompany: arg('company'),
      }));
    case 'phone':
      return writeOut('prospects-phone.csv', await exportPhoneList({
        limit: Number(arg('limit', 200)),
      }));
    case 'companies':
      return writeOut('company-scorecard.csv', await exportCompanyScorecard());
    case 'review-queue':
      return writeOut('match-review-queue.csv', await exportReviewQueue({
        limit: Number(arg('limit', 200)),
      }));
    default:
      throw new Error(`Unknown export "${what}". Try: mail | phone | companies | review-queue`);
  }
}

const USAGE = `
blr — Beach Life Vacations market research

  seed-companies        Load the seed roster of AMI management companies
  ingest-parcels        Load Manatee County CAMA parcel + owner records
  ingest-dbpr           Load FL DBPR vacation-rental licences (address-level)
  crawl-pm-sites        Crawl management company websites for their inventory
  ingest-ota            Pull OTA listings + reviews via OTA_ADAPTER
  classify              Classify unclassified reviews for management issues
  match                 Score listing → parcel candidates
  score                 Compute prospect scores
  export <what>         mail | phone | companies | review-queue

Options: --limit N  --min-score X  --company "Name"

A sensible first run needs no OTA subscription at all:
  blr seed-companies && blr ingest-parcels && blr ingest-dbpr && blr crawl-pm-sites
`;

async function main() {
  const cmd = process.argv[2];
  try {
    switch (cmd) {
      case 'seed-companies': await cmdSeedCompanies(); break;
      case 'ingest-parcels': await cmdIngestParcels(); break;
      case 'ingest-dbpr': await cmdIngestDbpr(); break;
      case 'crawl-pm-sites': await cmdCrawlPmSites(); break;
      case 'ingest-ota': await cmdIngestOta(); break;
      case 'classify': await cmdClassify(); break;
      case 'match': await cmdMatch(); break;
      case 'score': await cmdScore(); break;
      case 'export': await cmdExport(process.argv[3]); break;
      default: console.log(USAGE); process.exitCode = cmd ? 1 : 0;
    }
  } catch (err) {
    log.error('command failed', { cmd, err: err.message });
    console.error(`\n${err.message}`);
    process.exitCode = 1;
  } finally {
    await close().catch(() => {});
  }
}

main();
