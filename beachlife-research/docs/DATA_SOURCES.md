# Data sources

Every source here is either a public record, a company's own published
marketing, or a commercially licensed feed. Nothing in this pipeline scrapes a
site that prohibits it.

## 1. Manatee County Property Appraiser — parcels and ownership

The authoritative record of what a property is and who owns it. Florida
property records are public under Ch. 119, F.S.

- **What you get:** parcel ID, situs (physical) address, owner name, owner
  mailing address, bedrooms, baths, heated square footage, year built, pool,
  sale history, just value, homestead status.
- **How to get it:** the appraiser publishes bulk CAMA and tax-roll downloads
  (real property, sales, permits, pool owners) from its CAMA reports page at
  `manateepao.gov`. Download into `MANATEE_CAMA_DIR`. Basic search and viewing
  are free; certified copies and some bulk requests carry a fee.
- **Loader:** `src/sources/manatee-pao.js`. Filters to island parcels with
  rentable DOR use codes and normalises header variants across roll years.
- **Public-records custodian:** listed on the appraiser's public records page —
  use it if a bulk file you need is not published.

Two carve-outs the loader respects. Homesteaded parcels are excluded from
prospecting: they are somebody's residence, not a rental. And s. 119.071(4)(d),
F.S. exempts the home addresses of certain protected occupations (law
enforcement, judges, and others) from disclosure — if the county has suppressed
a record, it will not be in the file, and nothing here should try to
reconstruct it from another source.

## 2. Florida DBPR — vacation rental licences

The highest-value source in the project, and the one that makes photo-based
address guessing largely unnecessary.

Every legal short-term rental in Florida holds a transient public lodging
licence from DBPR's Division of Hotels & Restaurants, licensed as a *dwelling*
(single-family, townhouse, or a unit in a building of four or fewer) or a
*condominium* (Rule 61C-1.002, F.A.C.). DBPR publishes a searchable database
giving the **location address of every licensed vacation rental**, refreshed
daily, plus downloadable licensee data files in CSV.

- **Why it matters twice over:** it gives you the address directly, *and*
  management companies typically hold the licence for units they manage — so
  the licensee name maps a company onto a list of addresses. That is a large
  part of the original question, answered from public record.
- **Where:** the Lodging Public Records and Reports & Statistics sections of
  `myfloridalicense.com` (Division of Hotels and Restaurants). Set
  `DBPR_LICENSE_FILE` to the downloaded CSV.
- **Loader:** `src/sources/dbpr.js`, plus `portfolioByCompany()` for the rollup.

## 3. City vacation rental registrations

All three island cities require registration on top of the state licence, and
each registry is a public record obtainable by a Ch. 119 request even where it
is not posted online:

| City | Requirement |
|---|---|
| **Anna Maria** | Registration, proof of state and county lodging/tax accounts, annual inspection |
| **Holmes Beach** | Vacation rental certificate valid 2 years; code enforcement inspection; minimum stay varies by zoning district |
| **Bradenton Beach** | DBPR licence plus a city-issued ID label posted on the exterior while rented |

These are worth requesting once a year. They catch properties that are rented
but not licensed, and the registration contact is often the manager.

## 4. Manatee County Tax Collector — tourist development tax

Accounts registered for the local bed tax. Another cross-check on which
properties are actually operating as rentals.

## 5. Sunbiz — Florida Division of Corporations

Most rental-owning LLCs are registered here. Resolves an LLC owner name from
the appraiser file into officers, a registered agent, and a principal address.
Free, public, and the correct way to get behind an entity name — as opposed to
inferring it.

## 6. Management company websites

The most direct answer to "which properties does each company manage" is the
company's own site. They publish their full inventory with unit names, photos,
bed and bath counts, and often the address. No terms-of-service problem, and
the attribution is definitionally correct.

The crawler (`src/sources/pm-sites.js`) honours `robots.txt`, serialises
requests per origin behind `CRAWL_DELAY_MS`, and identifies itself with a
contact address in `CRAWL_USER_AGENT`. Set that to a real address you monitor.

Two things this yields that OTA data cannot: a unit-name → address mapping,
which becomes the strongest signal for matching the same property listed
anonymously on Airbnb; and photos of *known* provenance to hash against OTA
listing photos.

The seed roster is in `src/config/companies.js` — 14 companies with verified
websites. It is a starting point, not a census; the AMI Chamber of Commerce
property-management directory and the DBPR licensee list will both surface
companies not on it.

## 7. OTA listing and review data

### Recommended: AirDNA (licensed)

AirDNA tracks Airbnb, VRBO and Booking.com listings and licenses the data
commercially with API access — daily pricing, calendar availability, reviews,
and host information. Using it puts the listing corpus on a contractual footing
instead of a scraper that breaches platform terms and breaks on every anti-bot
change.

Set `OTA_ADAPTER=airdna`, `AIRDNA_API_KEY`, `AIRDNA_MARKET_ID`. Verify the
endpoint paths and field names in `src/sources/ota/airdna.js` against the docs
for your plan — entitlements differ by tier, and `mapAirDnaListing` /
`mapAirDnaReview` are the only two places any field name is read.

### For evaluation: CSV

`OTA_ADAPTER=csv` with `CSV_LISTINGS_PATH` and `CSV_REVIEWS_PATH`.

**Listings columns:** `platform`, `platform_listing_id`, `url`, `title`,
`headline_location`, `latitude`, `longitude`, `approx_radius_m`, `bedrooms`,
`bathrooms`, `sleeps`, `property_type`, `has_pool`, `amenities` (pipe-separated),
`host_name`, `review_count`, `rating`, `first_seen`, `last_seen`, `photo_urls`
(pipe-separated).

**Reviews columns:** `platform_listing_id`, `platform_review_id`, `reviewed_at`,
`rating`, `body`, `reviewer_name`, `has_host_response`, `host_response_at`.

### Key Data — benchmarks only

See the README section on Key Data and IntelliHost. `fetchBenchmarks()` works;
`fetchListings()` throws a descriptive `CapabilityError` by design.

### Not recommended: direct scraping

Airbnb and VRBO both prohibit it in their terms of service, both run
significant anti-bot infrastructure, and Airbnb has litigated against scrapers.
The cost is a permanent maintenance treadmill on top of the contractual
exposure. No adapter here does it, and adding one would put the rest of this
work at risk.
