-- Beach Life Vacations — market research data model
--
-- Design principles encoded structurally rather than left to policy docs:
--
--   1. A listing is NEVER silently equated with a physical address. Matching
--      produces scored CANDIDATES in listing_parcel_match; only rows promoted
--      to 'confirmed' are eligible for export. See docs/MATCHING.md.
--   2. Every derived fact carries provenance (source, source_url, retrieved_at)
--      so any row in an export can be traced back to a public record.
--   3. Owner contact points are isolated in owner_contact with an explicit
--      permissible-use basis and DNC scrub state. Export refuses to emit a
--      phone number that has not been scrubbed. See docs/COMPLIANCE.md.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- Provenance
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE ingest_run (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL,          -- 'dbpr' | 'manatee_pao' | 'sunbiz' | 'pm_site' | 'ota:airdna'
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','ok','failed','partial')),
  rows_in       integer NOT NULL DEFAULT 0,
  rows_written  integer NOT NULL DEFAULT 0,
  note          text
);

CREATE INDEX ingest_run_source_started_idx ON ingest_run (source, started_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Physical property (Manatee County Property Appraiser)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE parcel (
  parcel_id         text PRIMARY KEY,           -- Manatee PAO parcel ID
  situs_address     text,                       -- physical street address
  situs_unit        text,
  situs_city        text,
  situs_zip         text,
  jurisdiction      text,                       -- anna_maria | holmes_beach | bradenton_beach | unincorporated
  latitude          double precision,
  longitude         double precision,

  use_code          text,                       -- DOR use code (0100 SFR, 0400 condo, ...)
  property_type     text,                       -- normalized: single_family | condo | duplex | ...
  bedrooms          numeric(4,1),
  bathrooms         numeric(4,1),
  living_area_sqft  integer,
  year_built        integer,
  has_pool          boolean,

  owner_name        text,
  owner_name_2      text,
  owner_mail_line1  text,
  owner_mail_line2  text,
  owner_mail_city   text,
  owner_mail_state  text,
  owner_mail_zip    text,
  owner_is_absentee boolean,                    -- mailing address outside Manatee County
  homestead_exempt  boolean,                    -- homesteaded => almost certainly NOT a rental

  last_sale_date    date,
  last_sale_price   numeric(14,2),
  just_value        numeric(14,2),

  source_url        text,
  retrieved_at      timestamptz,
  ingest_run_id     uuid REFERENCES ingest_run(id)
);

CREATE INDEX parcel_situs_idx    ON parcel (situs_city, situs_address);
CREATE INDEX parcel_geo_idx      ON parcel (latitude, longitude);
CREATE INDEX parcel_owner_idx    ON parcel (owner_name);
CREATE INDEX parcel_absentee_idx ON parcel (owner_is_absentee) WHERE owner_is_absentee;

-- ─────────────────────────────────────────────────────────────────────────────
-- State licensing (FL DBPR — transient public lodging)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE dbpr_license (
  license_number   text PRIMARY KEY,
  licensee_name    text,                        -- often the PM company or owner LLC
  dba_name         text,
  license_type     text,                        -- dwelling | condo | ...
  units            integer,
  status           text,
  address_line1    text,
  city             text,
  zip              text,
  parcel_id        text REFERENCES parcel(parcel_id),
  address_match_confidence real,
  source_url       text,
  retrieved_at     timestamptz,
  ingest_run_id    uuid REFERENCES ingest_run(id)
);

CREATE INDEX dbpr_licensee_idx ON dbpr_license (licensee_name);
CREATE INDEX dbpr_parcel_idx   ON dbpr_license (parcel_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Business entities (FL Division of Corporations / Sunbiz)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE business_entity (
  document_number  text PRIMARY KEY,
  entity_name      text NOT NULL,
  status           text,
  entity_type      text,
  principal_addr   text,
  mailing_addr     text,
  registered_agent text,
  officers         jsonb,                       -- [{name, title, address}]
  filed_date       date,
  source_url       text,
  retrieved_at     timestamptz
);

CREATE INDEX business_entity_name_idx ON business_entity (lower(entity_name));

-- ─────────────────────────────────────────────────────────────────────────────
-- Property management companies
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE pm_company (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL UNIQUE,
  aliases          text[] NOT NULL DEFAULT '{}',   -- name variants seen on OTAs / DBPR
  website          text,
  inventory_url    text,                           -- listing index page to crawl
  phone            text,
  office_address   text,
  document_number  text REFERENCES business_entity(document_number),
  is_self_managed  boolean NOT NULL DEFAULT false, -- sentinel row for owner-managed
  notes            text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Listings (OTA or PM company website)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE listing (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform            text NOT NULL,             -- airbnb | vrbo | pm_site
  platform_listing_id text NOT NULL,
  url                 text,

  title               text,
  headline_location   text,                      -- as displayed, e.g. "Holmes Beach, Florida"
  -- OTAs publish an obfuscated pin, not the real location. Keep the radius so
  -- the matcher can reason about it honestly instead of treating it as exact.
  approx_latitude     double precision,
  approx_longitude    double precision,
  approx_radius_m     integer,

  bedrooms            numeric(4,1),
  bathrooms           numeric(4,1),
  sleeps              integer,
  property_type       text,
  has_pool            boolean,
  amenities           text[] NOT NULL DEFAULT '{}',

  pm_company_id       uuid REFERENCES pm_company(id),
  pm_attribution      text,                      -- pm_site | host_name | listing_text | dbpr | manual
  host_name           text,

  first_seen          date,
  last_seen           date,
  is_active           boolean NOT NULL DEFAULT true,
  review_count        integer,
  rating              numeric(3,2),

  source_url          text,
  retrieved_at        timestamptz,
  ingest_run_id       uuid REFERENCES ingest_run(id),

  UNIQUE (platform, platform_listing_id)
);

CREATE INDEX listing_pm_idx     ON listing (pm_company_id);
CREATE INDEX listing_active_idx ON listing (is_active) WHERE is_active;

-- Photos are the cross-platform join key: the same property on Airbnb, VRBO and
-- the PM company's own site almost always shares source images.
CREATE TABLE listing_photo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  position      integer,
  url           text,
  phash         bit(64),                         -- perceptual hash for near-dup detection
  is_exterior   boolean,                         -- only exterior shots help geolocate
  caption       text
);

CREATE INDEX listing_photo_listing_idx ON listing_photo (listing_id);
CREATE INDEX listing_photo_phash_idx   ON listing_photo (phash);

-- ─────────────────────────────────────────────────────────────────────────────
-- Listing → parcel resolution
--
-- Deliberately many-rows-per-listing. The pipeline proposes ranked candidates
-- with an evidence trail; a human (or a very high score with independent
-- corroboration) promotes exactly one to 'confirmed'.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE listing_parcel_match (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  parcel_id     text NOT NULL REFERENCES parcel(parcel_id),
  score         real NOT NULL,                   -- 0..1 combined confidence
  signals       jsonb NOT NULL,                  -- per-signal contributions, for audit
  status        text NOT NULL DEFAULT 'candidate'
                CHECK (status IN ('candidate','confirmed','rejected')),
  decided_by    text,                            -- 'auto' | user email
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (listing_id, parcel_id)
);

CREATE INDEX lpm_listing_idx ON listing_parcel_match (listing_id, score DESC);
CREATE INDEX lpm_status_idx  ON listing_parcel_match (status);

-- At most one confirmed parcel per listing.
CREATE UNIQUE INDEX lpm_one_confirmed_per_listing
  ON listing_parcel_match (listing_id) WHERE status = 'confirmed';

-- ─────────────────────────────────────────────────────────────────────────────
-- Reviews and management-issue classification
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE review (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id         uuid NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  platform_review_id text,
  reviewed_at        date,
  rating             numeric(3,2),
  body               text NOT NULL,
  reviewer_name      text,                       -- first name only, as published
  has_host_response  boolean,
  host_response_at   date,
  retrieved_at       timestamptz,
  ingest_run_id      uuid REFERENCES ingest_run(id),

  UNIQUE (listing_id, platform_review_id)
);

CREATE INDEX review_listing_date_idx ON review (listing_id, reviewed_at DESC);

-- One row per (review, issue category). A review can raise several.
CREATE TABLE review_finding (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id      uuid NOT NULL REFERENCES review(id) ON DELETE CASCADE,
  category       text NOT NULL,
  -- Who the complaint is actually about. Only 'management' findings feed the
  -- prospect score — "the beach was crowded" is not a churn signal.
  attribution    text NOT NULL
                 CHECK (attribution IN ('management','property','location','guest','unclear')),
  severity       smallint NOT NULL CHECK (severity BETWEEN 1 AND 5),
  confidence     real NOT NULL,
  evidence_quote text,
  model          text,
  classified_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (review_id, category)
);

CREATE INDEX review_finding_cat_idx ON review_finding (category, attribution);

-- ─────────────────────────────────────────────────────────────────────────────
-- Owner contact points — gated
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE owner_contact (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id        text NOT NULL REFERENCES parcel(parcel_id),
  contact_type     text NOT NULL CHECK (contact_type IN ('mail','phone','email')),
  value            text NOT NULL,
  -- Where it came from decides what you may lawfully do with it.
  --   public_record  — appraiser mailing address, Sunbiz principal address
  --   skip_trace     — purchased from a data broker
  --   self_reported  — owner gave it to you directly
  provenance       text NOT NULL
                   CHECK (provenance IN ('public_record','skip_trace','self_reported')),
  source_url       text,
  -- Phone contact is not exportable until scrubbed. See docs/COMPLIANCE.md.
  dnc_scrubbed_at  timestamptz,
  dnc_listed       boolean,
  do_not_contact   boolean NOT NULL DEFAULT false,
  retrieved_at     timestamptz,

  UNIQUE (parcel_id, contact_type, value)
);

CREATE INDEX owner_contact_parcel_idx ON owner_contact (parcel_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Derived scores
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE prospect_score (
  parcel_id             text PRIMARY KEY REFERENCES parcel(parcel_id),
  pm_company_id         uuid REFERENCES pm_company(id),
  score                 real NOT NULL,
  components            jsonb NOT NULL,          -- each weighted term, for explainability
  mgmt_issue_rate_12mo  real,
  mgmt_issue_rate_prior real,
  issue_rate_delta      real,
  unanswered_rate       real,
  rating_trend          real,
  reviews_12mo          integer,
  computed_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX prospect_score_rank_idx ON prospect_score (score DESC);

CREATE TABLE company_scorecard (
  pm_company_id         uuid PRIMARY KEY REFERENCES pm_company(id),
  listings_active       integer,
  parcels_confirmed     integer,
  market_share_pct      real,
  avg_rating            numeric(3,2),
  mgmt_issue_rate_12mo  real,
  mgmt_issue_rate_prior real,
  issue_rate_delta      real,
  response_rate         real,
  top_issue_categories  jsonb,
  computed_at           timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Export-ready prospect view. Deliberately excludes unconfirmed matches and
-- homesteaded parcels — the gate lives in SQL, not in a spreadsheet macro.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE VIEW v_prospect AS
SELECT
  p.parcel_id,
  p.situs_address, p.situs_unit, p.situs_city, p.situs_zip,
  p.bedrooms, p.bathrooms, p.living_area_sqft, p.year_built, p.has_pool,
  p.owner_name,
  p.owner_mail_line1, p.owner_mail_city, p.owner_mail_state, p.owner_mail_zip,
  p.owner_is_absentee,
  c.name  AS pm_company,
  s.score AS prospect_score,
  s.mgmt_issue_rate_12mo,
  s.issue_rate_delta,
  s.reviews_12mo,
  s.components,
  l.url   AS listing_url,
  m.score AS match_confidence
FROM prospect_score s
JOIN parcel p               ON p.parcel_id = s.parcel_id
LEFT JOIN pm_company c      ON c.id = s.pm_company_id
JOIN listing_parcel_match m ON m.parcel_id = p.parcel_id AND m.status = 'confirmed'
JOIN listing l              ON l.id = m.listing_id
WHERE p.homestead_exempt IS NOT TRUE;
