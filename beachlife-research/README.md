# Beach Life Research

Market research pipeline for Beach Life Vacations: build a roster of Anna Maria
Island short-term rentals, attribute each to the company that manages it, find
the owner from public record, and surface the properties whose guest reviews
show the current manager is slipping.

---

## What was asked, and what is actually buildable

The original brief was: scrape every active Airbnb and VRBO listing, use visual
recognition to match listing photos to real houses, pull the address, owner,
phone number and owner's home address, and mine the reviews for management
problems. Four separate capabilities, and they do not all work the same way.

**Scraping Airbnb and VRBO directly — don't.** Both prohibit scraping in their
terms of service, both run serious anti-bot defences, and Airbnb has sued
scrapers. The engineering cost is a permanent treadmill and the legal exposure
is real. It is also unnecessary: AirDNA licenses exactly this data (listings,
attributes, reviews, across Airbnb and VRBO) and sells API access. This project
therefore reads OTA data through a swappable adapter (`src/sources/ota/`), with
AirDNA as the recommended supplier and a CSV importer for evaluation.

**Photo → address matching — partly, and never on its own.** Interior photos
are close to useless for geolocation; one white-and-teal beach kitchen looks
like every other. Exterior shots plus the platform's deliberately-jittered map
pin can narrow a house to a handful of parcels, and for a distinctive Gulf-front
home that is often enough. For a unit in a 40-door condo building it is
categorically not, and no amount of model quality changes that — the units are
genuinely indistinguishable from the outside.

So the pipeline inverts the problem. Rather than deducing an address from
pictures, it starts from the address: Florida DBPR publishes the location
address of every licensed vacation rental, and Manatee County publishes the
parcel and owner behind every address. Photos become one signal among several
for linking an anonymous OTA listing back to a parcel already known — and the
strongest photo signal is not "this looks like that house" but a perceptual-hash
collision between an OTA photo and the same image on the management company's
own website, where it sits next to a unit name that resolves to an address.
Matching always outputs ranked candidates with a confidence score and an
evidence trail, never a bare assertion. See [`docs/MATCHING.md`](docs/MATCHING.md).

**Owner name and mailing address — yes, straightforwardly.** Florida property
records are public under Ch. 119, F.S. The county's bulk CAMA download gives
owner name, mailing address, bedroom and bath counts, pool, square footage,
sale history, and homestead status, for every parcel. This is the same data
every real-estate mailer in the state runs on.

**Owner personal phone numbers — available, but the risk is in the calling, not
the getting.** Cell numbers are not public record; they come from skip-tracing
vendors. Buying them is legal. *Calling* them puts you under the federal TCPA,
the National Do Not Call Registry, and Florida's own mini-TCPA — the Florida
Telephone Solicitation Act, which carries $500–$1,500 per call or text and has
made Florida the country's most active venue for these class actions. Direct
mail to the appraiser's mailing address carries none of that. The exporter
enforces this structurally: it will not emit a phone number that has no recorded
DNC scrub. See [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md).

**Review mining for management problems — yes, and it is the best part of the
idea.** It is also the piece that needs the least personal data: a property
whose management-complaint rate is climbing is a prospect whether or not you
ever learn the owner's phone number.

## On IntelliHost and your Key Data account

Both are real tools and neither will give you other companies' listings.

**Key Data** builds its dataset from direct PMS integrations — participating
managers connect Streamline, Track, Escapia, Guesty or Hostaway, and Key Data
aggregates their actual reservations. That makes its benchmarks *better* than
scraped estimates, because they are real bookings rather than inferred
occupancy. But contributed data is anonymised and aggregated before it leaves
the contributor's account, and the data-sharing terms every contributor signs
are precisely what makes that true. You get "3-bedroom Holmes Beach properties
averaged $X ADR at Y% occupancy"; you do not get which competitor manages which
address. That is a deliberate property of the product, not a plan tier.

It is still worth wiring in, for one specific job: the revenue-gap signal.
"Your house earned 18% below comparable Holmes Beach 3BRs last season" is a
strong opener, and Key Data can substantiate it. `src/sources/ota/keydata.js`
implements `fetchBenchmarks()` and deliberately throws a descriptive error on
`fetchListings()` rather than returning an empty array.

**IntelliHost** is a revenue and conversion-optimisation tool for listings you
already control — it connects to *your* PMS and *your* OTA accounts and analyses
your funnel (impressions, clicks, conversion) to recommend pricing and listing
changes. Its "competitive benchmarking" is benchmark-shaped, like Key Data's,
not a competitor roster. Useful for running Beach Life's own portfolio better;
not a market research source.

**The short version:** for the roster, use AirDNA (or the PM-site crawler, which
costs nothing). Keep Key Data for benchmarks and portfolio performance.

---

## Architecture

```
 PUBLIC RECORD                     MARKETING                    LICENSED
 ─────────────                     ─────────                    ────────
 Manatee County CAMA               PM company sites             AirDNA
 (parcel, owner, beds,             (inventory, unit             (Airbnb + VRBO
  pool, sale history)               names, photos)               listings, reviews)
 FL DBPR licences                        │                            │
 (address + licensee)                    │                            │
 Sunbiz (LLC officers)                   │                            │
        │                                │                            │
        └────────────┬───────────────────┴────────────────────────────┘
                     ▼
            listing → parcel matching          ← ranked candidates + evidence
            (src/match/)                         human review queue
                     ▼
            review classification               ← Claude, per-finding attribution
            (src/analyze/review-classifier.js)
                     ▼
            prospect + company scoring          ← deterioration over level
            (src/analyze/scorecard.js)
                     ▼
            gated exports (src/export/)         ← mail list, company scorecard
```

## Getting started

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL and ANTHROPIC_API_KEY
psql "$DATABASE_URL" -f db/schema.sql
```

The useful first run needs no OTA subscription at all:

```bash
node src/cli.js seed-companies    # load the AMI management company roster
node src/cli.js ingest-parcels    # Manatee CAMA → parcels, owners, absentee flags
node src/cli.js ingest-dbpr       # DBPR licences → addresses + licensee attribution
node src/cli.js crawl-pm-sites    # each company's published inventory
```

That alone answers most of "which properties does each company manage", from
public record, with addresses and owners attached. `ingest-dbpr` prints a
licensed-units-by-company table and writes `data/out/dbpr-portfolios.json`.

Then, once an OTA adapter is configured:

```bash
OTA_ADAPTER=airdna node src/cli.js ingest-ota
node src/cli.js classify           # Claude reads reviews, attributes each complaint
node src/cli.js match              # rank listing → parcel candidates
node src/cli.js score              # prospect scores
node src/cli.js export mail        # direct-mail list, highest score first
node src/cli.js export companies   # competitive scorecard
node src/cli.js export review-queue
```

Expect most listings to land in the review queue rather than auto-confirming.
That is the design working, not failing — see below.

## The two design decisions worth knowing about

**Matching is Bayesian, and the prior is 1/N.** Every signal is a likelihood
ratio, and the starting odds are one over the number of candidate parcels. A
signal shared by every unit in a building contributes nothing, so 40 identical
condos cannot manufacture a confident match no matter how well the bedroom
count lines up. On top of that, auto-confirmation requires the top candidate to
lead the runner-up by a margin *and* to have at least one address-bearing
signal — a DBPR licence, a photo-hash collision, or a unit-name hit. A perfect
geometric fit with no such corroboration goes to a human, always. There is a
test for exactly this (`test/match.test.js`).

**Scoring weights deterioration above level.** The ranking question is not
"which property has bad reviews" but "which owner will take the call". A
property sitting at a steady 4.2 has an owner who has made peace with it; one
that fell from 4.8 to 4.1 this year has an owner who has noticed too. Rates are
shrunk toward a base rate so a single bad review on a two-review history cannot
top the list, and thin evidence is discounted explicitly.

## Layout

| Path | What it holds |
|---|---|
| `db/schema.sql` | Data model; the export gates live here as SQL, not policy |
| `src/config/ami.js` | Island geography, jurisdictions, DOR use codes, absentee logic |
| `src/config/companies.js` | Seed roster of AMI management companies + alias matching |
| `src/sources/manatee-pao.js` | County CAMA bulk file → parcels and owners |
| `src/sources/dbpr.js` | State licence file → addresses, licensees, portfolios |
| `src/sources/pm-sites.js` | Polite crawler for management company inventories |
| `src/sources/ota/` | Swappable OTA adapters: `airdna`, `csv`, `keydata`, `none` |
| `src/match/` | Likelihood-ratio signals and candidate resolution |
| `src/analyze/` | Review classification and scoring |
| `src/export/` | Gated CSV exports |
| `docs/` | Data sources, matching method, compliance |

## Tests

```bash
npm test
```

29 tests, no network or database required. They cover the properties that
matter: identical condos must not auto-confirm, geometry alone must not
auto-confirm, deterioration must outrank chronic mediocrity, and thin evidence
must be discounted.

## Status

The public-records half is complete and testable. Three things need your input
before a production run:

1. **A CAMA and DBPR download.** Both are bulk files, both need fetching once
   into the paths in `.env`. Column aliases are already handled for the header
   variants these files have used across roll years.
2. **An OTA decision.** AirDNA subscription, or start with the PM-site crawler
   and add OTA data later.
3. **Photo hashing is stubbed.** `listing_photo.phash` exists and the matching
   signal reads it, but nothing populates it yet — that is the next commit, and
   it is what turns the PM-site crawl into cross-platform identity resolution.
